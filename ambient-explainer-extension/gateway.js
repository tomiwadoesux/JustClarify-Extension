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

async function gatewayGetSettings() {
  const res = await chrome.storage.local.get(GATEWAY_SETTINGS_KEYS);
  if (!res.jcByokEnabled || !res.jcByokKey) return null;
  return {
    enabled: true,
    apiKey: String(res.jcByokKey).trim(),
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
    response = await fetch(GATEWAY_URL, {
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

      // Throttle progress a little so we don't flood the content script.
      const now = Date.now();
      if (answer && now - lastEmit > 80) {
        gatewayProgress(tabId, reqId, answer, false, settings.model);
        lastEmit = now;
      }
    }
  } catch (e) {
    if (!answer) return gatewayError(`stream failed (${String(e).slice(0, 120)}).`);
    // Partial answer is better than none — fall through and return it.
  }

  answer = answer.trim();
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
