// JustClarify toolbar popup — every setting the extension has, in one place.
// Reads and writes chrome.storage.local; content scripts and the service
// worker react to those changes live, so nothing here needs a save button
// except the keys (which are verified when saved).

const JC_PANEL_KEY = "jcPanelOn";
const JC_BYOK_ENABLED_KEY = "jcByokEnabled";
const JC_BYOK_KEY_KEY = "jcByokKey";
const JC_BYOK_MODEL_KEY = "jcByokModel";
const JC_DEEPGRAM_KEY = "jcDeepgramKey";
const JC_GOOGLE_FACT_KEY = "jcGoogleFactKey";
const JC_DEFAULT_MODEL = "openai/gpt-4o-mini";

let store = { panelOn: false, byokEnabled: false };

const $ = (id) => document.getElementById(id);

const panelSwitch = $("jc-panel-switch");
const byokSwitch = $("jc-byok-switch");
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

function setSwitch(el, on) {
  el.classList.toggle("is-on", on);
  el.setAttribute("aria-checked", String(on));
}

function setReveal(el, open) {
  el.dataset.open = String(open);
}

function render() {
  setSwitch(panelSwitch, store.panelOn);
  setSwitch(byokSwitch, store.byokEnabled);
  setReveal(byokFields, store.byokEnabled);
}

// --- Engine card -------------------------------------------------------------
// Asks the service worker what will actually answer the next question, and says
// so plainly — including, when the built-in model is out of reach, that a key
// is now the only way to keep using the extension on this machine.
function renderEngine(info) {
  const dot = $("jc-head-dot");
  const headText = $("jc-head-engine-text");
  const card = $("jc-engine");
  const name = $("jc-engine-name");
  const state = $("jc-engine-state");
  const detail = $("jc-engine-detail");
  const progress = $("jc-engine-progress");

  dot.className = "jc-dot";
  state.className = "jc-engine-state";
  card.classList.remove("is-blocked");
  progress.hidden = true;

  if (!info || !info.ok) {
    headText.textContent = "Unknown";
    name.textContent = "Engine";
    state.textContent = "";
    detail.textContent = "Couldn't reach the extension's background worker.";
    return;
  }

  const { availability, hasKey, model, blocked } = info;

  if (availability === "available") {
    dot.classList.add("is-ok");
    headText.textContent = "On-device";
    name.textContent = "On-device AI";
    state.textContent = "Ready";
    state.classList.add("is-ok");
    detail.textContent =
      "Answers run on this machine — free, private, works offline. Nothing is sent anywhere.";
    return;
  }

  if (availability === "downloading") {
    dot.classList.add("is-busy");
    headText.textContent = "Setting up";
    name.textContent = "On-device AI";
    state.textContent = "Downloading";
    detail.textContent =
      "Chrome is downloading the built-in model (about 4GB, one time). Ask something and you'll see progress.";
    progress.hidden = false;
    return;
  }

  if (availability === "downloadable") {
    dot.classList.add("is-warn");
    headText.textContent = hasKey ? "Your key" : "Not yet";
    name.textContent = "On-device AI";
    state.textContent = "Not downloaded";
    detail.textContent = hasKey
      ? `Your key (${model || JC_DEFAULT_MODEL}) answers for now, while Chrome pulls the built-in model down for later.`
      : "Chrome hasn't downloaded the built-in model yet (about 4GB, one time). Your first question starts it.";
    return;
  }

  // unavailable — the machine or the browser can't run it at all.
  if (hasKey) {
    dot.classList.add("is-ok");
    headText.textContent = "Your key";
    name.textContent = "Your own key";
    state.textContent = "Ready";
    state.classList.add("is-ok");
    detail.textContent = `${model || JC_DEFAULT_MODEL} via Vercel AI Gateway. The built-in model isn't available on this device, so every answer goes through your key.`;
    return;
  }

  dot.classList.add("is-off");
  headText.textContent = "Needs a key";
  card.classList.add("is-blocked");
  name.textContent = blocked ? blocked.headline : "No engine available";
  state.textContent = "Blocked";
  state.classList.add("is-off");
  detail.textContent =
    (blocked ? blocked.detail + " " : "") +
    "Turn on “Use your own AI key” below and JustClarify works normally again.";
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
    [JC_PANEL_KEY, JC_BYOK_ENABLED_KEY, JC_BYOK_KEY_KEY, JC_BYOK_MODEL_KEY, JC_DEEPGRAM_KEY, JC_GOOGLE_FACT_KEY],
    (res) => {
      store.panelOn = !!res[JC_PANEL_KEY];
      store.byokEnabled = !!res[JC_BYOK_ENABLED_KEY];
      if (res[JC_BYOK_KEY_KEY]) byokKeyInput.value = res[JC_BYOK_KEY_KEY];
      if (res[JC_BYOK_MODEL_KEY]) byokModelInput.value = res[JC_BYOK_MODEL_KEY];
      if (res[JC_DEEPGRAM_KEY]) deepgramInput.value = res[JC_DEEPGRAM_KEY];
      if (res[JC_GOOGLE_FACT_KEY]) factKeyInput.value = res[JC_GOOGLE_FACT_KEY];
      render();
      loadEngine();
    },
  );
}

// --- Toggles -----------------------------------------------------------------

panelSwitch.addEventListener("click", () => {
  store.panelOn = !store.panelOn;
  chrome.storage.local.set({ [JC_PANEL_KEY]: store.panelOn });
  render();
});

byokSwitch.addEventListener("click", () => {
  store.byokEnabled = !store.byokEnabled;
  chrome.storage.local.set({ [JC_BYOK_ENABLED_KEY]: store.byokEnabled });
  render();
  loadEngine();
  if (store.byokEnabled && !byokKeyInput.value) {
    // Opening the section is a request to fill it in.
    setTimeout(() => byokKeyInput.focus(), 220);
  }
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
        // Swap only the label — the button also holds an icon and the line of
        // helper text, and textContent on the button itself would eat both.
        const label = button.querySelector(".jc-btn-label") || button;
        const original = label.textContent;
        label.textContent = "Open a regular webpage first";
        setTimeout(() => (label.textContent = original), 1800);
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

// Save, then verify against the Gateway's /models so a bad key is caught here
// rather than on the user's next highlight.
byokSaveBtn.addEventListener("click", async () => {
  const apiKey = byokKeyInput.value.trim();
  const model = byokModelInput.value.trim();
  if (!apiKey) {
    showByokStatus("Paste your AI Gateway key first.", false);
    byokKeyInput.focus();
    return;
  }

  chrome.storage.local.set({
    [JC_BYOK_KEY_KEY]: apiKey,
    [JC_BYOK_MODEL_KEY]: model,
    [JC_BYOK_ENABLED_KEY]: true,
  });
  store.byokEnabled = true;
  render();
  showByokStatus("Testing key…", true);

  try {
    const res = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      showByokStatus(`Key works — using ${model || JC_DEFAULT_MODEL}`, true);
    } else if (res.status === 401 || res.status === 403) {
      showByokStatus("Key rejected. Check it on vercel.com → AI Gateway.", false);
    } else if (res.status === 402) {
      showByokStatus("Key has no credit on the Gateway.", false);
    } else {
      showByokStatus(`Saved, but the test returned HTTP ${res.status}.`, false);
    }
  } catch (_) {
    showByokStatus("Saved, but couldn't reach the Gateway to test it.", false);
  }
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
    if (changes[JC_PANEL_KEY] || changes[JC_BYOK_ENABLED_KEY]) load();
  });
}

// Paint the popup with this load's shared random accent.
try {
  if (typeof jcInitBrand === "function") jcInitBrand();
} catch (_) {}

load();
