// The tellme board: list reports, file a report.
//
// Filing generates the gist ("this person means…") at post time, server-side,
// so every report arrives on the board with the line readers must open before
// they may vote. A gist failure never blocks the report — it posts with the
// gist empty and the page simply shows the report without the disclosure gate.

import { tellmeDb, tellmeAI, tellmeBurstLimited, tellmeVotingEnabled } from '@/lib/tellme';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GIST_SYSTEM =
  'You read one problem report about JustClarify, a browser extension that explains highlighted ' +
  'text, fact-checks pages and has voice control. In one or two plain sentences, state what the ' +
  'person is saying went wrong or what they want, beginning exactly with "This person means". ' +
  'Do not judge whether they are right, do not propose fixes, do not add anything they did not ' +
  'say, and never use em dashes.';

export async function GET() {
  try {
    const [reports, votingEnabled] = await Promise.all([
      tellmeDb(
        'jc_reports?select=id,created_at,body,context,source,status,gist,ups,downs,category,fix_state,fix_pr_url,fix_ups,fix_downs,screenshot_url&order=created_at.desc&limit=200',
      ),
      tellmeVotingEnabled(),
    ]);
    return Response.json({ reports: reports || [], votingEnabled });
  } catch (_) {
    return Response.json(
      { error: "Couldn't load the reports right now. Try again in a moment." },
      { status: 503 },
    );
  }
}

export async function POST(request) {
  if (tellmeBurstLimited('report', request, 5)) {
    return Response.json(
      { error: 'Slow down a moment. A few reports a minute is plenty.' },
      { status: 429 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }

  const text = String(body?.body || '').trim().slice(0, 2000);
  if (text.length < 3) {
    return Response.json({ error: 'Tell us what happened first.' }, { status: 400 });
  }
  const context = String(body?.context || '').trim().slice(0, 1000) || null;
  const source = body?.source === 'extension' ? 'extension' : 'web';

  // Only a URL our own upload route minted is accepted — anything else would
  // let a report embed an arbitrary third-party image on the public board.
  const shotPrefix = `${process.env.SUPABASE_URL}/storage/v1/object/public/tellme/`;
  const screenshot =
    typeof body?.screenshot === 'string' &&
    process.env.SUPABASE_URL &&
    body.screenshot.startsWith(shotPrefix)
      ? body.screenshot.slice(0, 500)
      : null;

  // Best effort, capped by tellmeAI's own timeout — the report posts either way.
  const gist = await tellmeAI(GIST_SYSTEM, text);

  try {
    const rows = await tellmeDb('jc_reports', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: { body: text, context, source, gist, screenshot_url: screenshot },
    });
    return Response.json({ report: rows?.[0] || null }, { status: 201 });
  } catch (_) {
    return Response.json(
      { error: "Couldn't save that right now. Please try again shortly." },
      { status: 503 },
    );
  }
}
