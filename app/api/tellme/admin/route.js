// Admin actions for the tellme board, gated by JC_ADMIN_KEY (set in Vercel,
// never shipped to a client). Everything the dashboard can do goes through
// here: flip a report open/fixed, delete one, and switch voting on or off.

import { timingSafeEqual } from 'node:crypto';
import {
  tellmeDb,
  tellmeBurstLimited,
  tellmeAddNote,
  tellmeDeleteNotes,
  tellmeNotes,
  tellmeAI,
} from '@/lib/tellme';

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
      // Notes live in jc_flags rather than a table with a foreign key, so the
      // cascade a real schema would give us has to happen here. See tellme.js.
      await tellmeDeleteNotes(id);
      return Response.json({ ok: true });
    }

    // The WHOLE thread, every author. The dashboard cannot read it from the
    // public endpoint, which deliberately serves only what has been published —
    // and reading it from there is exactly the bug this action fixes: replies
    // saved correctly, the agent read them on the next run, and the dashboard
    // showed nothing, so the only visible evidence said the feature was broken.
    if (action === 'notes') {
      const id = String(body?.id || '');
      if (!UUID_RE.test(id)) return Response.json({ error: 'Bad id.' }, { status: 400 });
      return Response.json({ ok: true, notes: await tellmeNotes(id) });
    }

    // Answering the agent. A blocked run usually ends with a question, and the
    // reply is both published on the board and read by the NEXT run, so "here
    // is the screenshot you asked for" actually changes what it does rather
    // than disappearing into a comment box.
    if (action === 'note') {
      const id = String(body?.id || '');
      if (!UUID_RE.test(id)) return Response.json({ error: 'Bad id.' }, { status: 400 });
      const text = String(body?.body || '').trim().slice(0, 4000);
      if (text.length < 1) return Response.json({ error: 'Write something first.' }, { status: 400 });
      const notes = await tellmeAddNote(id, {
        author: 'admin',
        body: text,
        at: new Date().toISOString(),
      });
      return Response.json({ ok: true, notes });
    }

    // Marks the moment a candidate fix is actually in users' hands, which is
    // when the board's "did this fix it?" vote becomes a fair question. For an
    // extension fix that is the store version that carries it ("v0.6.2"); for
    // a site fix it just means merged and deployed. Send an empty version to
    // take it back (a release pulled from the store, a bad mark).
    if (action === 'shipped') {
      const id = String(body?.id || '');
      if (!UUID_RE.test(id)) return Response.json({ error: 'Bad id.' }, { status: 400 });
      const version = String(body?.version || '').trim().slice(0, 60) || null;
      await tellmeDb(`jc_reports?id=eq.${id}`, {
        method: 'PATCH',
        body: { fix_shipped_in: version },
      });
      return Response.json({ ok: true, version });
    }

    // The outcome, in public. Everything before this — the agent's detailed
    // findings, your replies, the back and forth — is working material and
    // stays in this dashboard. What the board gets is one short account of how
    // it ended, written after you have decided, because a conversation in
    // progress read as a verdict is worse than silence.
    //
    // Sonnet writes it rather than Opus: this is prose for a stranger, not code.
    if (action === 'publish') {
      const id = String(body?.id || '');
      if (!UUID_RE.test(id)) return Response.json({ error: 'Bad id.' }, { status: 400 });

      const reports = await tellmeDb(
        `jc_reports?id=eq.${id}&select=body,status,fix_state,fix_shipped_in,fix_target`,
      );
      const report = reports?.[0];
      if (!report) return Response.json({ error: 'No such report.' }, { status: 404 });

      const runs = await tellmeDb(
        `jc_agent_runs?report_id=eq.${id}&select=status,summary,files&order=created_at.desc&limit=1`,
      );
      const run = runs?.[0];
      const thread = await tellmeNotes(id);

      // A steer you typed wins over anything generated: sometimes the true
      // reason is a product decision the agent never saw.
      const steer = String(body?.steer || '').trim().slice(0, 2000);

      const fixed = report.status === 'fixed' || report.fix_state !== 'none';
      const shipped = report.fix_shipped_in;

      const text = await tellmeAI(
        'You write the public outcome of one bug report for a board that anyone can read. ' +
          'Two to four sentences, plain language, no jargon, no file names, no code, no em dashes. ' +
          'Address the person who reported it. ' +
          (fixed
            ? 'This one WAS fixed: say what now happens differently, in terms of what they will see. ' +
              (shipped
                ? `It shipped in ${shipped}, so say so.`
                : 'It is merged but not yet in a released version, so say it is on the way.')
            : 'This one was NOT fixed: say plainly why, without blaming them, and say what would ' +
              'let it be fixed if anything would. Do not promise a timeline.'),
        [
          `The report: ${report.body}`,
          run?.summary ? `What the agent found (internal, do not quote file names): ${run.summary}` : '',
          thread.length
            ? `The conversation since:\n${thread.map((n) => `${n.author}: ${n.body}`).join('\n')}`
            : '',
          steer ? `The maintainer's final word, which outranks everything above: ${steer}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        400,
      );

      if (!text) {
        return Response.json(
          { error: "Couldn't write the summary just now. Try again in a moment." },
          { status: 503 },
        );
      }

      const notes = await tellmeAddNote(id, {
        author: 'public',
        body: text,
        at: new Date().toISOString(),
      });
      return Response.json({ ok: true, published: text, notes });
    }

    // Overrule the classifier. It runs on one sentence at post time with no
    // knowledge of the product, so it will sometimes read a wish as a fault or
    // file a real report away as chatter. That last case is the one that
    // matters: a bug in the filtered drawer is a bug nobody sees, so the fix
    // for it has to be one click from the dashboard.
    if (action === 'kind') {
      const id = String(body?.id || '');
      if (!UUID_RE.test(id)) return Response.json({ error: 'Bad id.' }, { status: 400 });
      const kind = String(body?.kind || '');
      if (!['bug', 'suggestion', 'filtered'].includes(kind)) {
        return Response.json({ error: 'Not a kind.' }, { status: 400 });
      }
      await tellmeDb(`jc_reports?id=eq.${id}`, { method: 'PATCH', body: { kind } });
      return Response.json({ ok: true, kind });
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
