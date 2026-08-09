// Hosted model access for JustClarify installs that have no engine of their own.
//
// The engine chain in the extension is: Chrome's built-in model → the user's
// own Gateway key → here. This tier exists for the machines that fail the
// on-device bar (16GB RAM, 4GB VRAM, 22GB free disk) and whose owners have no
// reason to go get an API key. Without it, those users install the extension
// and it simply doesn't work.
//
// AI_GATEWAY_API_KEY stays on this server. The extension never sees it — that
// is the entire reason this route exists rather than the key being shipped in
// the bundle, where any user could unzip it and spend it.
//
// Extension -> here:  POST { messages: [{role, content}], reqId? }
//                     header: x-jc-install (opaque per-install id)
// here -> extension:  the upstream SSE stream, proxied verbatim, so the client
//                     parses exactly what it already parses for BYOK.

import { guard, cors } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Chosen here, never by the caller. A hosted tier that honoured a client's
// model field would be a free pass to the most expensive model on the platform.
// Fast and cheap by design: this tier is on JustClarify's bill for every user
// without an engine of their own, which is most of them.
//
// Measured on the classifier prompt this route serves (JSON out, 120 tokens):
//   gpt-4o-mini             861ms   correct JSON
//   gemini-2.5-flash-lite  1077ms   correct JSON
//   qwen3.7-flash          6712ms   correct JSON
//   gpt-5-nano             2842ms   EMPTY
// gpt-5-nano is a reasoning model: the token budget goes on hidden reasoning
// before any output, so short-cap calls come back blank, and it rejects
// response_format json_object outright. Cheaper per token, useless here.
const HOSTED_MODEL = 'openai/gpt-4o-mini';
// When the primary has a moment — a 500, a 429, a dropped connection — the ask
// is retried once on a different provider before anything is shown to the
// user. "The model couldn't answer that. Try again in a moment." was reaching
// people whose device engine had already fallen back here: two engines deep,
// the answer to a transient upstream hiccup should be a second model, not an
// error asking the human to be the retry loop. gemini-2.5-flash-lite is the
// measured runner-up above (1077ms, correct JSON).
const HOSTED_FALLBACK_MODEL = 'google/gemini-2.5-flash-lite';
const MAX_TOKENS = 700;
// Callers that need less (a classifier answering with one JSON object) may ask
// for less. Nobody may ask for more.
const MIN_TOKENS = 32;
const MAX_MESSAGES = 14;
const MAX_CHARS = 12_000; // whole conversation, after which the oldest go

// Trust nothing about shape: role must be one we expect and content must be a
// string, because whatever arrives here is forwarded to a paid API.
function sanitize(messages) {
  if (!Array.isArray(messages)) return null;

  const clean = [];
  for (const message of messages) {
    const role = message?.role;
    const content = message?.content;
    if (!['system', 'user', 'assistant'].includes(role)) continue;
    if (typeof content !== 'string' || !content.trim()) continue;
    clean.push({ role, content });
  }
  if (!clean.length) return null;

  // Trim from the front — the oldest turns are the ones worth losing.
  let trimmed = clean.slice(-MAX_MESSAGES);
  while (
    trimmed.length > 1 &&
    trimmed.reduce((n, m) => n + m.content.length, 0) > MAX_CHARS
  ) {
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

export async function OPTIONS(request) {
  return new Response(null, { status: 204, headers: cors(request.headers.get('origin')) });
}

export async function POST(request) {
  // metered: this is the scope the paywall counts. Speech and transcription
  // ride along with asks that already counted here.
  const { headers, reject } = await guard(request, {
    scope: 'explain',
    perMinute: 12,
    perDay: 200,
    metered: true,
  });
  if (reject) return reject;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return Response.json({ error: 'Bad request.' }, { status: 400, headers });
  }

  const messages = sanitize(body?.messages);
  if (!messages) return Response.json({ error: 'Nothing to answer.' }, { status: 400, headers });

  // Explanations stream into a popup; classification and claim extraction are
  // one short object each and have nowhere to stream to. Same route, same
  // limiter, because they draw on the same budget.
  const stream = body?.stream !== false;
  const maxTokens = Math.min(
    MAX_TOKENS,
    Math.max(MIN_TOKENS, Number(body?.maxTokens) || MAX_TOKENS),
  );
  const jsonOnly = body?.json === true;

  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) {
    return Response.json({ error: 'Hosted AI is not configured.' }, { status: 503, headers });
  }

  const callModel = async (model) => {
    return fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream,
        max_tokens: maxTokens,
        // A classifier that improvises is a bug; prose that doesn't is dull.
        temperature: jsonOnly ? 0 : 0.4,
        // NO response_format. The Gateway's OpenAI-compatible endpoint rejects
        // it outright — `400 invalid_request_error, param: response_format` —
        // whatever the model. Temperature 0 plus a prompt that demands JSON is
        // the whole mechanism; every caller's parser already tolerates the
        // ```json fences that come back without it.
      }),
    });
  };

  // Primary, then the fallback model — a transient upstream failure must be
  // absorbed here, not exported to the user as "try again". 402 short-circuits:
  // out of credit is account-level truth, and a second model spends from the
  // same empty account.
  let upstream = null;
  for (const model of [HOSTED_MODEL, HOSTED_FALLBACK_MODEL]) {
    try {
      upstream = await callModel(model);
    } catch (_) {
      upstream = null;
      continue;
    }
    if (upstream.ok && (!stream || upstream.body)) break;
    if (upstream.status === 402) break;
    // Never forward the upstream body — it can carry account detail and key
    // fragments. Log the real thing, try the next model.
    const detail = await upstream.text().catch(() => '');
    console.error('[api/explain] upstream', model, upstream.status, detail.slice(0, 400));
  }

  if (!upstream) {
    return Response.json({ error: "Couldn't reach the model." }, { status: 502, headers });
  }

  if (!upstream.ok || (stream && !upstream.body)) {
    return Response.json(
      {
        error:
          upstream.status === 402
            ? 'Hosted AI is out of credit for now. Add your own key in the popup to keep going.'
            : upstream.status === 429
              ? 'The model is getting a lot of traffic right now — give it a few seconds and ask again.'
              : "The model couldn't answer that. Try again in a moment.",
      },
      { status: upstream.status === 402 ? 402 : 502, headers },
    );
  }

  if (!stream) {
    // One object back, no SSE to parse on the other side.
    try {
      const data = await upstream.json();
      return Response.json(
        { text: (data?.choices?.[0]?.message?.content || '').trim() },
        { status: 200, headers },
      );
    } catch (_) {
      return Response.json({ error: 'The model returned nothing usable.' }, { status: 502, headers });
    }
  }

  // Proxy the SSE straight through: the extension already parses this exact
  // format for its own key, so the hosted tier needs no separate client parser.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...headers,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
