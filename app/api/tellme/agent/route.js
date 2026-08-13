// Start an agent run against a report, and read back how it went.
//
// Admin-gated on both verbs, deliberately. The community decides WHAT is worth
// fixing by voting; only you decide what gets attempted, and only you merge the
// result. Opening this endpoint up would hand strangers the ability to spend
// model budget and open pull requests on your repository.
//
// POST { key, reportId }  -> starts a run, returns immediately with its id
// GET  ?key=…&reportId=…  -> the runs for a report, newest first

import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { tellmeDb } from '@/lib/tellme';
import { runAgent } from '@/lib/agent/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The ceiling, because an agent run genuinely needs minutes: a site patch pays
// for npm install and a Next build, and a UI patch pays for a Chromium install
// plus two harness renders. Extension-only wording fixes finish in about one.
export const maxDuration = 800;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function keyMatches(given) {
  const expected = process.env.JC_ADMIN_KEY || '';
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request) {
  const url = new URL(request.url);
  if (!keyMatches(url.searchParams.get('key'))) {
    return Response.json({ error: 'Wrong admin key.' }, { status: 401 });
  }
  const reportId = url.searchParams.get('reportId') || '';
  const filter = UUID_RE.test(reportId) ? `&report_id=eq.${reportId}` : '';
  try {
    const runs = await tellmeDb(
      `jc_agent_runs?select=id,report_id,created_at,finished_at,status,category,autonomy,summary,files,branch,pr_url,log,error,diff&order=created_at.desc&limit=25${filter}`,
    );
    return Response.json({ runs: runs || [] });
  } catch (_) {
    return Response.json({ error: "Couldn't read the runs." }, { status: 503 });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }

  if (!keyMatches(body?.key)) {
    return Response.json({ error: 'Wrong admin key.' }, { status: 401 });
  }

  const reportId = String(body?.reportId || '');
  if (!UUID_RE.test(reportId)) {
    return Response.json({ error: 'Bad report id.' }, { status: 400 });
  }

  let report;
  try {
    const rows = await tellmeDb(`jc_reports?id=eq.${reportId}&select=id,body,context,gist,status`);
    report = rows?.[0];
  } catch (_) {
    return Response.json({ error: "Couldn't load that report." }, { status: 503 });
  }
  if (!report) return Response.json({ error: 'No such report.' }, { status: 404 });

  // One run at a time per report, so a double click cannot open two pull
  // requests for the same problem.
  try {
    const live = await tellmeDb(
      `jc_agent_runs?report_id=eq.${reportId}&status=in.(queued,running)&select=id`,
    );
    if (live?.length) {
      return Response.json({ error: 'A run is already going for this report.', runId: live[0].id }, { status: 409 });
    }
  } catch (_) {}

  let runId;
  try {
    const rows = await tellmeDb('jc_agent_runs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: { report_id: reportId, status: 'queued' },
    });
    runId = rows?.[0]?.id;
  } catch (_) {
    return Response.json({ error: "Couldn't start a run." }, { status: 503 });
  }
  if (!runId) return Response.json({ error: "Couldn't start a run." }, { status: 503 });

  // Deliberately NOT awaited: a run takes minutes and the dashboard polls GET
  // for progress, so this returns as soon as there is a run id to watch.
  // waitUntil is what keeps the function alive to finish the work after the
  // response has gone out; without it the platform is free to freeze mid-run.
  // Errors inside runAgent are written to the run row, never thrown at here.
  waitUntil(
    runAgent({ runId, report }).catch((error) => {
      console.error('[agent] unhandled', error);
    }),
  );

  return Response.json({ runId, status: 'queued' }, { status: 202 });
}
