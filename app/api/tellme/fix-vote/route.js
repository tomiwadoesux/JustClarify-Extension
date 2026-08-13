// The SECOND vote: "did this candidate fix actually solve it?"
//
// Kept apart from /api/tellme/vote on purpose. That one measures whether a
// problem is real and worth attention. This one measures whether a specific
// proposed fix worked for the people who had the problem. Merging the two
// numbers would make the board unable to tell a popular complaint from a
// working fix, which is the one distinction the whole loop depends on.
//
// Only reports with a candidate fix accept these votes, and the report is
// flipped to fixed (green) by consensus here rather than by the merge, so
// green means "the people who reported it say it works" and not "we shipped
// something".

import { tellmeDb, tellmeBurstLimited, tellmeVotingEnabled } from '@/lib/tellme';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Low, because it is a floor rather than a mandate: you can still flip a
// report green by hand in the dashboard the moment you are satisfied.
const CONFIRMATIONS_TO_GREEN = 2;

export async function POST(request) {
  if (tellmeBurstLimited('fix-vote', request, 20)) {
    return Response.json({ error: 'Easy now, one vote at a time.' }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }

  const id = String(body?.id || '');
  const voter = String(body?.voter || '').trim();
  const dir = body?.dir === -1 ? -1 : body?.dir === 1 ? 1 : 0;
  if (!UUID_RE.test(id) || !/^[a-zA-Z0-9-]{8,64}$/.test(voter) || !dir) {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }

  if (!(await tellmeVotingEnabled())) {
    return Response.json({ error: 'Voting is switched off right now.' }, { status: 403 });
  }

  try {
    const rows = await tellmeDb(`jc_reports?id=eq.${id}&select=fix_state,status,fix_target,fix_shipped_in`);
    const report = rows?.[0];
    if (!report) return Response.json({ error: 'That report is gone.' }, { status: 404 });
    if (report.fix_state === 'none') {
      return Response.json(
        { error: 'There is no proposed fix to judge on this one yet.' },
        { status: 409 },
      );
    }
    // An extension fix is not in anyone's hands until a new version clears the
    // store, so a vote before then would be judging code nobody can run. The
    // admin flips fix_shipped_in when the release actually goes out. Mirrored
    // in the page, but enforced here so the UI cannot be talked around.
    if (
      (report.fix_target === 'extension' || report.fix_target === 'mixed') &&
      !report.fix_shipped_in
    ) {
      return Response.json(
        { error: 'This fix arrives with the next extension update. Voting opens once it ships.' },
        { status: 409 },
      );
    }

    const counts = (await tellmeDb('rpc/jc_fix_vote', {
      method: 'POST',
      body: { p_report: id, p_voter: voter, p_dir: dir },
    }))?.[0];
    if (!counts) return Response.json({ error: 'That report is gone.' }, { status: 404 });

    // Consensus flips it green. Confirmations have to outnumber denials, so a
    // fix that some people say did not work stays red and visible.
    const confirmed =
      counts.ups >= CONFIRMATIONS_TO_GREEN && counts.ups > counts.downs;
    if (confirmed && report.status !== 'fixed') {
      await tellmeDb(`jc_reports?id=eq.${id}`, {
        method: 'PATCH',
        body: { status: 'fixed', fix_state: 'verified' },
      });
    }

    return Response.json({
      ups: counts.ups,
      downs: counts.downs,
      status: confirmed ? 'fixed' : report.status,
    });
  } catch (_) {
    return Response.json({ error: "The vote didn't stick. Try again." }, { status: 503 });
  }
}
