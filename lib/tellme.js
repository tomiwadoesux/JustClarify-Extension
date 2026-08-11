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

// Same call shape as /api/explain: AI Gateway, primary then fallback model,
// never forwarding upstream error text. Returns trimmed text or null.
export async function tellmeAI(system, user, maxTokens = 220) {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) return null;
  for (const model of ['openai/gpt-4o-mini', 'google/gemini-2.5-flash-lite']) {
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
