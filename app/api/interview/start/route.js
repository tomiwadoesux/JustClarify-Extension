// Begin a student interview.
//
// GET  -> { open, linkRequired }   so the page can say "closed" before asking
//                                  anyone to tick a consent box
// POST { consent, adult, link, hp }
//      -> { token, turn, maxTurns, deadlineAt, question }
//
// Starting costs no model call: the first question is written, not generated.
// A bot therefore has to get through the share link, the daily cap and a real
// answer before it can spend anything.
//
// The token is returned once and only its sha256 is stored. The page keeps it
// in sessionStorage and sends it in the body, so there is no cookie and no
// cross-site request to forge.

import { GATE, ERRORS } from '@/lib/interview/copy.mjs';
import { linkRequired } from '@/lib/interview/config.mjs';
import { sameOrigin, burst, interviewOpen, json } from '@/lib/interview/guard';
import { interviewEngine } from '@/lib/interview/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (burst('status', request, 120)) return json({ error: ERRORS.tooMany }, 429);
  return json({ open: await interviewOpen(), linkRequired: linkRequired() });
}

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'Forbidden.' }, 403);
  if (burst('start', request, 60)) return json({ error: ERRORS.tooMany }, 429);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: 'Bad request.' }, 400);
  }

  // A hidden field no person fills in. Answered like any other bad request so
  // the script that filled it learns nothing.
  if (body?.hp) return json({ error: 'Bad request.' }, 400);
  if (body?.consent !== true || body?.adult !== true) {
    return json({ error: 'Please tick both boxes to take part.' }, 400);
  }

  try {
    if (!(await interviewOpen())) return json({ error: GATE.closed, closed: true }, 503);

    const result = await interviewEngine.start({ link: body?.link });
    if (result.status === 'link') return json({ error: GATE.needLink, link: true }, 403);
    if (result.status === 'cap') return json({ error: GATE.full, closed: true }, 503);

    return json({
      token: result.token,
      turn: result.turn,
      maxTurns: result.maxTurns,
      deadlineAt: result.deadlineAt,
      question: result.question,
    });
  } catch (error) {
    console.error('[api/interview/start]', String(error?.message || error).slice(0, 120));
    return json({ error: GATE.closed, closed: true }, 503);
  }
}
