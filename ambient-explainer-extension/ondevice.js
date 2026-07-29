// ondevice.js — answer JustClarify prompts with Chrome's built-in model
// (Gemini Nano via the Prompt API). No key, no server: once Chrome has the
// model downloaded, explains run entirely on this machine.
//
// Loaded by background.js AFTER gateway.js — reuses gatewayHistory /
// gatewaySaveHistory / GATEWAY_SYSTEM_PROMPT so on-device and Gateway answers
// share one per-tab conversation.
//
// Exposes:
//   onDeviceAvailability()          -> 'available' | 'downloadable' |
//                                      'downloading' | 'unavailable'
//   onDeviceWarmup()                -> start the model download, don't wait
//   onDeviceAsk(prompt, reqId, tabId) -> { ok, answer, thinking, url }
//                                      | null (caller should fall back)

async function onDeviceAvailability() {
  try {
    if (typeof LanguageModel === "undefined") return "unavailable";
    return await LanguageModel.availability();
  } catch (_) {
    return "unavailable";
  }
}

// Chrome's published bar for the built-in model. All three must pass; the API
// reports a bare "unavailable" without saying which one failed.
const ONDEVICE_REQUIREMENTS = {
  ram: 16, // GB
  vram: 4, // GB
  disk: 22, // GB free on the browser's volume
};

// Best-effort explanation of WHY the built-in model is out. The Prompt API
// gives no reason code, and the web platform exposes almost nothing about the
// machine — navigator.deviceMemory is capped at 8 for fingerprinting reasons
// and there is no VRAM API at all — so this reports only what can actually be
// measured and stays vague where the platform is vague. Never guess a cause we
// can't see: a wrong reason is worse than "your device doesn't meet the bar".
async function onDeviceBlockReason() {
  // 1. The API isn't in this browser at all.
  if (typeof LanguageModel === "undefined") {
    return {
      kind: "browser",
      headline: "This browser doesn't have built-in AI",
      detail:
        "Chrome's on-device model is only in Chrome (148+) and, behind a flag, " +
        "Edge Canary/Dev. Safari and Firefox don't offer it, and Chromium forks " +
        "like Brave and Arc ship the API without the model download.",
    };
  }

  // 2. The API exists but the machine didn't qualify. Report the one signal
  //    the platform actually gives us, and name the full bar either way.
  const ram = typeof navigator !== "undefined" ? navigator.deviceMemory : undefined;
  const hints = [];
  // deviceMemory saturates at 8, so a reading BELOW 8 is a definite fail and a
  // reading OF 8 is genuinely unknown (could be 8GB or 64GB).
  if (typeof ram === "number" && ram < 8) {
    hints.push(`this device reports about ${ram}GB of RAM`);
  }
  try {
    const { quota } = await navigator.storage.estimate();
    // Chrome grants roughly 60% of free disk as quota — rough, but a small
    // quota is a reliable sign the disk is too full.
    if (typeof quota === "number" && quota / 1e9 / 0.6 < ONDEVICE_REQUIREMENTS.disk) {
      hints.push("free disk space looks low");
    }
  } catch (_) {}

  return {
    kind: "device",
    headline: "This device can't run the built-in AI",
    detail:
      `Chrome needs ${ONDEVICE_REQUIREMENTS.ram}GB of RAM, ` +
      `${ONDEVICE_REQUIREMENTS.vram}GB of video memory and ` +
      `${ONDEVICE_REQUIREMENTS.disk}GB of free disk — all three — and Chrome ` +
      "doesn't say which one it failed on" +
      (hints.length ? ` (${hints.join(", ")})` : "") +
      ".",
  };
}

// Fire-and-forget: joins/starts Chrome's model download so the next ask can
// run locally. Used when this ask is being answered by the Gateway anyway.
//
// Guarded by a module-level promise because askEngine calls this on EVERY ask
// while availability is still 'downloadable'/'downloading' — which is the whole
// time the download is running. Without the guard, each highlight fired another
// LanguageModel.create(), so a user highlighting during a multi-GB download
// stacked up a fresh session per highlight and the download appeared to restart
// every time. One create, reused until it settles.
let onDeviceWarmupPromise = null;

function onDeviceWarmup() {
  if (onDeviceWarmupPromise) return onDeviceWarmupPromise;
  try {
    onDeviceWarmupPromise = LanguageModel.create()
      .then((s) => {
        if (s && s.destroy) s.destroy();
      })
      .catch(() => {
        // Let a later ask retry — a failed download shouldn't be permanent.
        onDeviceWarmupPromise = null;
      });
  } catch (_) {
    onDeviceWarmupPromise = null;
  }
  return onDeviceWarmupPromise;
}

// Chrome's built-in model, named for the UI's engine badge.
const ONDEVICE_ENGINE = "chrome";
const ONDEVICE_MODEL = "Gemini Nano (on-device)";

// Same CLAUDE_PROGRESS shape gateway.js emits, but with a thinking line so the
// one-time model download shows up as visible progress instead of a dead spinner.
function onDeviceProgress(tabId, reqId, { answer = "", thinking = "", done = false, download = null }) {
  if (tabId == null) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: "CLAUDE_PROGRESS",
      reqId,
      thinking,
      answer,
      done,
      download, // 0..100 while the one-time model download runs, else null
      engine: ONDEVICE_ENGINE,
      model: ONDEVICE_MODEL,
    })
    .catch(() => {});
}

async function onDeviceAsk(prompt, reqId, tabId) {
  const { key: historyKey, messages: history } = await gatewayHistory(tabId ?? "global");

  // Whether a download is genuinely pending, checked BEFORE create(). Chrome
  // fires downloadprogress on a cached model too (0→100 instantly), so an
  // unconditional monitor puts "one-time download…" on screen for every single
  // ask once the model is already local — indistinguishable, to a user, from it
  // re-downloading on every highlight. Only surface progress when there is
  // actually something to download.
  const needsDownload = (await onDeviceAvailability()) !== "available";

  let session;
  try {
    session = await LanguageModel.create({
      initialPrompts: [
        { role: "system", content: GATEWAY_SYSTEM_PROMPT },
        ...history,
      ],
      monitor(m) {
        if (!needsDownload) return;
        m.addEventListener("downloadprogress", (e) => {
          const pct = Math.round(((e.loaded || 0) / (e.total || 1)) * 100);
          onDeviceProgress(tabId, reqId, {
            thinking: `Setting up on-device AI (one-time download)… ${pct}%`,
            download: pct,
          });
        });
      },
    });
  } catch (_) {
    // History too big for the context window, download refused, hardware —
    // whatever it was, let the caller fall back to the Gateway.
    return null;
  }

  let answer = "";
  let lastEmit = 0;
  try {
    for await (const chunk of session.promptStreaming(prompt)) {
      answer += chunk;
      const now = Date.now();
      if (answer && now - lastEmit > 80) {
        onDeviceProgress(tabId, reqId, { answer });
        lastEmit = now;
      }
    }
  } catch (_) {
    if (!answer) {
      try {
        if (session.destroy) session.destroy();
      } catch (_) {}
      return null;
    }
    // Partial answer is better than none — fall through and return it.
  }
  try {
    if (session.destroy) session.destroy();
  } catch (_) {}

  answer = answer.trim();
  if (!answer) return null;

  await gatewaySaveHistory(historyKey, [
    ...history,
    { role: "user", content: prompt },
    { role: "assistant", content: answer },
  ]);

  onDeviceProgress(tabId, reqId, { answer, done: true });
  return {
    ok: true,
    answer,
    thinking: "",
    url: "",
    engine: ONDEVICE_ENGINE,
    model: ONDEVICE_MODEL,
  };
}
