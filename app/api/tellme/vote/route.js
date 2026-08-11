// One vote per person per report, atomically, via the jc_report_vote RPC:
// same direction again retracts, the other direction switches. The voter id
// is a random client-generated string — a bucket key, never an identity.

import { tellmeDb, tellmeBurstLimited, tellmeVotingEnabled } from '@/lib/tellme';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request) {
  if (tellmeBurstLimited('vote', request, 20)) {
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
    const rows = await tellmeDb('rpc/jc_report_vote', {
      method: 'POST',
      body: { p_report: id, p_voter: voter, p_dir: dir },
    });
    const counts = rows?.[0];
    if (!counts) return Response.json({ error: 'That report is gone.' }, { status: 404 });
    return Response.json({ ups: counts.ups, downs: counts.downs });
  } catch (_) {
    return Response.json({ error: "The vote didn't stick. Try again." }, { status: 503 });
  }
}
