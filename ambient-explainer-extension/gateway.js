// gateway.js — answer JustClarify prompts via Vercel AI Gateway (BYOK).
//
// The Gateway is one OpenAI-compatible endpoint in front of hundreds of models
// (https://ai-gateway.vercel.sh/v1). The user pastes their own key in the
// popup; it is stored ONLY in chrome.storage.local on this device and sent
// ONLY to ai-gateway.vercel.sh — never to a JustClarify server.
//
// This file is imported by background.js (importScripts). It exposes:
//   gatewayGetSettings()            -> { enabled, apiKey, model } | null when unusable
//   gatewayAsk(prompt, reqId, tabId) -> same shape askChatGPT expects:
//                                      { ok, answer, thinking, url } | { ok:false, error }
// Progress is pushed to the origin tab as CLAUDE_PROGRESS messages.

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const GATEWAY_DEFAULT_MODEL = "openai/gpt-4o-mini";
const GATEWAY_SETTINGS_KEYS = ["jcByokEnabled", "jcByokKey", "jcByokModel"];

// Rolling per-tab conversation history so follow-ups continue the chat the way
// a real ChatGPT conversation would. Kept in storage.session: survives service
// worker restarts, cleared when the browser closes.
const GATEWAY_HISTORY_LIMIT = 12; // messages (6 exchanges)

const GATEWAY_SYSTEM_PROMPT =
  "You are JustClarify, an ambient reading assistant. Answer directly and follow the user's " +
  "formatting instructions exactly — no preamble, no markdown headers unless asked.";

// fetch() has no default timeout, so a stalled connection here used to hang
// forever: the worker never answered, the content script's await never settled,
// and the voice chip pulsed on screen with no path to any other state. Every
// "it just keeps loading" report ended at an unbounded fetch.
//
// The ceiling is on TIME TO RESPONSE, not time to finish — the timer is cleared
// the instant headers arrive, so a long streamed answer is never cut off
// mid-sentence. An abort surfaces as an ordinary network rejection, which every
// caller here already handles.
async function jcFetchBounded(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || 30_000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function gatewayGetSettings() {
  const res = await chrome.storage.local.get(GATEWAY_SETTINGS_KEYS);
  if (!res.jcByokEnabled || !res.jcByokKey) return null;
  const apiKey = String(res.jcByokKey).trim();
  // The key slot now holds ANY provider's key (providers.js), and this function
  // must refuse the ones that aren't the Gateway's — an Anthropic key sent to
  // ai-gateway.vercel.sh in a Bearer header is a leak to a third party, not a
  // 401 to shrug at.
  if (typeof jcDetectProvider === "function" && jcDetectProvider(apiKey) !== "vercel") {
    return null;
  }
  return {
    enabled: true,
    apiKey,
    model: (res.jcByokModel || "").trim() || GATEWAY_DEFAULT_MODEL,
  };
}

async function gatewayHistory(tabId) {
  const key = `jcGwHistory:${tabId}`;
  const res = await chrome.storage.session.get([key]).catch(() => ({}));
  return { key, messages: Array.isArray(res[key]) ? res[key] : [] };
}

async function gatewaySaveHistory(key, messages) {
  const trimmed = messages.slice(-GATEWAY_HISTORY_LIMIT);
  await chrome.storage.session.set({ [key]: trimmed }).catch(() => {});
}

// Provider slug from a Gateway model id: "anthropic/claude-sonnet-4.5" →
// "anthropic". The UI uses it to show whose model is answering.
function gatewayEngine(model) {
  return String(model || "").split("/")[0].toLowerCase() || "gateway";
}

function gatewayProgress(tabId, reqId, answer, done, model) {
  if (tabId == null) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: "CLAUDE_PROGRESS",
      reqId,
      thinking: "",
      answer,
      done,
      engine: gatewayEngine(model),
      model,
    })
    .catch(() => {});
}

// Human-readable failures, displayed verbatim by content.js (showClaudeError).
function gatewayError(detail) {
  return {
    ok: false,
    error: `JustClarify couldn't connect to Vercel AI Gateway — ${detail}`,
  };
}

// Read an OpenAI-style SSE stream to completion, reporting the answer-so-far no
// more than ~12 times a second. Shared by the BYOK path and the hosted one,
// which speak the same wire format on purpose: hosted.js proxies this exact
// format through justclarify.xyz, so neither tier needs its own parser.
//
// Never rejects. A stream that dies mid-answer returns what it managed to read
// alongside the error, and the caller decides whether a partial answer is worth
// showing (it usually is).
async function gatewayReadStream(response, onGrow) {
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
      buffer = lines.pop(); // keep the trailing partial line

      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
          if (delta) answer += delta;
        } catch (_) {
          // partial/keepalive line — ignore
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

// A one-shot, non-streaming, history-free call that must return JSON.
//
// Deliberately separate from gatewayAsk: classification is not conversation.
// Sharing the per-tab history would let a stray "scroll down" become context
// for the next explanation, and the streaming/progress machinery exists to
// paint prose into a popup that no classifier ever opens. Low temperature and
// a small token cap because the answer is one short object.
async function gatewayClassify(systemPrompt, userPrompt) {
  const settings = await gatewayGetSettings();
  if (!settings) return null;

  let response;
  try {
    response = await jcFetchBounded(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        // NO response_format: the Gateway rejects the parameter itself with a
        // 400, so sending it made every BYOK classification fail silently
        // (this function returns null on !ok, so it looked like "the model had
        // no idea" rather than "the request was malformed"). Temperature 0 and
        // a prompt demanding JSON do the work; parseStep strips fences.
        max_tokens: 120,
        temperature: 0,
      }),
    });
  } catch (_) {
    return null;
  }

  if (!response.ok) return null;

  let text;
  try {
    const data = await response.json();
    text = data?.choices?.[0]?.message?.content || "";
  } catch (_) {
    return null;
  }
  return text.trim() || null;
}

async function gatewayAsk(prompt, reqId, tabId) {
  const settings = await gatewayGetSettings();
  if (!settings) return gatewayError("no API key saved. Add one in the extension popup.");

  const { key: historyKey, messages: history } = await gatewayHistory(tabId ?? "global");
  const messages = [
    { role: "system", content: GATEWAY_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: prompt },
  ];

  let response;
  try {
    response = await jcFetchBounded(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        stream: true,
        max_tokens: 1200,
        temperature: 0.4,
      }),
    });
  } catch (e) {
    return gatewayError(`network error (${String(e).slice(0, 120)}).`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      return gatewayError("the API key was rejected (401). Check it in the extension popup.");
    }
    if (response.status === 404 || /model/i.test(body) && response.status === 400) {
      return gatewayError(
        `model "${settings.model}" was not accepted (${response.status}). Pick another model in the popup.`,
      );
    }
    if (response.status === 402) {
      return gatewayError("the Gateway reports no credit on this key (402).");
    }
    return gatewayError(`HTTP ${response.status}: ${body.slice(0, 160)}`);
  }

  // Parse the OpenAI-style SSE stream, pushing partial answers as they grow.
  const stream = await gatewayReadStream(response, (partial) =>
    gatewayProgress(tabId, reqId, partial, false, settings.model),
  );
  if (stream.error && !stream.answer) {
    return gatewayError(`stream failed (${stream.error}).`);
  }
  // A partial answer is better than none — fall through and return it.
  let answer = stream.answer.trim();
  if (!answer) return gatewayError("the model returned an empty answer.");

  await gatewaySaveHistory(historyKey, [
    ...history,
    { role: "user", content: prompt },
    { role: "assistant", content: answer },
  ]);

  gatewayProgress(tabId, reqId, answer, true, settings.model);
  return {
    ok: true,
    answer,
    thinking: "",
    url: "",
    engine: gatewayEngine(settings.model),
    model: settings.model,
  };
}
