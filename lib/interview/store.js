// The interview's storage, on Supabase through the same thin PostgREST wrapper
// the tellme routes use (lib/tellme.js). No Supabase client library.
//
// Everything that has to be atomic (is this the current turn, is an answer
// already in flight, is today's budget spent) is a SQL function in
// ambient-explainer-backend/migrations/005_interview.sql, called here as an
// RPC. tests/interview/memstore.mjs mirrors those functions for offline runs,
// so the two must be changed together.
//
// tellmeDb throws 'storage-unconfigured' or 'storage-failed'. Nothing here
// catches that: the routes turn it into a 503, which is the point. Unlike
// lib/api-guard.js, this page FAILS CLOSED. If the counters cannot be read,
// nobody gets to spend.

import { tellmeDb } from '@/lib/tellme';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rpc(name, body) {
  return tellmeDb(`rpc/${name}`, { method: 'POST', body });
}

export const interviewStore = {
  start({ tokenHash, link, requireLink, question, minutes, capSessions }) {
    return rpc('jc_iv_start', {
      p_token_hash: tokenHash,
      p_link: link || '',
      p_require_link: !!requireLink,
      p_question: question,
      p_minutes: minutes,
      p_cap_sessions: capSessions,
    });
  },

  claim({ tokenHash, turn, kind, leaseSeconds, capLlm, capSttSecs, maxStt }) {
    return rpc('jc_iv_claim', {
      p_token_hash: tokenHash,
      p_turn: turn,
      p_kind: kind,
      p_lease_seconds: leaseSeconds,
      p_cap_llm: capLlm,
      p_cap_stt_secs: capSttSecs,
      p_max_stt: maxStt,
    });
  },

  commit(p) {
    return rpc('jc_iv_commit', {
      p_token_hash: p.tokenHash,
      p_turn: p.turn,
      p_answer: p.answer,
      p_answer_via: p.answerVia,
      p_redactions: p.redactions || 0,
      p_status: p.status,
      p_stop_reason: p.stopReason || null,
      p_question: p.question || null,
      p_topic: p.topic || null,
      p_via: p.questionVia || null,
      p_asked: p.asked || {},
      p_mentioned: p.mentioned || {},
      p_degraded: !!p.degraded,
      p_llm_calls: p.llmCalls || 0,
    });
  },

  finish({ tokenHash, status, stopReason }) {
    return rpc('jc_iv_finish', {
      p_token_hash: tokenHash,
      p_status: status,
      p_stop_reason: stopReason,
    });
  },

  // Turns go with it: jc_iv_turns has "on delete cascade".
  async discard(id) {
    if (!UUID_RE.test(String(id))) return;
    await tellmeDb(`jc_iv_sessions?id=eq.${id}`, { method: 'DELETE' });
  },

  count({ llmCalls = 0, sttSeconds = 0 }) {
    return rpc('jc_iv_count', { p_llm_calls: llmCalls, p_stt_seconds: sttSeconds });
  },

  async load(id) {
    if (!UUID_RE.test(String(id))) return null;
    const [sessions, turns] = await Promise.all([
      tellmeDb(`jc_iv_sessions?id=eq.${id}&select=*`),
      tellmeDb(
        `jc_iv_turns?session_id=eq.${id}&select=idx,question,question_topic,question_via,answer,answer_via,redactions,created_at&order=idx.asc`,
      ),
    ]);
    const session = sessions?.[0];
    if (!session) return null;
    // The token hash never leaves this file.
    delete session.token_hash;
    return { session, turns: turns || [] };
  },

  async saveSummary(id, summary, error) {
    if (!UUID_RE.test(String(id))) return;
    await tellmeDb(`jc_iv_sessions?id=eq.${id}`, {
      method: 'PATCH',
      body: { summary, extract_error: error || null, extracted_at: new Date().toISOString() },
    });
  },
};

// --- the open/closed flag ----------------------------------------------------
//
// Cached for 30 seconds per function instance so opening the page does not
// cost a database read every time. A failed read counts as closed.

let flagCache = { at: 0, value: false };

export async function interviewEnabledFlag({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && now - flagCache.at < 30_000) return flagCache.value;
  let value = false;
  try {
    const rows = await tellmeDb('jc_flags?key=eq.interview_enabled&select=value');
    value = rows?.[0]?.value === true;
  } catch (_) {
    value = false;
  }
  flagCache = { at: now, value };
  return value;
}

export async function setInterviewEnabled(on) {
  await tellmeDb('jc_flags', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: { key: 'interview_enabled', value: !!on },
  });
  flagCache = { at: Date.now(), value: !!on };
}

// --- the board ---------------------------------------------------------------

const SESSION_LIST =
  'id,created_at,link_code,status,stop_reason,turn,safety_degraded,finished_at,extracted_at,extract_error,summary';

export const interviewAdmin = {
  UUID_RE,

  sessions(limit = 500) {
    return tellmeDb(`jc_iv_sessions?select=${SESSION_LIST}&order=created_at.desc&limit=${limit}`);
  },

  // Finished, with at least one answer, and never summarised. Sessions that
  // ended on the support message are deliberately not summarised.
  pending(limit = 5) {
    return tellmeDb(
      `jc_iv_sessions?select=id&status=in.(done,ended,abandoned)&extracted_at=is.null&turn=gt.1&order=created_at.asc&limit=${limit}`,
    );
  },

  async usageToday() {
    const day = new Date().toISOString().slice(0, 10);
    const rows = await tellmeDb(`jc_iv_usage?day=eq.${day}&select=*`);
    return rows?.[0] || { day, sessions: 0, turns: 0, llm_calls: 0, stt_calls: 0, stt_seconds: 0 };
  },

  usageRecent() {
    return tellmeDb('jc_iv_usage?select=*&order=day.desc&limit=14');
  },

  async heartbeat() {
    const rows = await tellmeDb('jc_flags?key=eq.keepalive&select=value');
    return rows?.[0]?.value || null;
  },

  links() {
    return tellmeDb('jc_iv_links?select=*&order=created_at.desc&limit=200');
  },

  createLink({ code, label, maxSessions, expiresAt }) {
    return tellmeDb('jc_iv_links', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: { code, label, max_sessions: maxSessions, expires_at: expiresAt },
    });
  },

  setLink(code, patch) {
    return tellmeDb(`jc_iv_links?code=eq.${encodeURIComponent(code)}`, {
      method: 'PATCH',
      body: patch,
    });
  },

  async remove(id) {
    if (!UUID_RE.test(String(id))) return;
    await tellmeDb(`jc_iv_sessions?id=eq.${id}`, { method: 'DELETE' });
  },
};

// How long interview answers are kept. Stated in PRIVACY_POLICY.md: change
// both together.
const RETENTION_DAYS = 365;

// --- the daily keep-alive ----------------------------------------------------
//
// Supabase pauses a free project after a week with no activity. The cron route
// calls this once a day: a read, a write, and a sweep of sessions whose clock
// ran out with nobody there to answer.
export async function interviewKeepAlive() {
  const at = new Date().toISOString();
  await tellmeDb('jc_flags?select=key&limit=1');
  await tellmeDb('jc_flags', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: { key: 'keepalive', value: { at } },
  });
  // Ten minutes past the deadline is well past the grace period.
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  let swept = null;
  try {
    const rows = await tellmeDb(
      `jc_iv_sessions?status=eq.active&deadline_at=lt.${encodeURIComponent(cutoff)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: { status: 'abandoned', stop_reason: 'timeout', finished_at: at, busy_until: null },
      },
    );
    swept = Array.isArray(rows) ? rows.length : 0;
  } catch (_) {
    // The interview tables may not exist yet. The heartbeat above still counts.
    swept = null;
  }

  // The privacy policy says interview answers are kept for at most 12 months.
  // This is what makes that true without anyone having to remember it. Turns
  // go with their session (on delete cascade).
  const expiry = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  let purged = null;
  try {
    const rows = await tellmeDb(`jc_iv_sessions?created_at=lt.${encodeURIComponent(expiry)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    purged = Array.isArray(rows) ? rows.length : 0;
  } catch (_) {
    purged = null;
  }
  return { at, swept, purged };
}
