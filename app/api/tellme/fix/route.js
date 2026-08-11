// The public view of what the agent actually wrote.
//
// Deliberately its own endpoint rather than fields on the report list: a diff
// can run to tens of kilobytes, and putting them all in the list would make
// opening the board download every fix ever proposed.
//
// Deliberately PUBLIC, too. Asking people to vote on whether a fix worked while
// hiding the fix from them is asking for a vote on trust, not on evidence. The
// repository is public and so is the pull request, so the diff was never the
// secret here.
//
// What it does NOT return: the run log or the error text. Those are for the
// dashboard. They carry stack traces, internal paths and upstream provider
// messages, none of which belong on a public page.

import { tellmeDb } from '@/lib/tellme';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!UUID_RE.test(id)) return Response.json({ error: 'Bad request.' }, { status: 400 });

  try {
    const reports = await tellmeDb(`jc_reports?id=eq.${id}&select=fix_state,fix_pr_url`);
    const report = reports?.[0];
    if (!report) return Response.json({ error: 'That report is gone.' }, { status: 404 });
    if (report.fix_state === 'none') {
      return Response.json({ error: 'No fix has been proposed for this one yet.' }, { status: 404 });
    }

    // Newest successful run for this report: the one whose pull request the
    // board is showing. A failed run's half-finished diff is not a candidate
    // fix and must never be presented as one.
    const runs = await tellmeDb(
      `jc_agent_runs?report_id=eq.${id}&status=eq.succeeded&select=summary,files,diff,pr_url,category,created_at&order=created_at.desc&limit=1`,
    );
    const run = runs?.[0];
    if (!run) return Response.json({ error: 'Nothing to show yet.' }, { status: 404 });

    return Response.json({
      summary: run.summary || '',
      files: Array.isArray(run.files) ? run.files : [],
      diff: (run.diff || '').slice(0, 60_000),
      prUrl: run.pr_url || report.fix_pr_url || null,
      category: run.category || null,
    });
  } catch (_) {
    return Response.json({ error: "Couldn't load that right now." }, { status: 503 });
  }
}
