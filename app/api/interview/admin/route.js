// Everything the interview board can do, gated by JC_ADMIN_KEY.
//
// POST { key, action, ... }. The key travels in the JSON body, never in a query
// string, so it does not end up in logs or browser history.
//
//   check            prove the key
//   overview         open/closed, today's spend, heartbeat age, the aggregate
//   sessions         the list
//   session          one transcript
//   extract          (re)summarise one session
//   extract-pending  summarise up to five that were never summarised
//   delete           remove one session and its turns (a student's request)
//   links            list share links
//   link-create      make one
//   link-set         switch one on or off
//   enabled          open or close the whole interview

import { randomBytes } from 'node:crypto';
import { TOPICS, LIMITS, MODELS, caps, linkRequired, hardDisabled } from '@/lib/interview/config.mjs';
import { aggregate } from '@/lib/interview/aggregate.mjs';
import { refCode } from '@/lib/interview/ref.mjs';
import { adminKeyMatches, burst, json } from '@/lib/interview/guard';
import {
  admin as interviewAdmin,
  store as interviewStore,
  enabledFlag,
  setEnabled,
  memoryMode,
  interviewEngine,
} from '@/lib/interview/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const { UUID_RE } = interviewAdmin;
const CODE_RE = /^[a-z0-9-]{4,40}$/;

function slug(label) {
  const base = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  // Random tail so a link cannot be guessed from the group's name.
  return `${base || 'link'}-${randomBytes(4).toString('hex')}`;
}

function listRow(session) {
  const summary = session.summary && !session.summary.empty ? session.summary : null;
  return {
    id: session.id,
    ref: refCode(session.id),
    created_at: session.created_at,
    link_code: session.link_code,
    status: session.status,
    stop_reason: session.stop_reason,
    // The question the student had reached when the session stopped.
    reached: session.turn,
    degraded: !!session.safety_degraded,
    extracted: !!session.extracted_at,
    extract_error: session.extract_error || null,
    gist: summary?.gist || null,
    topics: summary ? summary.topics.map((t) => ({ topic: t.topic, unprompted: t.unprompted, severity: t.severity })) : [],
  };
}

export async function POST(request) {
  if (burst('admin', request, 60)) return json({ error: 'Too many requests.' }, 429);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: 'Bad request.' }, 400);
  }
  if (!adminKeyMatches(body?.key)) return json({ error: 'Wrong admin key.' }, 401);

  const action = body?.action;
  try {
    if (action === 'check') return json({ ok: true });

    if (action === 'overview') {
      const [enabled, sessions, usage, recent, heartbeat, links] = await Promise.all([
        enabledFlag({ fresh: true }),
        interviewAdmin.sessions(),
        interviewAdmin.usageToday(),
        interviewAdmin.usageRecent(),
        interviewAdmin.heartbeat(),
        interviewAdmin.links(),
      ]);
      return json({
        ok: true,
        enabled,
        hardDisabled: hardDisabled(),
        memoryMode,
        linkRequired: linkRequired(),
        caps: caps(),
        limits: { maxTurns: LIMITS.maxTurns, minutes: LIMITS.minutes },
        models: MODELS,
        topics: TOPICS.map((t) => ({ key: t.key, label: t.label })),
        usage,
        recent: recent || [],
        heartbeat,
        links: links || [],
        stats: aggregate(sessions || []),
        sessions: (sessions || []).map(listRow),
      });
    }

    if (action === 'session') {
      const id = String(body?.id || '');
      if (!UUID_RE.test(id)) return json({ error: 'Bad id.' }, 400);
      const loaded = await interviewStore.load(id);
      if (!loaded) return json({ error: 'No such session.' }, 404);
      return json({ ok: true, ref: refCode(id), ...loaded });
    }

    if (action === 'extract') {
      const id = String(body?.id || '');
      if (!UUID_RE.test(id)) return json({ error: 'Bad id.' }, 400);
      const result = await interviewEngine.extract(id);
      return json({ ok: result.status === 'ok' || result.status === 'empty', status: result.status });
    }

    if (action === 'extract-pending') {
      const rows = (await interviewAdmin.pending(5)) || [];
      const results = [];
      for (const row of rows) {
        const result = await interviewEngine.extract(row.id).catch(() => ({ status: 'failed' }));
        results.push(result.status);
      }
      return json({ ok: true, ran: results.length, results });
    }

    if (action === 'delete') {
      const id = String(body?.id || '');
      if (!UUID_RE.test(id)) return json({ error: 'Bad id.' }, 400);
      await interviewAdmin.remove(id);
      return json({ ok: true });
    }

    if (action === 'links') {
      return json({ ok: true, links: (await interviewAdmin.links()) || [] });
    }

    if (action === 'link-create') {
      const label = String(body?.label || '').trim().slice(0, 120);
      if (!label) return json({ error: 'Give the link a label, such as the group it is for.' }, 400);
      const maxSessions = Math.min(5000, Math.max(1, Number.parseInt(body?.max, 10) || 60));
      const days = Number.parseInt(body?.days, 10);
      const expiresAt = Number.isFinite(days) && days > 0
        ? new Date(Date.now() + Math.min(days, 365) * 86_400_000).toISOString()
        : null;
      const wanted = String(body?.code || '').trim().toLowerCase();
      const code = CODE_RE.test(wanted) ? wanted : slug(label);
      const rows = await interviewAdmin.createLink({ code, label, maxSessions, expiresAt });
      return json({ ok: true, link: rows?.[0] || { code, label } });
    }

    if (action === 'link-set') {
      const code = String(body?.code || '');
      if (!CODE_RE.test(code)) return json({ error: 'Bad link code.' }, 400);
      await interviewAdmin.setLink(code, { active: body?.active === true });
      return json({ ok: true });
    }

    if (action === 'enabled') {
      await setEnabled(body?.on === true);
      return json({ ok: true, enabled: body?.on === true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (error) {
    console.error('[api/interview/admin]', action, String(error?.message || error).slice(0, 120));
    return json({ error: 'That did not work. The database may be unreachable.' }, 503);
  }
}
