// ondevice.js — the Device engine: Chrome's built-in Gemini Nano.
//
// Back by request, as an explicit CHOICE in the popup rather than an automatic
// tier — and this time the download can actually finish. The old version
// started the multi-GB pull from this service worker, which Chrome kills after
// ~30 seconds idle; the download died with it, restarted on the next ask, and
// wore a progress bar forever. Now the warmup runs in the offscreen document
// (offscreen.js), whose lifetime WE manage — it stays up until the model is
// local, and progress lands in chrome.storage so the popup can narrate it.
//
// Asks still run here in the worker: once the model is downloaded,
// LanguageModel.create() is cheap and the worker's short life doesn't matter.
//
// Exposes:
//   onDeviceAvailability() -> 'available' | 'downloadable' | 'downloading' | 'unavailable'
//   onDeviceEnsureReady()  -> kicks the offscreen warmup (fire and forget)
//   onDeviceAsk(prompt, reqId, tabId) -> answer object | null (caller falls back)

async function onDeviceAvailability() {
  try {
    if (typeof LanguageModel === "undefined") return "unavailable";
    return await LanguageModel.availability();
  } catch (_) {
    return "unavailable";
  }
}

const ONDEVICE_ENGINE = "chrome";
const ONDEVICE_MODEL = "Gemini Nano (on-device)";

// Ask the offscreen document to pull the model down and sit with it until it
// lands. Deduped by the offscreen side (jcDeviceModel.state), so calling this
// on every ask while unready is safe and cheap.
async function onDeviceEnsureReady() {
  try {
    await ensureOffscreen();
    chrome.runtime
      .sendMessage({ target: "offscreen", type: "JC_MODEL_WARMUP" })
      .catch(() => {});
  } catch (_) {}
}

function onDeviceProgress(tabId, reqId, answer, done) {
  if (tabId == null) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: "CLAUDE_PROGRESS",
      reqId,
      thinking: "",
      answer,
      done,
      engine: ONDEVICE_ENGINE,
      model: ONDEVICE_MODEL,
    })
    .catch(() => {});
}

async function onDeviceAsk(prompt, reqId, tabId) {
  if ((await onDeviceAvailability()) !== "available") return null;

  const { key: historyKey, messages: history } = await gatewayHistory(tabId ?? "global");

  // One attempt = one session, streamed to the popup as it goes. Null for any
  // failure that produced nothing.
  const attempt = async (withHistory) => {
    let session;
    try {
      session = await LanguageModel.create({
        initialPrompts: [
          { role: "system", content: GATEWAY_SYSTEM_PROMPT },
          ...(withHistory ? history : []),
        ],
      });
    } catch (_) {
      return null; // history too large, hardware balked
    }

    let text = "";
    let lastEmit = 0;
    try {
      for await (const chunk of session.promptStreaming(prompt)) {
        text += chunk;
        const now = Date.now();
        if (text && now - lastEmit > 80) {
          onDeviceProgress(tabId, reqId, text, false);
          lastEmit = now;
        }
      }
    } catch (_) {
      // A partial answer beats none — keep whatever streamed.
      if (!text) {
        try { session.destroy?.(); } catch (_) {}
        return null;
      }
    }
    try { session.destroy?.(); } catch (_) {}
    return text.trim() || null;
  };

  // Nano fails in bursts: a conversation history that outgrew the session, a
  // model service that crashed mid-answer ("internal error"). Most of those
  // are rescued by simply trying once more in a FRESH session with no history
  // — so that retry lives here, instead of the failure surfacing for the user
  // to retry by hand. Only when both attempts return nothing does the caller's
  // api fallback take over (and the engine badge says so).
  let answer = await attempt(true);
  if (!answer) answer = await attempt(false); // fresh session, no history
  if (!answer) return null;

  await gatewaySaveHistory(historyKey, [
    ...history,
    { role: "user", content: prompt },
    { role: "assistant", content: answer },
  ]);

  onDeviceProgress(tabId, reqId, answer, true);
  return { ok: true, answer, thinking: "", url: "", engine: ONDEVICE_ENGINE, model: ONDEVICE_MODEL };
}
