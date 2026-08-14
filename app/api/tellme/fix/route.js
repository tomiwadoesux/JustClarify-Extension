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

import { tellmeDb, tellmeNotes } from '@/lib/tellme';

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

    // Newest run that ended in something worth showing. A SUCCEEDED run carries
    // a fix; a BLOCKED one carries the agent's reasoning for not writing one,
    // and that is published too — "the agent looked and here is what it found"
    // is a real answer to a report, and hiding it makes a considered refusal
    // look identical to nobody having bothered. A FAILED run is neither: its
    // half-finished diff is not a candidate fix and its error text is plumbing.
    const runs = await tellmeDb(
      `jc_agent_runs?report_id=eq.${id}&status=in.(succeeded,blocked)&select=status,summary,files,diff,pr_url,category,created_at,shots&order=created_at.desc&limit=1`,
    );
    const run = runs?.[0];

    // ONLY the published outcome. The agent's detailed findings and the
    // maintainer's replies are working material in the dashboard, and a
    // half-finished conversation shown as a verdict reads worse than nothing.
    // A note becomes public exactly when someone presses Publish.
    const notes = (await tellmeNotes(id)).filter((n) => n.author === 'public');

    if (!run) {
      if (!notes.length) return Response.json({ error: 'Nothing to show yet.' }, { status: 404 });
      return Response.json({ blocked: false, notes });
    }

    if (run.status === 'blocked') {
      return Response.json({
        blocked: true,
        // No internal summary, no diff, no files, no pull request, and never
        // the run's error field. If nothing has been published yet, the board
        // shows that it is still being looked at.
        category: run.category || null,
        notes,
      });
    }

    const shots = run.shots && typeof run.shots === 'object' ? run.shots : {};
    return Response.json({
      blocked: false,
      summary: run.summary || '',
      files: Array.isArray(run.files) ? run.files : [],
      diff: (run.diff || '').slice(0, 60_000),
      prUrl: run.pr_url || report.fix_pr_url || null,
      category: run.category || null,
      // The harness renders: what the UI looked like before the patch and
      // after it, from identical fixture state, so the images differ only by
      // the fix. Present only on UI runs that managed to render.
      before: typeof shots.before === 'string' ? shots.before : null,
      after: typeof shots.after === 'string' ? shots.after : null,
      notes,
    });
  } catch (_) {
    return Response.json({ error: "Couldn't load that right now." }, { status: 503 });
  }
}
