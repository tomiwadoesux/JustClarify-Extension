// JustClarify toolbar popup — every setting the extension has, in one place.
// Reads and writes chrome.storage.local; content scripts and the service
// worker react to those changes live, so nothing here needs a save button
// except the keys (which are verified when saved).

const JC_BYOK_ENABLED_KEY = "jcByokEnabled";
const JC_BYOK_KEY_KEY = "jcByokKey";
const JC_BYOK_MODEL_KEY = "jcByokModel";
const JC_BYOK_PROVIDER_KEY = "jcByokProvider";
const JC_DEEPGRAM_KEY = "jcDeepgramKey";
const JC_GOOGLE_FACT_KEY = "jcGoogleFactKey";
const JC_DEFAULT_MODEL = "openai/gpt-4o-mini";

// Early access: the hosted API is free until this date. The popup only needs
// the date for copy — enforcement (such as it is) lives server-side.
const JC_FREE_UNTIL = Date.parse("2026-08-28T00:00:00");

// Which company a key belongs to, read off the key itself — providers prefix
// keys exactly so tools can do this. Mirrors jcDetectProvider in providers.js
// (the worker can't be imported from a popup page, so the table is repeated;
// the tests hold the two copies together).
const JC_KEY_PROVIDERS = {
  anthropic: { label: "Anthropic", validate: "https://api.anthropic.com/v1/models",
    headers: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }),
    defaultModel: "claude-haiku-4-5" },
  openai: { label: "OpenAI", validate: "https://api.openai.com/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    defaultModel: "gpt-5.4-nano" },
  gemini: { label: "Google Gemini", validate: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: (k) => ({ "x-goog-api-key": k }),
    defaultModel: "gemini-2.5-flash-lite" },
  huggingface: { label: "Hugging Face", validate: "https://huggingface.co/api/whoami-v2",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    defaultModel: "openai/gpt-oss-120b:cheapest" },
  vercel: { label: "Vercel AI Gateway", validate: "https://ai-gateway.vercel.sh/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    defaultModel: JC_DEFAULT_MODEL },
};

function jcDetectKeyProvider(key) {
  const k = String(key || "").trim();
  if (!k) return null;
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("vck_")) return "vercel";
  if (k.startsWith("hf_")) return "huggingface";
  if (k.startsWith("AIza")) return "gemini";
  if (k.startsWith("sk-")) return "openai";
  return null;
}

let store = { byokEnabled: false, savedKey: "", savedProvider: "", savedModel: "" };
let lastEngineInfo = null;

const $ = (id) => document.getElementById(id);

const byokSwitch = $("jc-byok-switch");
const byokSaved = $("jc-byok-saved");
const byokSavedLabel = $("jc-byok-saved-label");
const byokSavedHint = $("jc-byok-saved-hint");
const byokDeleteBtn = $("jc-byok-delete");
const byokModelEdit = $("jc-byok-model-edit");
const byokEntry = $("jc-byok-entry");
const byokFields = $("jc-byok-fields");
const byokKeyInput = $("jc-byok-key");
const byokModelInput = $("jc-byok-model");
const byokSaveBtn = $("jc-byok-save");
const byokStatus = $("jc-byok-status");
const liveFields = $("jc-live-fields");
const deepgramInput = $("jc-deepgram-key");
const factKeyInput = $("jc-factcheck-key");
const rewriteBtn = $("jc-rewrite-btn");
const factcheckHead = $("jc-factcheck-head");
const factcheckGroup = $("jc-fc-group");
const factcheckBtn = $("jc-factcheck-btn");
const factcheckVideoBtn = $("jc-factcheck-video-btn");
const liveBtn = $("jc-factcheck-live-btn");
const historyBtn = $("jc-history-btn");
const enginePick = $("jc-engine-pick");
const engineNote = $("jc-engine-note");
const llmRow = $("jc-llm-row");
const llmProviderSelect = $("jc-llm-provider");
const llmModelField = $("jc-llm-model-field");
const llmModelInput = $("jc-llm-model");
const voiceNote = $("jc-voice-note");
const micBtn = $("jc-mic-btn");

// A website can switch the microphone off for anything running inside it, and
// plenty do — that is why voice worked on one site and was dead on the next.
// A grant on the extension's own origin outranks all of them, so offer it here
// rather than waiting for the user to hit the wall on some site that blocks it.
async function renderMicSetup() {
  if (!micBtn) return;
  try {
    const status = await chrome.runtime.sendMessage({ type: "JC_VOICE_MIC_STATUS" });
    micBtn.hidden = status?.state === "granted";
  } catch (_) {
    micBtn.hidden = false;
  }
}

micBtn?.addEventListener("click", async () => {
  try {
    await chrome.runtime.sendMessage({ type: "JC_VOICE_MIC_GRANT" });
    window.close(); // the grant page is now the thing to look at
  } catch (_) {}
});

renderMicSetup();

function setSwitch(el, on) {
  el.classList.toggle("is-on", on);
  el.setAttribute("aria-checked", String(on));
}

function setReveal(el, open) {
  el.dataset.open = String(open);
}

function render() {
  setSwitch(byokSwitch, store.byokEnabled);
  setReveal(byokFields, store.byokEnabled);

  // A saved key shows as a row that can only be deleted, never edited: the
  // masked tail proves WHICH key is saved, and a replacement is a fresh paste.
  const saved = !!store.savedKey;
  byokSaved.hidden = !saved;
  byokEntry.hidden = saved;
  if (saved) {
    const spec = JC_KEY_PROVIDERS[store.savedProvider];
    const tail = store.savedKey.slice(-4);
    byokSavedLabel.textContent = `${spec ? spec.label : "API"} key ••••${tail}`;
    byokSavedHint.textContent = store.savedModel
      ? `Model: ${store.savedModel}`
      : `Model: ${spec ? spec.defaultModel : "default"}`;
    // The model, unlike the key, is safe to edit in place — a typo'd model is
    // a readable error on the next ask, not a dead key.
    if (byokModelEdit && document.activeElement !== byokModelEdit) {
      byokModelEdit.value = store.savedModel || "";
      byokModelEdit.placeholder = `Model — default: ${spec ? spec.defaultModel : "provider default"}`;
    }
  }
}

// --- Voice mode --------------------------------------------------------------
// Free  — the 33-rule grammar only. Instant, offline, nothing leaves the device.
// AI    — anything the grammar misses goes to a model that picks an action.
//
// The note names the engine that would actually serve AI mode, because "AI" on
// a machine with no on-device model and no key is a promise the extension
// can't keep, and finding that out mid-sentence is worse than reading it here.
// --- Engine card -------------------------------------------------------------
// Two tiers now: JustClarify's hosted AI by default, or the user's own Gateway
// key when they set one. The on-device tier is gone, so this no longer has to
// explain hardware requirements or narrate a download.
function renderEngine(info) {
  lastEngineInfo = info;

  const dot = $("jc-head-dot");
  const headText = $("jc-head-engine-text");
  dot.className = "jc-dot";

  if (!info || !info.ok) {
    headText.textContent = "Unknown";
    engineNote.textContent = "Couldn't reach the extension's background worker.";
    return;
  }

  const engine = info.engine || "api";

  // Reflect the selection on the segmented control.
  for (const btn of enginePick.querySelectorAll(".jc-seg-btn")) {
    const on = btn.dataset.engine === engine;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-checked", String(on));
  }

  // Provider list arrives from the worker so the popup can't drift from llm.js.
  if (llmProviderSelect.options.length === 0 && Array.isArray(info.llmProviders)) {
    for (const p of info.llmProviders) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.symbol}  ${p.name}`;
      llmProviderSelect.appendChild(opt);
    }
  }
  if (info.llmProvider) llmProviderSelect.value = info.llmProvider;
  llmRow.hidden = engine !== "llm";
  // The model field only means something where the ask URL can carry a model.
  llmModelField.hidden = llmProviderSelect.value !== "chatgpt";

  if (engine === "device") {
    // The on-device slot is Early access now: the hosted API, free, no meter,
    // until the free period spins off on August 28. A saved personal key
    // outranks it (background.js routes to askApi), so say so here rather
    // than promising the free tier is spending anything.
    dot.classList.add("is-ok");
    headText.textContent = "Early access";
    if (info.hasKey) {
      engineNote.textContent = `Your ${info.keyProviderName || "API"} key is saved, so answers go straight to it. Your key always comes first.`;
      return;
    }
    engineNote.textContent =
      Date.now() < JC_FREE_UNTIL
        ? "JustClarify's API, free until August 28 — nothing to set up, voice included."
        : "The free period has ended — answers now use the API engine's normal path.";
    return;
  }

  if (engine === "llm") {
    dot.classList.add("is-ok");
    const chosen = (info.llmProviders || []).find((p) => p.id === info.llmProvider);
    headText.textContent = chosen ? chosen.name : "Your LLM";
    engineNote.textContent =
      `${chosen ? chosen.name : "Your chat site"} answers in a quiet tab on your own account — free. ` +
      "Slower streaming; no voice control.";
    return;
  }

  // api
  dot.classList.add("is-ok");
  if (info.hasKey) {
    headText.textContent = info.keyProviderName || "Your key";
    engineNote.textContent =
      `${info.model || JC_DEFAULT_MODEL} straight to ${info.keyProviderName || "your provider"} on your own key — unlimited.`;
    return;
  }
  headText.textContent = "JustClarify";
  if (Date.now() < JC_FREE_UNTIL) {
    // Early access covers the API tier too — no countdown while it's free.
    engineNote.textContent =
      "JustClarify's model — free until August 28. Add your own key below any time.";
    return;
  }
  const used = info.meterUsed;
  const total = info.meterTotal;
  const meterLine =
    used != null && total != null
      ? `${used} of ${total} free asks used`
      : "First 30 asks free";
  engineNote.textContent =
    `JustClarify's model — voice included. ${meterLine}; then $3.99/month, or add your key below.`;
}

function loadEngine() {
  try {
    chrome.runtime.sendMessage({ type: "JC_ENGINE_STATUS" }, (info) => {
      if (chrome.runtime.lastError) return renderEngine(null);
      renderEngine(info);
    });
  } catch (_) {
    renderEngine(null);
  }
}

function load() {
  chrome.storage.local.get(
    [JC_BYOK_ENABLED_KEY, JC_BYOK_KEY_KEY, JC_BYOK_MODEL_KEY, JC_BYOK_PROVIDER_KEY, JC_DEEPGRAM_KEY, JC_GOOGLE_FACT_KEY],
    (res) => {
      store.byokEnabled = !!res[JC_BYOK_ENABLED_KEY];
      // The saved key is never written back into an input. It renders as a
      // masked row with a Delete button — replace it by deleting and pasting.
      store.savedKey = res[JC_BYOK_KEY_KEY] || "";
      store.savedModel = res[JC_BYOK_MODEL_KEY] || "";
      store.savedProvider =
        res[JC_BYOK_PROVIDER_KEY] || jcDetectKeyProvider(store.savedKey) || "";
      if (res[JC_DEEPGRAM_KEY]) deepgramInput.value = res[JC_DEEPGRAM_KEY];
      if (res[JC_GOOGLE_FACT_KEY]) factKeyInput.value = res[JC_GOOGLE_FACT_KEY];
      render();
      loadEngine();
    },
  );
}

// --- Toggles -----------------------------------------------------------------

byokSwitch.addEventListener("click", () => {
  store.byokEnabled = !store.byokEnabled;
  chrome.storage.local.set({ [JC_BYOK_ENABLED_KEY]: store.byokEnabled });
  render();
  loadEngine();
  if (store.byokEnabled && !store.savedKey) {
    // Opening the section is a request to fill it in.
    setTimeout(() => byokKeyInput.focus(), 220);
  }
});

for (const btn of enginePick.querySelectorAll(".jc-seg-btn")) {
  if (btn.disabled) continue; // Device isn't finished — nothing to select
  btn.addEventListener("click", () => {
    chrome.storage.local.set({ jcEngine: btn.dataset.engine });
    // The worker reads storage per-ask; re-render optimistically now.
    if (lastEngineInfo) {
      lastEngineInfo.engine = btn.dataset.engine;
      renderEngine(lastEngineInfo);
    }
    loadEngine();
  });
}

llmProviderSelect.addEventListener("change", () => {
  chrome.storage.local.set({ jcLlmProvider: llmProviderSelect.value });
  llmModelField.hidden = llmProviderSelect.value !== "chatgpt";
});

// The ChatGPT model preference. Saved as typed; llm.js puts it on the ask URL
// for NEW windows only, and ChatGPT ignores names it doesn't recognize.
chrome.storage.local.get(["jcLlmModel"], (res) => {
  if (res && typeof res.jcLlmModel === "string") llmModelInput.value = res.jcLlmModel;
});
llmModelInput.addEventListener("change", () => {
  chrome.storage.local.set({ jcLlmModel: llmModelInput.value.trim() });
});

// --- Page actions ------------------------------------------------------------
// All of these need the content script, so they fail on chrome:// and the Web
// Store. Say so in the button itself rather than doing nothing.

function sendToPage(button, message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null) return;
    chrome.tabs.sendMessage(tab.id, message, () => {
      if (chrome.runtime.lastError) {
        // Swap the label and its hint — the button also holds an icon, and
        // textContent on the button itself would eat that too. The label has no
        // room for the reason, so the hint line carries it.
        const label = button.querySelector(".jc-btn-label") || button;
        const hint = button.querySelector(".jc-btn-hint");
        const original = label.textContent;
        const originalHint = hint && hint.textContent;
        label.textContent = "Only works on normal websites";
        if (hint) {
          hint.textContent =
            "Browser pages like this one can't be read. Open a website and try again.";
        }
        // Longer than a one-line swap needed: there are now two lines to read.
        setTimeout(() => {
          label.textContent = original;
          if (hint) hint.textContent = originalHint;
        }, 3200);
        return;
      }
      window.close();
    });
  });
}

rewriteBtn.addEventListener("click", () =>
  sendToPage(rewriteBtn, { type: "OPEN_REWRITE_BOX" }),
);

// Hover reveals the fact-check targets; clicking the head toggles them too, so
// it works without a pointer (keyboard / touch).
factcheckHead.addEventListener("click", () => {
  const open = factcheckGroup.classList.toggle("is-open");
  factcheckHead.setAttribute("aria-expanded", String(open));
});

factcheckBtn.addEventListener("click", () =>
  sendToPage(factcheckBtn, { type: "JC_FACTCHECK_PAGE", kind: "page" }),
);

factcheckVideoBtn.addEventListener("click", () =>
  sendToPage(factcheckVideoBtn, { type: "JC_FACTCHECK_PAGE", kind: "video" }),
);

// Live audio needs a transcription key first — reveal the field and let them
// type it rather than starting a run that can only fail.
liveBtn.addEventListener("click", () => {
  const key = deepgramInput.value.trim();
  if (!key) {
    setReveal(liveFields, true);
    setTimeout(() => deepgramInput.focus(), 220);
    return;
  }
  chrome.storage.local.set({ [JC_DEEPGRAM_KEY]: key }, () =>
    sendToPage(liveBtn, { type: "JC_FACTCHECK_PAGE", kind: "live" }),
  );
});

deepgramInput.addEventListener("change", () => {
  chrome.storage.local.set({ [JC_DEEPGRAM_KEY]: deepgramInput.value.trim() });
});

factKeyInput.addEventListener("change", () => {
  chrome.storage.local.set({ [JC_GOOGLE_FACT_KEY]: factKeyInput.value.trim() });
});

// --- Keys --------------------------------------------------------------------

function showByokStatus(text, ok) {
  byokStatus.hidden = false;
  byokStatus.textContent = text;
  byokStatus.classList.toggle("is-ok", !!ok);
  byokStatus.classList.toggle("is-err", !ok);
}

// Save, then verify against the key's OWN provider so a bad key is caught here
// rather than on the user's next highlight. The provider is read off the key's
// prefix — nobody should have to know what a dropdown means to paste a key.
byokSaveBtn.addEventListener("click", async () => {
  const apiKey = byokKeyInput.value.trim();
  const model = byokModelInput.value.trim();
  if (!apiKey) {
    showByokStatus("Paste your API key first.", false);
    byokKeyInput.focus();
    return;
  }

  const provider = jcDetectKeyProvider(apiKey);
  if (!provider) {
    showByokStatus(
      "That doesn't look like a key JustClarify knows — Anthropic (sk-ant-), OpenAI (sk-), Gemini (AIza), Hugging Face (hf_) and AI Gateway (vck_) keys work.",
      false,
    );
    return;
  }
  const spec = JC_KEY_PROVIDERS[provider];

  chrome.storage.local.set({
    [JC_BYOK_KEY_KEY]: apiKey,
    [JC_BYOK_MODEL_KEY]: model,
    [JC_BYOK_PROVIDER_KEY]: provider,
    [JC_BYOK_ENABLED_KEY]: true,
  });
  store.byokEnabled = true;
  store.savedKey = apiKey;
  store.savedProvider = provider;
  store.savedModel = model;
  byokKeyInput.value = "";
  render();
  showByokStatus(`Testing your ${spec.label} key…`, true);

  try {
    const res = await fetch(spec.validate, { headers: spec.headers(apiKey) });
    if (res.ok) {
      showByokStatus(`Key works — using ${model || spec.defaultModel} on ${spec.label}.`, true);
    } else if (res.status === 401 || res.status === 403) {
      showByokStatus(`${spec.label} rejected the key — check it and paste again.`, false);
    } else if (res.status === 402) {
      showByokStatus(`${spec.label} reports no credit on this key.`, false);
    } else if (res.status === 400 && provider === "gemini") {
      // Gemini answers a bad key on this endpoint with 400, not 401.
      showByokStatus("Google Gemini rejected the key — check it and paste again.", false);
    } else {
      showByokStatus(`Saved, but the test returned HTTP ${res.status}.`, false);
    }
  } catch (_) {
    showByokStatus(`Saved, but couldn't reach ${spec.label} to test it.`, false);
  }
  loadEngine();
});

// Switching models on a saved key — takes effect on the next ask; the worker
// reads jcByokModel per request, so there is nothing else to poke.
byokModelEdit?.addEventListener("change", () => {
  const model = byokModelEdit.value.trim();
  chrome.storage.local.set({ [JC_BYOK_MODEL_KEY]: model });
  store.savedModel = model;
  const spec = JC_KEY_PROVIDERS[store.savedProvider];
  byokSavedHint.textContent = `Model: ${model || (spec ? spec.defaultModel : "default")}`;
  showByokStatus(
    model ? `Model switched to ${model}.` : `Back to the default model${spec ? ` (${spec.defaultModel})` : ""}.`,
    true,
  );
  loadEngine();
});

// Delete is the only way a saved key changes: no editing in place. Clearing it
// re-opens the entry fields for the replacement paste.
byokDeleteBtn.addEventListener("click", () => {
  chrome.storage.local.remove([JC_BYOK_KEY_KEY, JC_BYOK_MODEL_KEY, JC_BYOK_PROVIDER_KEY]);
  chrome.storage.local.set({ [JC_BYOK_ENABLED_KEY]: false });
  store.byokEnabled = false;
  store.savedKey = "";
  store.savedProvider = "";
  store.savedModel = "";
  byokKeyInput.value = "";
  byokModelInput.value = "";
  if (byokModelEdit) byokModelEdit.value = "";
  byokStatus.hidden = true;
  render();
  loadEngine();
});

historyBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
  window.close();
});

// Keep in sync if another surface changes settings while this is open.
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[JC_BYOK_ENABLED_KEY] || changes[JC_BYOK_KEY_KEY]) load();
  });
}

// --- the walk through's half of the baton ------------------------------------
//
// onboarding.js runs on the page and cannot see or draw over this popup, so the
// two halves talk through chrome.storage.local. Opening this popup is also the
// ONLY signal the page can get that the toolbar was clicked, which is why the
// flag is written here rather than inferred there.
(function jcWalkThrough() {
  const banner = document.getElementById("jc-walk");
  const text = document.getElementById("jc-walk-text");
  if (!banner || !text) return;

  const LINES = {
    // Stage names mirror STAGES in onboarding.js.
    toolbar: "Nice. Now pick Your LLM below, so answers come from the ChatGPT you already pay for.",
    engine: "Pick Your LLM below. It costs you nothing extra, because you are already paying for it.",
    voiceIntro: "Now choose Early access. It is free while it lasts, and it is what powers voice.",
  };

  chrome.storage.local.get("jcOnboard", (all) => {
    const state = all?.jcOnboard;
    if (!state || state.status !== "running") return;

    // Tell the page the toolbar was clicked. Its first step is waiting on
    // exactly this, and nothing else on a page can observe it.
    chrome.storage.local.set({ jcOnboard: { ...state, popupOpen: true, at: Date.now() } });

    const line = LINES[state.stage];
    if (!line) return;
    text.textContent = line;
    banner.hidden = false;
  });
})();

// Paint the popup with this load's shared random accent.
try {
  if (typeof jcInitBrand === "function") jcInitBrand();
} catch (_) {}

load();
