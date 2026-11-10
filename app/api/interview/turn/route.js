// One answer in, one question (or an ending) out.
//
// POST { token, turn, text, via: 'typed' | 'voice' }   an answer
// POST { token, end: true }                            the student stops
//
// 200 { status: 'question', turn, question, remainingMs }
// 200 { status: 'done' | 'support' | 'ended', message, ref }
// 409 { error, turn, question }    wrong turn: here is the current one, so a
//                                  reloaded or double-tapped page can resync
// 409 { error, busy: true }        the previous answer is still being read
//
// All the decisions are in lib/interview/engine.mjs. This file only maps its
// results onto HTTP and, when an interview finishes, starts the summary in the
// background so the student is not kept waiting for it.

import { waitUntil } from '@vercel/functions';
import { GATE, ERRORS } from '@/lib/interview/copy.mjs';
import { sameOrigin, burst, json } from '@/lib/interview/guard';
import { interviewEngine } from '@/lib/interview/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Safety check, then the question, each with its own fallback attempt.
export const maxDuration = 60;

function summariseLater(sessionId) {
  if (!sessionId) return;
  waitUntil(
    interviewEngine.extract(sessionId).catch((error) => {
      console.error('[api/interview/turn] extract', String(error?.message || error).slice(0, 120));
    }),
  );
}

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'Forbidden.' }, 403);
  if (burst('turn', request, 240)) return json({ error: ERRORS.tooMany }, 429);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: 'Bad request.' }, 400);
  }

  try {
    const result = body?.end === true
      ? await interviewEngine.end({ token: body?.token })
      : await interviewEngine.answer({
          token: body?.token,
          turn: body?.turn,
          text: body?.text,
          via: body?.via,
        });

    switch (result.status) {
      case 'question':
        return json({
          status: 'question',
          turn: result.turn,
          question: result.question,
          remainingMs: result.remainingMs,
        });
      case 'done':
      case 'ended':
        summariseLater(result.sessionId);
        return json({ status: result.status, message: result.message, ref: result.ref || null });
      case 'support':
        return json({ status: 'support', message: result.message, ref: result.ref || null });
      case 'resync':
        return json({ error: ERRORS.generic, turn: result.turn, question: result.question }, 409);
      case 'busy':
        return json({ error: ERRORS.busy, busy: true }, 409);
      case 'invalid':
        return json({ error: ERRORS.empty }, 400);
      case 'cap':
        return json({ error: GATE.full, closed: true }, 503);
      default:
        // An unknown token and a finished session look the same from outside.
        return json({ error: ERRORS.session, ended: true }, 401);
    }
  } catch (error) {
    console.error('[api/interview/turn]', String(error?.message || error).slice(0, 120));
    return json({ error: ERRORS.generic }, 503);
  }
}
