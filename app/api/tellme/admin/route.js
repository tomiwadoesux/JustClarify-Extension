// Admin actions for the tellme board, gated by JC_ADMIN_KEY (set in Vercel,
// never shipped to a client). Everything the dashboard can do goes through
// here: flip a report open/fixed, delete one, and switch voting on or off.

import { timingSafeEqual } from 'node:crypto';
import { tellmeDb, tellmeBurstLimited } from '@/lib/tellme';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function keyMatches(given) {
  const expected = process.env.JC_ADMIN_KEY || '';
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request) {
  if (tellmeBurstLimited('admin', request, 30)) {
    return Response.json({ error: 'Too many requests.' }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }

  if (!keyMatches(body?.key)) {
    return Response.json({ error: 'Wrong admin key.' }, { status: 401 });
  }

  const action = body?.action;
  try {
    // The login probe: proves the key without touching anything.
    if (action === 'check') return Response.json({ ok: true });

    if (action === 'status') {
      const id = String(body?.id || '');
      const status = body?.status === 'fixed' ? 'fixed' : 'open';
      if (!UUID_RE.test(id)) return Response.json({ error: 'Bad id.' }, { status: 400 });
      await tellmeDb(`jc_reports?id=eq.${id}`, { method: 'PATCH', body: { status } });
      return Response.json({ ok: true, status });
    }

    if (action === 'delete') {
      const id = String(body?.id || '');
      if (!UUID_RE.test(id)) return Response.json({ error: 'Bad id.' }, { status: 400 });
      await tellmeDb(`jc_reports?id=eq.${id}`, { method: 'DELETE' });
      return Response.json({ ok: true });
    }

    if (action === 'voting') {
      const enabled = body?.enabled === true;
      await tellmeDb('jc_flags', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: { key: 'voting_enabled', value: enabled },
      });
      return Response.json({ ok: true, enabled });
    }

    return Response.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (_) {
    return Response.json({ error: "That didn't stick. Try again." }, { status: 503 });
  }
}
