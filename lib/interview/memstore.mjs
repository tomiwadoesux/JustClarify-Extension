// An in-memory stand-in for lib/interview/store.js, with the same rules the
// SQL functions in migrations/005_interview.sql enforce: one current turn, a
// lease while an answer is in flight, daily caps, link caps.
//
// Two uses. The tests drive the whole interview through it offline. And with
// JC_IV_MEMORY=1 the dev server uses it instead of Supabase (see backend.js),
// so the page and the board can be worked on without touching the live
// database. It is never used in production.
//
// If the SQL changes, this has to change with it, which is why the comments
// below name the function each method mirrors.

import { randomUUID } from 'node:crypto';

export function createMemStore({ clock = () => Date.now(), links = {} } = {}) {
  const sessions = new Map(); // tokenHash -> session
  const byId = new Map();
  const turns = new Map(); // id -> turn[]
  const usage = { sessions: 0, turns: 0, llm_calls: 0, stt_calls: 0, stt_seconds: 0 };
  const linkRows = new Map(
    Object.entries(links).map(([code, row]) => [
      code,
      { code, active: true, max_sessions: 60, sessions_used: 0, expires_at: null, ...row },
    ]),
  );

  return {
    usage,
    sessions,
    turns,
    links: linkRows,

    // jc_iv_start
    async start({ tokenHash, link, requireLink, question, minutes, capSessions }) {
      let row = null;
      if (link) {
        row = linkRows.get(link);
        const expired = row?.expires_at && new Date(row.expires_at).getTime() < clock();
        if (!row || !row.active || expired || row.sessions_used >= row.max_sessions) {
          return { ok: false, reason: 'link' };
        }
      } else if (requireLink) {
        return { ok: false, reason: 'link' };
      }
      if (usage.sessions >= capSessions) return { ok: false, reason: 'cap' };
      usage.sessions += 1;
      if (row) row.sessions_used += 1;

      const session = {
        id: randomUUID(),
        token_hash: tokenHash,
        link_code: row?.code || null,
        status: 'active',
        stop_reason: null,
        turn: 1,
        question,
        question_topic: 'opener',
        question_via: 'script',
        created_at: new Date(clock()).toISOString(),
        deadline_at: new Date(clock() + minutes * 60_000).toISOString(),
        busy_until: null,
        asked: {},
        mentioned: {},
        stt_calls: 0,
        safety_degraded: false,
        summary: null,
        extract_error: null,
      };
      sessions.set(tokenHash, session);
      byId.set(session.id, session);
      turns.set(session.id, []);
      return { ok: true, id: session.id, deadline_at: session.deadline_at };
    },

    // jc_iv_claim
    async claim({ tokenHash, turn, kind, leaseSeconds, capLlm, capSttSecs, maxStt }) {
      const s = sessions.get(tokenHash);
      if (!s) return { ok: false, reason: 'token' };
      if (s.status !== 'active') return { ok: false, reason: 'closed', status: s.status };
      if (s.turn !== turn) return { ok: false, reason: 'turn', turn: s.turn, question: s.question };

      if (kind === 'stt') {
        if (s.stt_calls >= maxStt) return { ok: false, reason: 'stt-limit' };
        if (usage.stt_seconds >= capSttSecs) return { ok: false, reason: 'cap' };
        s.stt_calls += 1;
        usage.stt_calls += 1;
        return { ok: true, id: s.id, deadline_at: s.deadline_at };
      }

      if (s.busy_until && s.busy_until > clock()) return { ok: false, reason: 'busy' };
      if (usage.llm_calls >= capLlm) return { ok: false, reason: 'cap' };
      s.busy_until = clock() + leaseSeconds * 1000;
      usage.turns += 1;
      return {
        ok: true,
        id: s.id,
        turn: s.turn,
        created_at: s.created_at,
        deadline_at: s.deadline_at,
        asked: { ...s.asked },
        mentioned: { ...s.mentioned },
        question: s.question,
        question_topic: s.question_topic,
        question_via: s.question_via,
        turns: turns.get(s.id).map((t) => ({
          idx: t.idx,
          question: t.question,
          topic: t.question_topic,
          answer: t.answer,
        })),
      };
    },

    // jc_iv_commit
    async commit(p) {
      const s = sessions.get(p.tokenHash);
      if (!s || s.status !== 'active' || s.turn !== p.turn) return { ok: false, reason: 'stale' };
      turns.get(s.id).push({
        idx: s.turn,
        question: s.question,
        question_topic: s.question_topic,
        question_via: s.question_via,
        answer: p.answer,
        answer_via: p.answerVia,
        redactions: p.redactions || 0,
      });
      s.asked = p.asked || s.asked;
      s.mentioned = p.mentioned || s.mentioned;
      s.busy_until = null;
      s.safety_degraded = s.safety_degraded || !!p.degraded;
      if (p.status === 'active') {
        s.turn += 1;
        s.question = p.question;
        s.question_topic = p.topic;
        s.question_via = p.questionVia;
      } else {
        s.status = p.status;
        s.stop_reason = p.stopReason;
        s.finished_at = new Date(clock()).toISOString();
      }
      usage.llm_calls += p.llmCalls || 0;
      return { ok: true, id: s.id };
    },

    // jc_iv_finish
    async finish({ tokenHash, status, stopReason }) {
      const s = sessions.get(tokenHash);
      if (!s) return { ok: false, reason: 'token' };
      if (s.status === 'active') {
        s.status = status;
        s.stop_reason = stopReason;
        s.finished_at = new Date(clock()).toISOString();
        s.busy_until = null;
      }
      return { ok: true, id: s.id, status: s.status, turn: s.turn };
    },

    async discard(id) {
      const s = byId.get(id);
      if (!s) return;
      sessions.delete(s.token_hash);
      byId.delete(id);
      turns.delete(id);
    },

    // jc_iv_count
    async count({ llmCalls = 0, sttSeconds = 0 }) {
      usage.llm_calls += llmCalls;
      usage.stt_seconds += sttSeconds;
    },

    async load(id) {
      const s = byId.get(id);
      if (!s) return null;
      return { session: s, turns: turns.get(id).map((t) => ({ ...t })) };
    },

    async saveSummary(id, summary, error) {
      const s = byId.get(id);
      if (!s) return;
      s.summary = summary;
      s.extract_error = error;
      s.extracted_at = new Date(clock()).toISOString();
    },

    // --- what the board reads (mirrors interviewAdmin in store.js) -----------
    admin: {
      async sessions() {
        return [...byId.values()]
          .map((s) => ({ ...s, token_hash: undefined }))
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      },
      async pending(limit = 5) {
        return [...byId.values()]
          .filter((s) => ['done', 'ended', 'abandoned'].includes(s.status) && !s.extracted_at && s.turn > 1)
          .slice(0, limit)
          .map((s) => ({ id: s.id }));
      },
      async usageToday() {
        return { day: new Date(clock()).toISOString().slice(0, 10), ...usage };
      },
      async usageRecent() {
        return [{ day: new Date(clock()).toISOString().slice(0, 10), ...usage }];
      },
      async heartbeat() {
        return { at: new Date(clock()).toISOString() };
      },
      async links() {
        return [...linkRows.values()].map((row) => ({ created_at: null, ...row }));
      },
      async createLink({ code, label, maxSessions, expiresAt }) {
        const row = { code, label, max_sessions: maxSessions, sessions_used: 0, expires_at: expiresAt, active: true };
        linkRows.set(code, row);
        return [row];
      },
      async setLink(code, patch) {
        const row = linkRows.get(code);
        if (row) Object.assign(row, patch);
      },
      async remove(id) {
        const s = byId.get(id);
        if (!s) return;
        sessions.delete(s.token_hash);
        byId.delete(id);
        turns.delete(id);
      },
    },

    // Everything a test needs to assert "this string never reached storage".
    dump() {
      return JSON.stringify({
        sessions: [...byId.values()],
        turns: [...turns.values()],
      });
    },
  };
}
