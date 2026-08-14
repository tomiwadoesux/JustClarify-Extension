// Shared plumbing for the /tellme routes: Supabase REST access with the
// service key, a tiny per-IP burst limiter, and one AI call used for both the
// paraphrase button and the "what the agent understood" gist.
//
// These routes are PUBLIC web endpoints (the report page is a normal page, so
// there is no extension-origin gate here) — which is exactly why every write
// path takes the burst limiter and hard length caps.

const MINUTE = 60_000;
const bursts = new Map(); // `${scope}:${ip}` -> number[]

export function tellmeBurstLimited(scope, request, perMinute) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0].trim() || 'unknown';
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const hits = (bursts.get(key) || []).filter((t) => now - t < MINUTE);
  hits.push(now);
  bursts.set(key, hits);
  if (bursts.size > 20_000) {
    for (const [k, times] of bursts) {
      if (!times.some((t) => now - t < MINUTE)) bursts.delete(k);
    }
  }
  return hits.length > perMinute;
}

function supabaseCreds() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

// One thin wrapper over PostgREST. Returns parsed JSON (or null for empty
// bodies); throws on non-2xx so callers can decide what to tell the user —
// the raw Supabase error text never leaves the server.
export async function tellmeDb(path, { method = 'GET', body, headers = {} } = {}) {
  const creds = supabaseCreds();
  if (!creds) throw new Error('storage-unconfigured');
  const response = await fetch(`${creds.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: creds.key,
      Authorization: `Bearer ${creds.key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[tellme] supabase', method, path, response.status, detail.slice(0, 300));
    throw new Error('storage-failed');
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function tellmeVotingEnabled() {
  try {
    const rows = await tellmeDb('jc_flags?key=eq.voting_enabled&select=value');
    return rows?.[0] ? rows[0].value === true : true;
  } catch (_) {
    return true; // a flag hiccup must not hide the buttons forever
  }
}

// --- the thread on a report --------------------------------------------------
//
// A blocked run often ends with the agent asking a question ("which text was in
// the pill?", "a screenshot would let me fix this precisely"). Without a way to
// answer, the only reply available is filing a second report, which loses the
// thread. These notes are that reply, and the agent reads them on a re-run.
//
// STORED IN jc_flags, which is a generic key-value table, because this
// deployment currently has no way to run DDL — the Supabase connector that
// created the other tables is not available, and PostgREST cannot create one.
// The proper schema is written out in ambient-explainer-backend/migrations/
// 002_report_notes.sql; when you can run it, this moves to a real table with a
// foreign key. The one thing lost meanwhile is cascade delete, so the admin
// delete action removes the notes key by hand.
const NOTES_KEY = (reportId) => `notes:${reportId}`;

export async function tellmeNotes(reportId) {
  try {
    const rows = await tellmeDb(
      `jc_flags?key=eq.${encodeURIComponent(NOTES_KEY(reportId))}&select=value`,
    );
    const value = rows?.[0]?.value;
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

export async function tellmeAddNote(reportId, note) {
  const notes = await tellmeNotes(reportId);
  // A cap, because this is one jsonb value rather than rows: a thread that grew
  // without limit would be re-read and re-written whole on every reply.
  const next = [...notes, note].slice(-40);
  await tellmeDb('jc_flags', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: { key: NOTES_KEY(reportId), value: next },
  });
  return next;
}

export async function tellmeDeleteNotes(reportId) {
  try {
    await tellmeDb(`jc_flags?key=eq.${encodeURIComponent(NOTES_KEY(reportId))}`, {
      method: 'DELETE',
    });
  } catch (_) {}
}

// Same call shape as /api/explain: AI Gateway, primary then fallback model,
// never forwarding upstream error text. Returns trimmed text or null.
export async function tellmeAI(system, user, maxTokens = 220) {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) return null;
  // Sonnet 5 first, because everything routed through here is PROSE a person
  // reads: the "this person means" line, the tidy-up on someone's own words,
  // the public explanation of an outcome. Writing quality is the entire product
  // of these calls, and it is a different skill from writing code — the agent
  // keeps Opus for patches (JC_AGENT_MODEL), this keeps Sonnet for sentences.
  // The cheaper two stay as fallbacks so a rate limit degrades rather than
  // fails.
  const models = [
    process.env.JC_WRITING_MODEL || 'anthropic/claude-sonnet-5',
    'openai/gpt-4o-mini',
    'google/gemini-2.5-flash-lite',
  ];
  for (const model of models) {
    try {
      const response = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_tokens: maxTokens,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        console.error('[tellme] ai', model, response.status);
        continue;
      }
      const data = await response.json();
      const text = (data?.choices?.[0]?.message?.content || '').trim();
      if (text) return text;
    } catch (error) {
      console.error('[tellme] ai', model, String(error).slice(0, 120));
    }
  }
  return null;
}
