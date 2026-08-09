// Mints a short-lived AI Gateway realtime credential for the extension.
//
// The extension cannot hold AI_GATEWAY_API_KEY: a .crx is a zip anyone can
// open, and a leaked realtime key bills by the audio-minute rather than by the
// token. So the key stays here and the browser only ever sees a single-use
// secret that Gateway hands back from getToken().
//
// Extension -> here:  POST { model? }        (no body is fine — defaults apply)
// here -> extension:  { url, protocols, model, expiresIn }
//
// `protocols` is the WebSocket subprotocol array the client passes straight to
// `new WebSocket(url, protocols)`. Building it here rather than in the
// extension is deliberate: it keeps @ai-sdk/gateway (and therefore a bundler)
// out of an extension that currently ships raw, unbundled files.

import { gateway, getGatewayRealtimeProtocols } from '@ai-sdk/gateway';

export const runtime = 'nodejs';
// A minted token is single-use and short-lived, so this route must never be
// statically optimised or cached at the edge.
export const dynamic = 'force-dynamic';

// Callers pick a model by name, never by slug, so a stolen endpoint can't be
// pointed at the most expensive model on the platform. Add to this map to offer
// a new one; anything unlisted falls back to the default.
const MODELS = {
  // Speech-to-speech, handles transcription and tool calls. The default.
  fast: 'openai/gpt-realtime-mini',
  // Better reasoning for follow-up questions about a page, more per minute.
  quality: 'openai/gpt-realtime-2.1',
  // Speech-to-speech ONLY — no transcription, no translation. Cheap and quick
  // for pure command work where the transcript isn't needed.
  command: 'xai/grok-voice-think-fast-2.0',
};
const DEFAULT_MODEL = 'fast';

// Only JustClarify may mint tokens. Unpacked builds get a fresh id on every
// load, so development is allowed to skip the check — but a deployment without
// JC_EXTENSION_IDS set is an open faucet, and says so in the response.
const ALLOWED_IDS = (process.env.JC_EXTENSION_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

function originAllowed(origin) {
  if (!origin || !origin.startsWith('chrome-extension://')) return false;
  if (!ALLOWED_IDS.length) return process.env.NODE_ENV !== 'production';
  return ALLOWED_IDS.some((id) => origin === `chrome-extension://${id}`);
}

// Reflecting the caller's origin (rather than "*") is what lets the extension
// send credentials later if this ever grows an auth cookie.
function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// Coarse per-IP throttle. Deliberately in-memory: it costs nothing, survives
// long enough on Fluid Compute (instances are reused across requests) to blunt
// a naive script, and needs no new infrastructure to ship.
//
// It is NOT a real rate limiter — instances are per-region and recycle, so a
// determined caller gets a fresh bucket by waiting or by hitting another
// region. Before this endpoint is public, move the bucket to Upstash Redis.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6; // a session lasts up to 25 min; nobody needs 6/min
const buckets = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const hits = (buckets.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  buckets.set(ip, hits);

  // Opportunistic sweep so a long-lived instance doesn't grow a bucket per IP
  // forever. Cheap because it only runs when the map is already large.
  if (buckets.size > 5000) {
    for (const [key, times] of buckets) {
      if (!times.some((t) => now - t < WINDOW_MS)) buckets.delete(key);
    }
  }

  return hits.length > MAX_PER_WINDOW;
}

function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  return forwarded.split(',')[0].trim() || 'unknown';
}

export async function OPTIONS(request) {
  return new Response(null, {
    status: 204,
    headers: cors(request.headers.get('origin')),
  });
}

export async function POST(request) {
  const origin = request.headers.get('origin');
  const headers = { ...cors(origin), 'content-type': 'application/json' };

  if (!originAllowed(origin)) {
    return Response.json(
      { error: 'This endpoint only mints tokens for the JustClarify extension.' },
      { status: 403, headers },
    );
  }

  if (rateLimited(clientIp(request))) {
    return Response.json(
      { error: 'Too many voice sessions started. Wait a minute, then try again.' },
      { status: 429, headers },
    );
  }

  // A body is optional — an empty POST gets the default model.
  let body = {};
  try {
    body = await request.json();
  } catch (_) {}

  const model = MODELS[body?.model] || MODELS[DEFAULT_MODEL];

  try {
    const { token, url } = await gateway.experimental_realtime.getToken({ model });
    return Response.json(
      {
        url,
        // Ready to hand to `new WebSocket(url, protocols)`.
        protocols: getGatewayRealtimeProtocols(token),
        model,
      },
      { status: 200, headers },
    );
  } catch (error) {
    // Never echo the provider error verbatim — it can carry key fragments and
    // account detail. Log the real one, hand back something safe to show.
    console.error('[realtime/token] getToken failed:', error);
    const status = error?.statusCode === 402 ? 402 : 502;
    return Response.json(
      {
        error:
          status === 402
            ? 'Voice mode is out of credit for now.'
            : "Couldn't start a voice session. Try again in a moment.",
      },
      { status, headers },
    );
  }
}
