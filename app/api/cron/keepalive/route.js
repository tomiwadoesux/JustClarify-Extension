// Keeps the Supabase project awake.
//
// Supabase pauses a free-tier project after about a week with no activity,
// and a paused project takes everything down with it: the report board, the
// usage meter and the interview. It already happened once (November 2026: the
// project's address stopped resolving and /api/tellme returned 503 until it
// was restored by hand).
//
// Vercel calls this once a day (see vercel.json). It does one read and one
// write, sweeps interview sessions whose clock ran out, and deletes interview
// answers older than the 12 months the privacy policy promises. No model calls.
//
// The write is a heartbeat the interview board displays. If this cron ever
// stops running, the board shows the heartbeat going stale, so a dead
// keep-alive is visible before the pause rather than after it.
//
// This is a workaround, not a guarantee. The only thing that removes pausing
// is a paid Supabase plan.
//
// Auth: Vercel sends "Authorization: Bearer $CRON_SECRET" on cron invocations
// when that env var is set. Anything else gets a 401.

import { cronAuthorised, json } from '@/lib/interview/guard';
import { keepAlive } from '@/lib/interview/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!cronAuthorised(request)) return json({ error: 'Unauthorised.' }, 401);
  try {
    const result = await keepAlive();
    return json({ ok: true, ...result });
  } catch (error) {
    // A 500 here shows up as a failed cron run in the Vercel dashboard, which
    // is the alarm: the project is already unreachable.
    console.error('[api/cron/keepalive]', String(error?.message || error).slice(0, 120));
    return json({ ok: false, error: 'Database unreachable.' }, 500);
  }
}
