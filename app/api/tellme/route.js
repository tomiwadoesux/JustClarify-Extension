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

// What the report IS, which decides its colour on the board. Not the same
// question as the agent's category, which is how to fix it.
//
// The line that matters most is bug versus suggestion. "It does not hear
// French" is not a fault, it is a wish, and showing it in the same angry red
// as a crash misrepresents both: the board looks like a wall of breakage, and
// the person who asked for something reads a promise nobody made.
const KIND_SYSTEM =
  'You sort one message sent to the feedback board of JustClarify, a browser extension that ' +
  'explains highlighted text, fact-checks pages and has voice control. Answer with exactly one ' +
  'word and nothing else.\n' +
  'bug — something is broken, wrong, missing where it should exist, or behaves other than the ' +
  'person expected. Includes errors, crashes, wrong answers, and anything they say used to work.\n' +
  'suggestion — nothing is broken; they want something added, supported, or changed. New ' +
  'languages, new features, preferences, "it would be nice if", "can you also".\n' +
  'filtered — there is no request inside it at all: praise, thanks, insults, jokes, spam, ' +
  'gibberish, or a question about something else entirely.\n' +
  'If it could be a bug or a suggestion, answer bug. If it could be filtered or either of the ' +
  'others, answer with the other one: burying a real report is far worse than showing a stray ' +
  'compliment.';

const KINDS = new Set(['bug', 'suggestion', 'filtered']);

// Never throws and never blocks a report: an unclassifiable message is a bug,
// which is the state that keeps it visible.
async function classifyKind(text) {
  const answer = await tellmeAI(KIND_SYSTEM, text, 8);
  const word = String(answer || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return KINDS.has(word) ? word : 'bug';
}

export async function GET() {
  try {
    const [reports, votingEnabled] = await Promise.all([
      tellmeDb(
        'jc_reports?select=id,created_at,body,context,source,status,gist,kind,ups,downs,category,fix_state,fix_pr_url,fix_target,fix_shipped_in,fix_ups,fix_downs,screenshot_url&order=created_at.desc&limit=200',
      ),
      tellmeVotingEnabled(),
    ]);
    // Which reports have a conversation on them, in one query rather than one
    // per card. Only the COUNT rides along: the board shows "the agent
    // explained why" and fetches the words themselves when someone opens it.
    let threads = {};
    try {
      const rows = await tellmeDb('jc_flags?key=like.notes:*&select=key,value');
      for (const row of rows || []) {
        const id = String(row.key).slice('notes:'.length);
        // Published notes only. The internal back and forth must not so much as
        // show up as a count on a public card.
        threads[id] = Array.isArray(row.value)
          ? row.value.filter((n) => n && n.author === 'public').length
          : 0;
      }
    } catch (_) {
      // A missing thread index costs a disclosure link, never the board.
    }

    // WHEN each report was first looked at, not merely whether. A card that
    // says "being looked at" with no date is indistinguishable from one that
    // has been sitting untouched for a month, which is the exact anxiety this
    // state exists to answer. Oldest run per report, because that is when the
    // looking started.
    const seen = {};
    try {
      const rows = await tellmeDb('jc_agent_runs?select=report_id,created_at&order=created_at.asc');
      for (const row of rows || []) {
        if (!seen[row.report_id]) seen[row.report_id] = row.created_at;
      }
    } catch (_) {}

    const withThreads = (reports || []).map((r) => ({
      ...r,
      notes: threads[r.id] || 0,
      lookedAt: seen[r.id] || null,
    }));
    return Response.json({ reports: withThreads, votingEnabled });
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

  // Both best effort and both capped by tellmeAI's own timeout, so the report
  // posts either way. In parallel because they read the same words and neither
  // needs the other's answer; sequentially they would double the wait before
  // the person sees their report land.
  const [gist, kind] = await Promise.all([
    tellmeAI(GIST_SYSTEM, text),
    classifyKind(text),
  ]);

  try {
    const rows = await tellmeDb('jc_reports', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: { body: text, context, source, gist, kind, screenshot_url: screenshot },
    });
    return Response.json({ report: rows?.[0] || null }, { status: 201 });
  } catch (_) {
    return Response.json(
      { error: "Couldn't save that right now. Please try again shortly." },
      { status: 503 },
    );
  }
}
