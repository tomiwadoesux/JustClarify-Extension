// providers.js — the user's own API key, sent straight to the company it
// belongs to.
//
// The key field used to accept only a Vercel AI Gateway key, which quietly
// required everyone to have a Vercel account before their "own key" meant
// anything. Now the ordinary case is the ordinary key: paste the Anthropic /
// OpenAI / Gemini / Hugging Face key you already have, and requests go DIRECT
// to that provider — never through a JustClarify server, never through Vercel.
// A Gateway key (vck_…) still works and routes through gateway.js unchanged;
// it is one option among the providers rather than the gate in front of them.
//
// WHICH provider a key belongs to is read off the key itself. Providers prefix
// their keys exactly so that tools can do this, and it spares the user a
// dropdown they'd have to already understand to answer:
//   sk-ant-…  Anthropic       AIza…  Google Gemini
//   vck_…     Vercel Gateway  hf_…   Hugging Face
//   sk-…      OpenAI (after sk-ant- has been ruled out)
//
// Imported by background.js (importScripts), worker-side only — an MV3 content
// script carries the PAGE's origin and gets refused; the worker fetches under
// the extension's own host permissions with no CORS at all.
//
// Exposes:
//   jcDetectProvider(key)                 -> slug | null
//   providerLabel(slug)                   -> "Anthropic" etc.
//   providerDefaultModel(slug)            -> model id string
//   providerGetSettings()                 -> { provider, apiKey, model } | null
//   providerAsk(prompt, reqId, tabId)     -> the askChatGPT result shape
//   providerClassify(system, user)        -> text | null  (non-streaming, no history)

const JC_PROVIDERS = {
  anthropic: {
    label: "Anthropic",
    url: "https://api.anthropic.com/v1/messages",
    // Cheapest current Claude, plenty for short explanation work.
    defaultModel: "claude-haiku-4-5",
    headers: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      // CORS never applies in a worker with host permissions, but the popup
      // validates keys from an extension page where this header is what makes
      // Anthropic answer browsers at all. One header set, both contexts.
      "anthropic-dangerous-direct-browser-access": "true",
      "Content-Type": "application/json",
    }),
    validateUrl: "https://api.anthropic.com/v1/models",
  },
  openai: {
    label: "OpenAI",
    url: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-5.4-nano",
    headers: (key) => ({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    }),
    validateUrl: "https://api.openai.com/v1/models",
  },
  gemini: {
    label: "Google Gemini",
    // Model id is spliced into the URL per request.
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    defaultModel: "gemini-2.5-flash-lite",
    headers: (key) => ({
      "x-goog-api-key": key,
      "Content-Type": "application/json",
    }),
    validateUrl: "https://generativelanguage.googleapis.com/v1beta/models",
  },
  huggingface: {
    label: "Hugging Face",
    url: "https://router.huggingface.co/v1/chat/completions",
    // :cheapest lets the router pick the lowest-priced host for the model.
    defaultModel: "openai/gpt-oss-120b:cheapest",
    headers: (key) => ({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    }),
    validateUrl: "https://huggingface.co/api/whoami-v2",
  },
  vercel: {
    label: "Vercel AI Gateway",
    url: "https://ai-gateway.vercel.sh/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini",
    headers: (key) => ({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    }),
    validateUrl: "https://ai-gateway.vercel.sh/v1/models",
  },
};

function jcDetectProvider(key) {
  const k = String(key || "").trim();
  if (!k) return null;
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("vck_")) return "vercel";
  if (k.startsWith("hf_")) return "huggingface";
  if (k.startsWith("AIza")) return "gemini";
  if (k.startsWith("sk-")) return "openai";
  return null;
}

function providerLabel(slug) {
  return (JC_PROVIDERS[slug] && JC_PROVIDERS[slug].label) || "your provider";
}

function providerDefaultModel(slug) {
  return (JC_PROVIDERS[slug] && JC_PROVIDERS[slug].defaultModel) || "";
}

// The one reader of the key storage. `jcByokProvider` is written by the popup
// at save time; keys saved before it existed are re-detected here so nobody's
// working Gateway key stops working on update.
async function providerGetSettings() {
  const res = await chrome.storage.local.get([
    "jcByokEnabled",
    "jcByokKey",
    "jcByokModel",
    "jcByokProvider",
  ]);
  if (!res.jcByokEnabled || !res.jcByokKey) return null;
  const apiKey = String(res.jcByokKey).trim();
  const provider = res.jcByokProvider || jcDetectProvider(apiKey);
  if (!provider || !JC_PROVIDERS[provider]) return null;
  return {
    provider,
    apiKey,
    model: (res.jcByokModel || "").trim() || JC_PROVIDERS[provider].defaultModel,
  };
}

// --- request shapes -----------------------------------------------------------

// Same system prompt the gateway path uses, so switching providers never
// changes the product's voice.
const PROVIDER_SYSTEM =
  "You are JustClarify, an ambient reading assistant. Answer directly and follow the user's " +
  "formatting instructions exactly — no preamble, no markdown headers unless asked.";

// history: [{role:"user"|"assistant", content}] — the gateway's storage shape,
// reused as-is so conversations survive a provider switch mid-thread.
function providerRequest(settings, history, prompt, opts) {
  const spec = JC_PROVIDERS[settings.provider];
  const stream = !!opts.stream;

  if (settings.provider === "anthropic") {
    return {
      url: spec.url,
      body: {
        model: settings.model,
        system: PROVIDER_SYSTEM,
        messages: [...history, { role: "user", content: prompt }],
        max_tokens: opts.maxTokens || 1200,
        temperature: opts.temperature ?? 0.4,
        stream,
      },
    };
  }

  if (settings.provider === "gemini") {
    const verb = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return {
      url: `${spec.url}/${encodeURIComponent(settings.model)}:${verb}`,
      body: {
        systemInstruction: { parts: [{ text: PROVIDER_SYSTEM }] },
        contents: [
          ...history.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          { role: "user", parts: [{ text: prompt }] },
        ],
        generationConfig: {
          maxOutputTokens: opts.maxTokens || 1200,
          temperature: opts.temperature ?? 0.4,
        },
      },
    };
  }

  // OpenAI, Hugging Face, Vercel — one wire format between them.
  return {
    url: spec.url,
    body: {
      model: settings.model,
      messages: [
        { role: "system", content: PROVIDER_SYSTEM },
        ...history,
        { role: "user", content: prompt },
      ],
      max_tokens: opts.maxTokens || 1200,
      temperature: opts.temperature ?? 0.4,
      stream,
    },
  };
}

// One SSE event → the text it carries, per provider family. Wrong or unknown
// shapes yield "" so a misread shows less, never something wrong.
function providerDelta(provider, obj) {
  if (!obj || typeof obj !== "object") return "";
  if (provider === "anthropic") {
    // content_block_delta carries the tokens; every other event type is
    // bookkeeping (message_start, ping, message_delta usage counts).
    return (obj.type === "content_block_delta" && obj.delta && obj.delta.text) || "";
  }
  if (provider === "gemini") {
    const parts =
      obj.candidates && obj.candidates[0] && obj.candidates[0].content
        ? obj.candidates[0].content.parts
        : null;
    return Array.isArray(parts)
      ? parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("")
      : "";
  }
  const delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
  return (delta && delta.content) || "";
}

// Non-streaming response → its full text.
function providerText(provider, data) {
  if (!data || typeof data !== "object") return "";
  if (provider === "anthropic") {
    const block = Array.isArray(data.content) && data.content.find((c) => c.type === "text");
    return (block && block.text) || "";
  }
  if (provider === "gemini") {
    const parts =
      data.candidates && data.candidates[0] && data.candidates[0].content
        ? data.candidates[0].content.parts
        : null;
    return Array.isArray(parts)
      ? parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("")
      : "";
  }
  return (data.choices && data.choices[0] && data.choices[0].message?.content) || "";
}

// What went wrong, in words a person can act on. 401/403 is the only failure
// allowed to blame the key — see hosted.js for the bug that rule comes from.
function providerFailure(spec, status, body) {
  if (status === 401 || status === 403) {
    return `${spec.label} rejected the API key. Check it in the JustClarify popup.`;
  }
  if (status === 402) return `${spec.label} reports no credit on this key.`;
  if (status === 429) return `${spec.label} is rate-limiting — give it a few seconds and try again.`;
  if (status === 404 || (status === 400 && /model/i.test(body || ""))) {
    return `${spec.label} didn't accept that model name — pick another in the popup.`;
  }
  if (status >= 500) return `${spec.label} is having trouble (${status}) — try again shortly.`;
  return `${spec.label} returned HTTP ${status}: ${String(body || "").slice(0, 140)}`;
}

function providerProgress(tabId, reqId, settings, answer, done) {
  if (tabId == null) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: "CLAUDE_PROGRESS",
      reqId,
      thinking: "",
      answer,
      done,
      engine: settings.provider === "gemini" ? "google" : settings.provider,
      model: settings.model,
    })
    .catch(() => {});
}

// Read any provider's SSE stream to completion, reporting growth ~12x/second.
// Same contract as gatewayReadStream: never rejects, a dead stream returns
// whatever it managed to read.
async function providerReadStream(provider, response, onGrow) {
  let answer = "";
  let lastEmit = 0;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          answer += providerDelta(provider, JSON.parse(payload));
        } catch (_) {
          // partial line / keepalive — ignore
        }
      }

      const now = Date.now();
      if (answer && now - lastEmit > 80) {
        onGrow(answer);
        lastEmit = now;
      }
    }
  } catch (error) {
    return { answer, error: String(error).slice(0, 120) };
  }
  return { answer, error: null };
}

// The direct-provider twin of gatewayAsk: same history storage, same progress
// messages, same result shape — an ask cannot tell which path answered it.
async function providerAsk(prompt, reqId, tabId) {
  const settings = await providerGetSettings();
  if (!settings) {
    return { ok: false, error: "No API key saved — add one in the JustClarify popup." };
  }
  const spec = JC_PROVIDERS[settings.provider];

  const { key: historyKey, messages: history } = await gatewayHistory(tabId ?? "global");
  const req = providerRequest(settings, history, prompt, { stream: true });

  let response;
  try {
    response = await jcFetchBounded(req.url, {
      method: "POST",
      headers: spec.headers(settings.apiKey),
      body: JSON.stringify(req.body),
    });
  } catch (e) {
    return {
      ok: false,
      error: `Couldn't reach ${spec.label} — ${String(e).slice(0, 100)}`,
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, error: providerFailure(spec, response.status, body) };
  }

  const stream = await providerReadStream(settings.provider, response, (partial) =>
    providerProgress(tabId, reqId, settings, partial, false),
  );
  if (stream.error && !stream.answer) {
    return { ok: false, error: `${spec.label}'s stream failed (${stream.error}).` };
  }
  const answer = stream.answer.trim();
  if (!answer) return { ok: false, error: `${spec.label} returned an empty answer.` };

  await gatewaySaveHistory(historyKey, [
    ...history,
    { role: "user", content: prompt },
    { role: "assistant", content: answer },
  ]);

  providerProgress(tabId, reqId, settings, answer, true);
  return {
    ok: true,
    answer,
    thinking: "",
    url: "",
    engine: settings.provider === "gemini" ? "google" : settings.provider,
    model: settings.model,
  };
}

// One-shot, history-free, JSON-shaped — the classifier lane. Routes a Gateway
// key to gatewayClassify so that path stays exactly as it was; everything else
// asks its provider directly. null on any failure, like gatewayClassify, so
// callers keep their hosted fallback.
// Why the last key-backed call failed, in words. providerClassify returns null
// for every possible failure, and callers used to turn that single null into
// "fall back to JustClarify's free tier" — which spent our budget on someone
// who had explicitly opted out of it, and reported OUR outages as though they
// were theirs. Now the reason survives the null so callers can say the true
// thing instead of guessing.
let providerLastFailure = null;

function providerFailureMessage() {
  return providerLastFailure;
}

async function providerClassify(systemPrompt, userPrompt) {
  providerLastFailure = null;
  const settings = await providerGetSettings();
  if (!settings) return null;
  if (settings.provider === "vercel") return gatewayClassify(systemPrompt, userPrompt);

  const spec = JC_PROVIDERS[settings.provider];
  const req = providerRequest(settings, [], userPrompt, {
    stream: false,
    maxTokens: 160,
    temperature: 0,
  });
  // The classifier's instructions ride the system slot.
  if (settings.provider === "anthropic") req.body.system = systemPrompt;
  else if (settings.provider === "gemini") {
    req.body.systemInstruction = { parts: [{ text: systemPrompt }] };
  } else if (req.body.messages) req.body.messages[0].content = systemPrompt;

  try {
    const response = await jcFetchBounded(req.url, {
      method: "POST",
      headers: spec.headers(settings.apiKey),
      body: JSON.stringify(req.body),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      providerLastFailure = providerFailure(spec, response.status, body);
      return null;
    }
    const text = providerText(settings.provider, await response.json());
    const answer = (text || "").trim();
    if (!answer) providerLastFailure = `${spec.label} returned an empty answer.`;
    return answer || null;
  } catch (error) {
    providerLastFailure = `Couldn't reach ${spec.label} — ${String(error).slice(0, 100)}`;
    return null;
  }
}
