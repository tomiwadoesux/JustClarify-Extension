// The interview orchestrator: start, take an answer, transcribe a voice note,
// stop, and summarise.
//
// It knows nothing about Next, Supabase or the AI Gateway. Storage, models and
// the clock are handed in, so the same code runs against the real database in
// the routes and against an in-memory store with a scripted model in
// tests/interview/eval.mjs. That is what lets ten awkward personas be run
// through the whole flow offline.
//
// Results are plain objects with a `status` the routes map onto HTTP:
//   question | done | support | ended     the interview moved
//   resync                                wrong turn: here is the current one
//   busy | invalid | token | closed | cap | link | error

import { createHash, randomBytes } from 'node:crypto';
import { LIMITS, caps, linkRequired } from './config.mjs';
import {
  OPENER,
  FALLBACK_QUESTIONS,
  CLOSING,
  ENDED,
  TIME_UP,
  SUPPORT,
  UNDER_18,
} from './copy.mjs';
import { redact, applySpans } from './redact.mjs';
import { checkQuestion, findInText, findQuote, plain } from './schema.mjs';
import { refCode } from './ref.mjs';
import {
  safetyFloor,
  decideSafety,
  nextTopic,
  withMentions,
  isUnprompted,
  tooLate,
  afterAnswer,
  remainingMs,
} from './state.mjs';

export function hashToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;
const WITHHELD = '[withheld: the support message was shown]';

export function createEngine({ store, llm, clock = () => Date.now() }) {
  // --- start -----------------------------------------------------------------
  // No model call. The opener is scripted, so opening the page costs nothing
  // and a bot has to answer a turn before anything is spent.
  async function start({ link }) {
    const token = randomBytes(32).toString('base64url');
    const result = await store.start({
      tokenHash: hashToken(token),
      link: typeof link === 'string' ? link.trim().toLowerCase().slice(0, 40) : '',
      requireLink: linkRequired(),
      question: OPENER,
      minutes: LIMITS.minutes,
      capSessions: caps().sessionsPerDay,
    });
    if (!result?.ok) return { status: result?.reason === 'cap' ? 'cap' : 'link' };
    return {
      status: 'question',
      token,
      turn: 1,
      maxTurns: LIMITS.maxTurns,
      deadlineAt: result.deadline_at,
      question: { text: OPENER },
    };
  }

  function claimFailure(claim) {
    switch (claim?.reason) {
      case 'turn':
        return { status: 'resync', turn: claim.turn, question: { text: claim.question } };
      case 'busy':
        return { status: 'busy' };
      case 'closed':
        return { status: 'closed', sessionStatus: claim.status };
      case 'cap':
        return { status: 'cap' };
      case 'stt-limit':
        return { status: 'stt-limit' };
      default:
        return { status: 'token' };
    }
  }

  // --- answer ----------------------------------------------------------------
  async function answer({ token, turn, text, via }) {
    if (!TOKEN_RE.test(String(token || ''))) return { status: 'token' };
    const raw = String(text || '').trim().slice(0, LIMITS.maxAnswerChars);
    if (!raw) return { status: 'invalid' };
    const turnNumber = Number(turn);
    if (!Number.isInteger(turnNumber) || turnNumber < 1) return { status: 'invalid' };

    const tokenHash = hashToken(token);
    const limits = caps();
    const claim = await store.claim({
      tokenHash,
      turn: turnNumber,
      kind: 'turn',
      leaseSeconds: LIMITS.leaseSeconds,
      capLlm: limits.llmCallsPerDay,
      capSttSecs: limits.sttSecondsPerDay,
      maxStt: LIMITS.maxStt,
    });
    if (!claim?.ok) return claimFailure(claim);

    const now = clock();
    const sessionId = claim.id;

    // Past the deadline and past the grace period: the interview is over and
    // this answer is not taken.
    if (tooLate(now, claim.deadline_at)) {
      await store.finish({ tokenHash, status: 'done', stopReason: 'time' });
      return { status: 'done', message: TIME_UP, ref: refCode(sessionId), sessionId };
    }

    // 1. Redact, 2. keyword floor on the raw words, 3. classifier on the
    // redacted text. The floor reads the raw text because redaction could
    // remove nothing it cares about, and it must never depend on a model.
    const first = redact(raw);
    const floor = safetyFloor(raw);
    let llmCalls = 0;

    let classified = null;
    if (floor !== 'distress' && floor !== 'minor') {
      llmCalls += 1;
      classified = await llm.safety({ text: first.text, sessionId }).catch(() => null);
    }
    const safety = decideSafety(floor, classified);
    const degraded = floor ? false : safety.degraded;

    if (safety.label === 'minor') {
      // Stop and discard: nothing a minor said is kept.
      await store.discard(sessionId);
      return { status: 'ended', message: UNDER_18 };
    }

    const base = {
      tokenHash,
      turn: turnNumber,
      answerVia: via === 'voice' ? 'voice' : 'typed',
      asked: claim.asked || {},
      mentioned: claim.mentioned || {},
      degraded,
    };

    if (safety.label === 'distress') {
      // The triggering words are not stored. What happened is recorded; what
      // was said is not.
      await store.commit({
        ...base,
        answer: WITHHELD,
        redactions: 0,
        status: 'support',
        stopReason: 'distress',
        llmCalls,
      });
      return { status: 'support', message: SUPPORT, ref: refCode(sessionId) };
    }

    if (safety.label === 'abuse') {
      await store.commit({
        ...base,
        answer: '[withheld]',
        redactions: 0,
        status: 'ended',
        stopReason: 'abuse',
        llmCalls,
      });
      return { status: 'ended', message: ENDED };
    }

    const second = applySpans(first.text, classified?.pii);
    const cleanAnswer = second.text;
    const redactions = first.count + second.count;

    const turns = [
      ...(claim.turns || []),
      { idx: turnNumber, question: claim.question, topic: claim.question_topic, answer: cleanAnswer },
    ];

    const verdict = afterAnswer({ turn: turnNumber, now, deadlineAt: claim.deadline_at });
    const topic = verdict.done ? null : nextTopic(base.asked, base.mentioned);

    if (verdict.done || !topic) {
      const reason = verdict.done ? verdict.reason : 'covered';
      const committed = await store.commit({
        ...base,
        answer: cleanAnswer,
        redactions,
        status: 'done',
        stopReason: reason,
        llmCalls,
      });
      if (!committed?.ok) return { status: 'busy' };
      return {
        status: 'done',
        message: reason === 'time' ? TIME_UP : CLOSING,
        ref: refCode(sessionId),
        sessionId,
      };
    }

    // The model writes the wording for a topic the code chose. Anything that
    // fails validation, or no reply at all, falls back to the written question.
    llmCalls += 1;
    const drafted = await llm.question({ turns, topic, sessionId }).catch(() => null);
    const checked = checkQuestion(drafted?.data?.question);
    const question = checked || FALLBACK_QUESTIONS[topic];
    const questionVia = checked ? drafted.via : 'script';

    // A mention only counts if the evidence is really in the answer.
    const verified = (drafted?.data?.mentions || [])
      .filter((m) => findInText(m.evidence, cleanAnswer, 3))
      .map((m) => m.topic);
    const mentioned = withMentions(base.mentioned, verified, turnNumber);
    const asked = { ...base.asked, [topic]: turnNumber + 1 };

    const committed = await store.commit({
      ...base,
      asked,
      mentioned,
      answer: cleanAnswer,
      redactions,
      status: 'active',
      stopReason: null,
      question,
      topic,
      questionVia,
      llmCalls,
    });
    if (!committed?.ok) return { status: 'busy' };

    return {
      status: 'question',
      turn: turnNumber + 1,
      question: { text: question },
      remainingMs: remainingMs(now, claim.deadline_at),
    };
  }

  // --- the student presses stop ----------------------------------------------
  async function end({ token }) {
    if (!TOKEN_RE.test(String(token || ''))) return { status: 'token' };
    const result = await store.finish({
      tokenHash: hashToken(token),
      status: 'ended',
      stopReason: 'student',
    });
    if (!result?.ok) return { status: 'token' };
    return {
      status: 'ended',
      message: ENDED,
      ref: refCode(result.id),
      // Only worth summarising if they answered something.
      sessionId: result.turn > 1 ? result.id : null,
    };
  }

  // --- voice note ------------------------------------------------------------
  // Returns redacted text for the student to review and edit. Nothing is
  // stored here: the answer is only saved when they send it as a turn.
  async function transcribe({ token, turn, audio }) {
    if (!TOKEN_RE.test(String(token || ''))) return { status: 'token' };
    const limits = caps();
    const claim = await store.claim({
      tokenHash: hashToken(token),
      turn: Number(turn),
      kind: 'stt',
      leaseSeconds: LIMITS.leaseSeconds,
      capLlm: limits.llmCallsPerDay,
      capSttSecs: limits.sttSecondsPerDay,
      maxStt: LIMITS.maxStt,
    });
    if (!claim?.ok) return claimFailure(claim);

    const heard = await llm.transcribe({ audio, sessionId: claim.id }).catch(() => null);
    // Count the seconds whether or not the words were usable: the spend is real.
    // With no duration reported, estimate from size at the 32 kbps we record at.
    const seconds = Math.ceil(heard?.seconds || audio.byteLength / 4000);
    await store.count({ llmCalls: 0, sttSeconds: Math.min(seconds, 600) }).catch(() => {});

    const said = String(heard?.text || '').trim();
    if (!said) return { status: 'unheard' };
    return { status: 'text', text: redact(said).text.slice(0, LIMITS.maxAnswerChars) };
  }

  // --- summary ---------------------------------------------------------------
  // Runs after the student has their closing message. Idempotent: running it
  // again overwrites the summary, which is how the board's "re-run" works.
  async function extract(sessionId) {
    const loaded = await store.load(sessionId);
    if (!loaded?.session) return { status: 'missing' };
    const { session } = loaded;
    // Withheld answers carry no content, so they are not shown to the model.
    const turns = (loaded.turns || []).filter((t) => !String(t.answer).startsWith('[withheld'));

    if (!turns.length) {
      await store.saveSummary(sessionId, { empty: true, topics: [], other: [], tools: [] }, null);
      return { status: 'empty' };
    }

    const drafted = await llm.summary({ turns, sessionId }).catch(() => null);
    await store.count({ llmCalls: 1, sttSeconds: 0 }).catch(() => {});
    if (!drafted?.data) {
      await store.saveSummary(sessionId, null, 'extract-failed');
      return { status: 'failed' };
    }

    const asked = session.asked || {};
    const seen = new Set();
    const topics = [];
    let dropped = 0;
    for (const entry of drafted.data.topics) {
      if (seen.has(entry.topic)) continue;
      const quote = findQuote(entry.quote, turns);
      // A quote the student never said is dropped, and the topic with it.
      if (!quote) {
        dropped += 1;
        continue;
      }
      seen.add(entry.topic);
      topics.push({
        topic: entry.topic,
        quote: quote.text.slice(0, 400),
        turn: quote.turn,
        severity: Number(entry.severity),
        note: plain(entry.note, 200),
        unprompted: isUnprompted(entry.topic, asked, quote.turn),
      });
    }

    const other = [];
    for (const entry of drafted.data.other.slice(0, 6)) {
      const quote = findQuote(entry.quote, turns);
      if (!quote) {
        dropped += 1;
        continue;
      }
      other.push({
        problem: plain(entry.problem, 200),
        quote: quote.text.slice(0, 400),
        turn: quote.turn,
      });
    }

    const summary = {
      topics,
      other,
      tools: [...new Set(drafted.data.tools.map((t) => plain(t, 40)).filter(Boolean))].slice(0, 20),
      level: drafted.data.level,
      gist: plain(drafted.data.gist, 300),
      via: drafted.via,
      droppedQuotes: dropped,
      turns: turns.length,
    };
    await store.saveSummary(sessionId, summary, null);
    return { status: 'ok', summary };
  }

  return { start, answer, end, transcribe, extract };
}
