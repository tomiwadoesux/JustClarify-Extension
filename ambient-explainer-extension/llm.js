// llm.js — the "Your LLM" engine: answers from the chat site the user already
// pays for (ChatGPT, Claude, Gemini), driven in a temporary tab.
//
// This path existed once before (chatgpt-agent.js / claude-agent.js) and was
// removed for being intrusive: it drove whatever tab it found and hijacked the
// user's real conversations. This version owns ONE tab it created itself,
// parked in a symbol-titled tab group at the far right edge of the tab strip,
// and never touches any other tab. Close the tab and the next ask just makes a
// new one.
//
// Two ways in, and the fast one is only ever an optimisation:
//
//   1. URL. Every provider here reads the prompt out of a query parameter
//      (?q=), which is the same mechanism their own shareable prompt links
//      use — one navigation replaces load-wait + type + click. ChatGPT's
//      temporary-chat and Claude's incognito keep these asks out of the
//      user's history. But a query parameter is a WEBSITE FEATURE, not an
//      API contract: it can be renamed or dropped with no announcement,
//      and it only applies to a brand-new conversation anyway.
//   2. Typing. The universal backstop. Used automatically whenever the URL
//      attempt can't be *proven* to have submitted within a few seconds, and
//      always for continuing an existing conversation — which is what lets
//      context accumulate across follow-ups.
//
// Nothing trusts that a send happened: pageSubmitTaken() waits for the page's
// own evidence (composer emptied, or a stop button appeared) and presses again
// if it doesn't come. "The prompt just sat in the textbox" is that bug's name.
//
// Streaming physics, learned the hard way: background tabs get no
// requestAnimationFrame and 1s-clamped timers, and Chrome freezes or discards
// the CPU-hungry ones — so we never wait for the page to PUSH anything.
// The service worker (not subject to page-visibility throttling) POLLS the
// hidden tab with chrome.scripting.executeScript and reads the reply straight
// out of the DOM. That is also why the group can sit COLLAPSED: we never
// depend on the hidden page scheduling its own work. `autoDiscardable: false`
// keeps Memory Saver's hands off the tab.
//
// HONEST LIMITS, so nobody mistakes this tier for the API one:
//   - Selectors break when providers redesign. That is the deal with this
//     whole category. The dormant selector-check workflow can watch them.
//   - The user must already be logged in to the provider; we detect the
//     logged-out case and say so rather than typing into a void.
//   - Provider terms generally frown on UI automation. This runs only in the
//     user's own browser, on their own account, at their explicit choice.
//
// Exposes: llmAsk(prompt, reqId, tabId), llmProviders(), llmCurrentProvider()

const LLM_PROVIDERS = {
  chatgpt: {
    name: "ChatGPT",
    symbol: "◉",
    url: "https://chatgpt.com/",
    host: "chatgpt.com",
    // THE fast path: the prompt rides in the URL and ChatGPT submits it
    // itself on load — no editor wait, no typing, no send click, and
    // temporary-chat keeps these asks out of the user's ChatGPT history.
    // One navigation replaces the three steps that were slow and the two
    // that could silently fail.
    // `model` is optional and user-chosen (jcLlmModel in the popup): ChatGPT
    // reads it off the URL the same way it reads ?q=. Wrong or stale slugs are
    // simply ignored by the site, so this can never break an ask.
    askUrl: (prompt, model) =>
      `https://chatgpt.com/?temporary-chat=true&q=${encodeURIComponent(prompt)}` +
      (model ? `&model=${encodeURIComponent(model)}` : ""),
    editor: ["#prompt-textarea", 'div[contenteditable="true"]'],
    send: [
      'button[data-testid="send-button"]',
      "#composer-submit-button",
      'button[aria-label*="Send" i]',
    ],
    reply: ['[data-message-author-role="assistant"]'],
    busy: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
    // Where the page names the model it is using — the switcher button in the
    // header. Best-effort: when the selector rots, the badge just says
    // "ChatGPT" as it always did.
    modelLabel: [
      'button[data-testid="model-switcher-dropdown-button"]',
      '[data-testid*="model-switcher"]',
    ],
  },
  claude: {
    name: "Claude",
    symbol: "◈",
    url: "https://claude.ai/new",
    host: "claude.ai",
    // Claude prefills from ?q= but doesn't submit — so the ask is one
    // navigation plus a single programmatic send, still no typing.
    // `incognito` is Claude's temporary-chat equivalent, so these asks stay
    // out of the user's Claude history the same way ChatGPT's do.
    askUrl: (prompt) =>
      `https://claude.ai/new?incognito=true&q=${encodeURIComponent(prompt)}`,
    editor: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'],
    send: ['button[aria-label="Send message"]', 'button[aria-label*="Send" i]'],
    reply: ['[data-testid="assistant-message"]', ".font-claude-message"],
    busy: ['button[aria-label*="Stop" i]'],
    modelLabel: ['[data-testid="model-selector-dropdown"]', 'button[aria-label*="model" i]'],
  },
  perplexity: {
    name: "Perplexity",
    symbol: "⬡",
    url: "https://www.perplexity.ai/",
    host: "perplexity.ai",
    askUrl: (prompt) => `https://www.perplexity.ai/search?q=${encodeURIComponent(prompt)}`,
    editor: ['textarea[placeholder*="Ask" i]', 'div[contenteditable="true"]', "textarea"],
    send: ['button[aria-label*="Submit" i]', 'button[type="submit"]'],
    reply: ['[class*="prose"]', '[class*="answer"]'],
    busy: ['button[aria-label*="Stop" i]'],
  },
  grok: {
    name: "Grok",
    symbol: "⟡",
    url: "https://grok.com/",
    host: "grok.com",
    askUrl: (prompt) => `https://grok.com/?q=${encodeURIComponent(prompt)}`,
    editor: ['textarea', 'div[contenteditable="true"]'],
    send: ['button[type="submit"]', 'button[aria-label*="Submit" i]', 'button[aria-label*="Send" i]'],
    reply: ['[class*="message-bubble"]', '[class*="response-content"]', ".prose"],
    busy: ['button[aria-label*="Stop" i]'],
  },
  gemini: {
    name: "Gemini",
    symbol: "⬢",
    url: "https://gemini.google.com/app",
    host: "gemini.google.com",
    askUrl: (prompt) => `https://gemini.google.com/app?q=${encodeURIComponent(prompt)}`,

    editor: ['.ql-editor[contenteditable="true"]', 'div[contenteditable="true"]'],
    send: ['button[aria-label*="Send" i]', "button.send-button"],
    reply: ["message-content", ".model-response-text"],
    busy: ['button[aria-label*="Stop" i]'],
    modelLabel: ["bard-mode-switcher", '[data-test-id="bard-mode-menu-button"]'],
  },
};

// Read the model's NAME off the page — the label on the model-switcher button
// ("GPT-5.2", "Sonnet 4.5"), so the answer badge can say which model actually
// wrote the answer rather than just which site. Runs in the driven tab.
function pageModelLabel(selectors) {
  for (const sel of selectors || []) {
    let el = null;
    try {
      el = document.querySelector(sel);
    } catch (_) {
      continue;
    }
    if (!el || !el.getClientRects().length) continue;
    const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    // A real model name is short. A long string means the selector caught a
    // container, and showing a paragraph on the badge is worse than nothing.
    if (text && text.length <= 40) return text;
  }
  return "";
}

// --- the little window ------------------------------------------------------
//
// The provider's temporary chat runs in a small popup window parked next to the
// cursor, instead of a hidden tab in a collapsed group. The reason is physics,
// not taste: a hidden tab gets no animation frames, a starved timer budget and
// Energy Saver freezing, so the chat page never WRITES its streamed answer and
// there is nothing to read. Measured in a real Chrome, a popup window created
// with focused:false reports visibilityState "visible" and runs a full 60
// frames a second — so the page renders normally and the answer simply streams.
// No audio-tone exemption, no animation-frame patching, no fighting the
// browser's power management at all.
//
// Two hard limits, both found by measurement rather than assumption:
//   - Chrome REFUSES a window whose bounds are not at least 50% on screen; it
//     throws outright, so a naive "cursor + 16" fails every time the pointer is
//     near a right or bottom edge. llmPopupPlace flips and then clamps.
//   - The height floor is about 96px, so the idle state bottoms out around
//     320x100 rather than a true sliver.
const LLM_POPUP = {
  // The tile. This is the size at CREATION and the size it stays — there is no
  // "grow to work, shrink to idle" any more, because growing is what made the
  // surface unambient: you watched a chat UI type and scroll in a sliver.
  width: 220,
  height: 220,
  gap: 16, // how far off the cursor it sits

  // The catch, and how it is answered. At ~200px of real width every provider
  // renders its MOBILE layout: composers collapse behind overflow menus and
  // unmount, and the driver's five getClientRects() gates then find no editor
  // at all. So the window is shrunk but the PAGE IS ZOOMED OUT, which buys back
  // a full desktop CSS viewport inside the tiny box — 220px of window at 0.25
  // is 880 CSS pixels of page. Nobody has to read it; it only has to lay out,
  // and the tile covers it regardless.
  //
  // 0.25 is Chrome's own floor for zoom, so this is as much viewport as a box
  // this size can be given.
  zoom: 0.25,

  // If a provider still can't mount a composer in there, the ask falls back to
  // this and the tile hides it just the same. Costs one resize on the rare miss
  // rather than making every ask loud.
  fallbackWidth: 420,
  fallbackHeight: 600,
};

// The one line the tile ever says. Chrome clamps a popup to a minimum size it
// does not document, so the window that arrives is usually bigger than the 220
// asked for above — and nothing on screen tells you that dragging a corner is
// allowed, let alone that the size sticks. This does, once, and then stops:
// the moment the window is actually smaller than what Chrome granted, the
// caption has done its job and disappears. Drag it back up and it returns,
// because at that size the advice is true again.
const LLM_TILE_HINT = "Adjust me to be smaller";
// Slack against Chrome's own rounding, so a window that lands a pixel under its
// granted size does not read as a deliberate shrink.
const LLM_TILE_SHRUNK_BY = 8;

// What Chrome GRANTED the tile at creation, and what size it is right now —
// both in real window pixels, which is not what the page inside can measure:
// the tab is zoomed to 0.25, so `innerWidth` reports roughly four times the
// window's actual width. The veil is handed the real number so it can size
// itself in pixels the user will actually see.
//
// `shrunk` is a remembered VERDICT rather than a live comparison, because the
// window's live size is not always the user's: an ask that a provider cannot
// fit in the tile borrows 420x600 for a moment (llmAskNow), and a borrowed size
// must not un-answer a question the user already answered by dragging a corner.
//
// All three are mirrored into storage, because an MV3 worker is killed and
// restarted freely and losing the baseline would set a deliberately-shrunk
// window nagging again.
let llmTile = { base: null, now: null, shrunk: false };

async function llmTileLoad() {
  try {
    const { jcLlmTile } = await chrome.storage.local.get(["jcLlmTile"]);
    // Only if nothing has been recorded since the read started — a window
    // created during the round-trip holds the newer truth.
    if (jcLlmTile && jcLlmTile.base && !llmTile.base) llmTile = jcLlmTile;
  } catch (_) {}
}
llmTileLoad();

function llmTileSet(next) {
  llmTile = { ...llmTile, ...next };
  chrome.storage.local.set({ jcLlmTile: llmTile }).catch(() => {});
}

// Smaller than the window Chrome handed us on either axis. Dragging it back up
// to the granted size clears it again, which is the whole behaviour: the advice
// is true at that size, so it is offered at that size.
function llmTileIsSmaller(size) {
  const base = llmTile.base;
  if (!base || !size) return false;
  return (
    size.width <= base.width - LLM_TILE_SHRUNK_BY ||
    size.height <= base.height - LLM_TILE_SHRUNK_BY
  );
}

function llmTileShrunk() {
  return !!llmTile.shrunk;
}

// Ask this many times on a site before checking again whether the window is
// still wanted. Counted per SITE, so wandering between subpages keeps the count
// and only a different site starts over.
const LLM_KEEP_EVERY = 5;

const LLM_GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
const LLM_POLL_MS = 250;
const LLM_TIMEOUT_MS = 120_000;
// The answer has stopped growing for this long, so it is finished — even if the
// stop-button selector is wrong and still claims the model is generating. Well
// above the gap between streamed tokens (sub-second), well below the old
// two-minute wedge this replaces.
const STABLE_DONE_MS = 4000;

function llmProviders() {
  return Object.entries(LLM_PROVIDERS).map(([id, p]) => ({ id, name: p.name, symbol: p.symbol }));
}

// --- keeping a hidden tab painting -------------------------------------------

// A hidden tab gets no animation frames, and chat UIs flush their buffered
// stream inside requestAnimationFrame — so the tokens arrive over the network
// and are never written to the DOM. We poll the DOM, so we read nothing and
// wait. That is the whole of "I have to open the LLM tab before the answer
// comes back". llm-keepalive.js fixes it from inside the page.
//
// Registered rather than injected because it has to run at document_start, and
// scoped by a stamp rather than by match pattern so it can never affect a
// user's own provider tabs — only the one JustClarify drives.
const LLM_KEEPALIVE_ID = "jc-llm-keepalive";

async function llmRegisterKeepalive() {
  const matches = Object.values(LLM_PROVIDERS).map((p) => `*://*.${p.host}/*`);
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [LLM_KEEPALIVE_ID],
    });
    if (existing.length) {
      // Re-register so an updated file is picked up after a reload.
      await chrome.scripting.unregisterContentScripts({ ids: [LLM_KEEPALIVE_ID] });
    }
  } catch (_) {}
  try {
    await chrome.scripting.registerContentScripts([
      {
        id: LLM_KEEPALIVE_ID,
        matches,
        // Both MAIN-world, both document_start, both gated by the jcDrive stamp:
        // keepalive patches rendering, net reads the answer stream. net is
        // listed first so it wraps fetch before the page can grab its own copy.
        js: ["llm-net.js", "llm-keepalive.js"],
        runAt: "document_start",
        world: "MAIN",
        allFrames: false,
      },
    ]);
  } catch (_) {
    // Older Chrome without MAIN-world registration: the tab still works, it
    // just needs looking at. Not worth failing the engine over.
  }
}
llmRegisterKeepalive();

// The stamp lives on <html>, so every navigation wipes it. Cheap and
// idempotent, so it is re-applied generously rather than tracked precisely.
async function llmStampTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        document.documentElement.dataset.jcDrive = "1";
      },
    });
  } catch (_) {}
}

// Whether the driven window should currently be showing its tile rather than
// the provider's page. Sign-in and error paths clear it, because those are the
// one time the user genuinely has to SEE what the page is showing.
let llmVeilWanted = false;

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.status) return;
  try {
    const { jcLlmTabId } = await chrome.storage.local.get(["jcLlmTabId"]);
    if (jcLlmTabId !== tabId) return;
    llmStampTab(tabId);
    // A navigation wipes the page, and the tile with it. Put it straight back,
    // on "loading" as well as "complete", so a provider that routes between
    // views mid-ask can't flash its page through.
    if (llmVeilWanted) llmPopupVeil(tabId, true, true);
  } catch (_) {}
});

async function llmCurrentProvider() {
  const { jcLlmProvider } = await chrome.storage.local.get(["jcLlmProvider"]);
  return LLM_PROVIDERS[jcLlmProvider] ? jcLlmProvider : "chatgpt";
}

// --- the temp tab -------------------------------------------------------------

async function llmGroupTab(tabId, provider, collapsed) {
  // The ambient group: symbol title, random colour, far right, COLLAPSED —
  // it should take up as close to zero attention as a tab strip allows. The
  // scheduling cost of collapsing doesn't matter here because the WORKER
  // polls the tab with executeScript; we never depend on the hidden page
  // scheduling its own work.
  try {
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, {
      title: provider.symbol,
      color: LLM_GROUP_COLORS[Math.floor(Math.random() * LLM_GROUP_COLORS.length)],
      collapsed,
    });
    try { await chrome.tabGroups.move(groupId, { index: -1 }); } catch (_) {}
  } catch (_) {
    // Grouping is presentation, not function.
  }
}

// Where to put the window so it sits by the cursor AND Chrome accepts it.
// Chrome throws "Bounds must be at least 50% within visible screen space", so
// this flips the window to the other side of the pointer when it would hang off
// an edge, then clamps it fully inside the display as a last resort.
function llmPopupPlace(cursor, size) {
  const fallback = { left: undefined, top: undefined };
  if (!cursor || typeof cursor.availWidth !== "number") return fallback;

  const L = cursor.availLeft;
  const T = cursor.availTop;
  const R = L + cursor.availWidth;
  const B = T + cursor.availHeight;
  // A display smaller than the window: let Chrome place it rather than fighting.
  if (size.width > cursor.availWidth || size.height > cursor.availHeight) return fallback;

  // BOTTOM-RIGHT, not beside the cursor. Following the pointer made sense when
  // this window was the answer surface and you wanted it next to what you were
  // reading — but it is a tile now, it says nothing, and a box that appears
  // under your hand in the middle of the page is something to dismiss rather
  // than something ambient. The bottom-right corner is where a system tray
  // lives: present, findable, never in the way of the text.
  const left = Math.round(Math.min(Math.max(R - size.width - LLM_POPUP.gap, L), R - size.width));
  const top = Math.round(Math.min(Math.max(B - size.height - LLM_POPUP.gap, T), B - size.height));
  return { left, top };
}

// Our own resizes and moves fire onBoundsChanged too, and must not be mistaken
// for the user dragging the window. Anything inside this window of time is ours.
let llmSelfMoveUntil = 0;
function llmSelfMove() {
  llmSelfMoveUntil = Date.now() + 1500;
}

// The user dragged or resized it: from now on it stays where they put it rather
// than chasing the cursor on every ask.
chrome.windows.onBoundsChanged.addListener(async (win) => {
  if (Date.now() < llmSelfMoveUntil) return; // that was us
  try {
    const { jcLlmWindowId, jcLlmTabId } = await chrome.storage.local.get([
      "jcLlmWindowId",
      "jcLlmTabId",
    ]);
    if (jcLlmWindowId !== win.id) return;
    await chrome.storage.local.set({
      jcLlmWindowMoved: true,
      jcLlmWindowBounds: { left: win.left, top: win.top, width: win.width, height: win.height },
    });
    const now = { width: win.width, height: win.height };
    llmTileSet({ now, shrunk: llmTileIsSmaller(now) });
    // Live, while the corner is still being dragged: the caption asked for this
    // resize, so it has to answer the moment it gets one rather than waiting
    // for the next ask to redraw the tile.
    if (jcLlmTabId != null) {
      llmExec(jcLlmTabId, pageVeilHint, [llmTileShrunk() ? "" : LLM_TILE_HINT, win.width]).catch(
        () => {},
      );
    }
    llmTrace("window-moved", { left: win.left, top: win.top, width: win.width, height: win.height });
  } catch (_) {}
});

// They closed it. Forget everything about it so the next ask opens a clean one
// rather than trying to drive a window that no longer exists.
chrome.windows.onRemoved.addListener(async (windowId) => {
  try {
    const { jcLlmWindowId } = await chrome.storage.local.get(["jcLlmWindowId"]);
    if (jcLlmWindowId !== windowId) return;
    await chrome.storage.local.remove([
      "jcLlmWindowId",
      "jcLlmTabId",
      "jcLlmWindowMoved",
      "jcLlmWindowBounds",
      "jcLlmTile",
    ]);
    llmTile = { base: null, now: null, shrunk: false };
    llmTrace("window-closed", { windowId });
  } catch (_) {}
});

// Zoom the driven tab out so a tile-sized window still hands the provider a
// desktop-sized CSS viewport to lay out in. PER-TAB scope is not optional: the
// default is per-ORIGIN, which would quietly change the zoom on the user's own
// chatgpt.com tabs and keep it that way after this window is long gone.
async function llmTileZoom(tabId) {
  if (tabId == null) return;
  try {
    // Every setZoom call makes Chrome flash its zoom bubble over the tile —
    // browser UI, above any veil, unsuppressible. This runs on EVERY ask via
    // llmPopupWake, so an already-zoomed tab must be a no-op or the bubble
    // becomes a permanent fixture of asking a question. Checked first, the
    // bubble appears once when the window is born and never again.
    const current = await chrome.tabs.getZoom(tabId).catch(() => null);
    if (current != null && Math.abs(current - LLM_POPUP.zoom) < 0.01) return;
    await chrome.tabs.setZoomSettings(tabId, { scope: "per-tab", mode: "automatic" });
    await chrome.tabs.setZoom(tabId, LLM_POPUP.zoom);
  } catch (_) {
    // Zoom refused: the window still works, the page just lays out narrow. The
    // composer fallback below covers the case where that costs us the editor.
  }
}

// Put the window where it belongs for an ask. It does NOT grow to do this any
// more: the tile is the working size as well as the resting size, because
// growing is what made this surface loud. Never minimised — a minimised window
// is hidden, and hidden is the whole problem this popup exists to solve.
async function llmPopupWake(windowId, tabId, cursor) {
  const stored = await chrome.storage.local.get(["jcLlmWindowMoved", "jcLlmWindowBounds"]);
  const size = { width: LLM_POPUP.width, height: LLM_POPUP.height };
  const update = { state: "normal", focused: false };

  if (stored.jcLlmWindowMoved && stored.jcLlmWindowBounds) {
    // They put it somewhere deliberately. Respect the position AND the size,
    // whichever direction they took it in.
    //
    // This used to be Math.max(theirs, 220), which quietly threw away the only
    // resize anybody actually makes: dragging the tile SMALLER. Every ask put
    // it back to 220 and it read as the window ignoring you. Chrome enforces
    // its own undocumented floor anyway, so there is nothing for us to protect
    // here — asking for less than it allows simply gets clamped, once, and the
    // clamped size is then what we remember.
    const b = stored.jcLlmWindowBounds;
    update.left = b.left;
    update.top = b.top;
    update.width = b.width || size.width;
    update.height = b.height || size.height;
  } else {
    Object.assign(update, size, llmPopupPlace(cursor, size));
  }

  llmSelfMove();
  let landed = null;
  try {
    landed = await chrome.windows.update(windowId, update);
  } catch (_) {
    // Position rejected (cursor data stale, monitor unplugged): size only.
    llmSelfMove();
    try { landed = await chrome.windows.update(windowId, { state: "normal", focused: false, ...size }); } catch (_) {}
  }
  if (landed) {
    const now = { width: landed.width, height: landed.height };
    const known = llmTile.base;
    // No baseline survived (a worker restart before one was ever written): take
    // the size in front of us as the baseline, and let the fact that they had
    // deliberate bounds at all stand in for the comparison we can no longer
    // make. On a window somebody already sized that means silence, which is the
    // right way to be wrong here.
    llmTileSet({
      base: known || now,
      now,
      shrunk: known ? llmTileIsSmaller(now) : !!(stored.jcLlmWindowMoved && stored.jcLlmWindowBounds),
    });
  }
  await llmTileZoom(tabId);
  // Veiled while it WORKS, not only while it rests. The mark drifts through its
  // hues so a working window still reads as alive without showing a word of it.
  llmPopupVeil(tabId, true, true);
}

// Done answering. Settle the mark back to still — the difference between
// working and resting is the animation, not the geometry — and give back any
// size the ask borrowed.
async function llmPopupIdle(windowId, tabId) {
  if (windowId == null) return;
  await llmPopupRestore(windowId);
  llmPopupVeil(tabId, true, false);
}

// A provider that won't mount a composer in the tile makes the ask grow the
// window to 420x600 mid-flight (see llmAskNow). That is a borrow, not a new
// preference: without this the window a user had deliberately shrunk came back
// full-size the moment one provider had trouble, and stayed that way. So hand
// the size back the moment the answer is in.
async function llmPopupRestore(windowId) {
  const stored = await chrome.storage.local.get(["jcLlmWindowMoved", "jcLlmWindowBounds"]);
  const b = stored.jcLlmWindowMoved && stored.jcLlmWindowBounds;
  if (!b || !b.width || !b.height) return;
  try {
    const win = await chrome.windows.get(windowId);
    if (win.width === b.width && win.height === b.height) return; // nothing borrowed
  } catch (_) {
    return; // window is gone
  }
  llmSelfMove();
  try {
    const landed = await chrome.windows.update(windowId, {
      width: b.width,
      height: b.height,
      focused: false,
    });
    if (landed) llmTileSet({ now: { width: landed.width, height: landed.height } });
  } catch (_) {}
}

// --- the ambient tile ---------------------------------------------------------
//
// What the little window shows instead of a cropped webpage: a solid tile with
// the provider's mark in the middle, and nothing else, ever. The window is the
// size of an app icon and it should READ as one. Watching a chat UI type and
// scroll in a 330px sliver is the opposite of ambient, which is the whole point
// of this surface.
//
// This REPLACES the old dim (html{opacity:.4;filter:saturate(.6)}), which could
// not be kept alongside it for two independent reasons: `filter` on <html>
// makes <html> the containing block for every position:fixed descendant, which
// mis-sizes the tile to document height and lets it scroll; and `opacity` is
// GROUP opacity across the whole subtree, so the tile and its mark would fade
// to 40% with everything else, unreachable by z-index or by shadow DOM.
//
// Stacked ON TOP of the page, never hiding it. Every hiding technique breaks the
// driver, in three different ways:
//   - display:none / content-visibility:hidden empty getClientRects(), and five
//     separate gates use that to find the composer. The editor becomes
//     unfindable and llmWaitReady spins out into "didn't finish loading".
//   - visibility:hidden zeroes innerText, so pageRead silently degrades to
//     textContent — which swallows the Copy/Retry/Share labels and drops every
//     block boundary. Because emit() only ever accepts LONGER text, that
//     polluted run-on permanently outranks the clean network read.
//   - visibility also INHERITS into the stop button, pinning `busy` false, and
//     the completion gate then ends the ask at the first 900ms pause in the
//     stream — mid-answer, with no error.
// An element on top is invisible to all three: innerText consults neither paint
// order, z-index nor occlusion.
function pageVeil(on, mark) {
  const ID = "__jc_veil";
  const existing = document.getElementById(ID);

  if (!on) {
    if (existing) {
      const cycle = Number(existing.dataset.jcCycle || 0);
      if (cycle) clearInterval(cycle);
      existing.remove();
    }
    return { veiled: false };
  }
  if (existing) return { veiled: true, already: true };

  const host = document.createElement("div");
  host.id = ID;

  // Written through CSSOM rather than a style attribute or a <style> rule:
  // setProperty is not governed by the page's style-src, and !important puts
  // these beyond the reach of any page rule that happens to match a bare div.
  const lock = {
    position: "fixed", top: "0", right: "0", bottom: "0", left: "0",
    width: "100%", height: "100%", margin: "0", padding: "0", border: "0",
    display: "flex", "align-items": "center", "justify-content": "center",
    // One BELOW the ceiling on purpose: the trust card and the keep card both
    // sit at 2147483647, and they have to land on top of the tile rather than
    // behind it.
    "z-index": "2147483646",
    background: "#090807",
    // No transition and no entry class. The reveal must never depend on
    // requestAnimationFrame: this runs in the isolated world, which the
    // keepalive patch does not reach, so in a throttled window a rAF callback
    // may never fire and the tile would sit at opacity 0 with the raw page
    // showing through — exactly the failure it exists to prevent.
    opacity: "1", visibility: "visible", transform: "none", filter: "none",
    "pointer-events": "auto", cursor: "default",
  };
  for (const key of Object.keys(lock)) host.style.setProperty(key, lock[key], "important");

  const root = host.attachShadow({ mode: "open" });

  // EVERYTHING in here is sized in REAL window pixels, then converted. The tab
  // is zoomed to 0.25 so the page lays out at desktop width in a tile-sized
  // window, which means a CSS pixel in here is a quarter of a pixel on screen:
  // 14px of caption would render as three and a half. `scale` is the true
  // ratio, measured rather than assumed — the worker passes the width Chrome
  // granted the WINDOW, and innerWidth is what the page got, so their quotient
  // is the effective zoom whether or not the zoom call succeeded.
  const realW = Number(mark && mark.tileWidth) || 0;
  const scale = realW > 0 && innerWidth > 0 ? realW / innerWidth : 1;
  const cssPx = (real) => Math.round(real / scale);
  const shortSide = Math.round(Math.min(innerWidth, innerHeight) * scale);

  // Sized off the REAL window so the mark stays proportionate whatever bounds
  // Chrome granted.
  const px = cssPx(Math.max(18, Math.min(72, Math.round(shortSide * 0.34))));

  // The provider's own icon, when its CSP allows it. Same-origin icons load
  // fine under `img-src 'self'`; a cross-origin one (claude.ai serves its icons
  // off a proxy host) is blocked and fires `error`, which swaps in the diamond.
  //
  // The veil now lands BEFORE the page finishes loading, which means the
  // <link rel="icon"> tags it used to read may simply not exist yet — so the
  // well-known root favicon is the fallback, not an empty tile. It is
  // same-origin by construction, needs no markup to have been parsed, and a
  // provider that doesn't serve one just errors into the diamond as before.
  const pickIcon = () => {
    const links = Array.from(document.querySelectorAll('link[rel~="icon"], link[rel~="apple-touch-icon"], link[rel~="apple-touch-icon-precomposed"]'));
    let best = null;
    let bestSize = -1;
    for (const link of links) {
      const href = link.getAttribute("href");
      if (!href) continue;
      const rel = (link.getAttribute("rel") || "").toLowerCase();
      // apple-touch-icon is the big one sites ship for home-screen tiles, which
      // is exactly the look being copied here.
      const bonus = rel.includes("apple") ? 512 : 0;
      const declared = parseInt((link.getAttribute("sizes") || "").split("x")[0], 10);
      const size = (Number.isFinite(declared) ? declared : 32) + bonus;
      if (size > bestSize) { bestSize = size; best = href; }
    }
    return best || location.origin + "/favicon.ico";
  };

  const svgNS = "http://www.w3.org/2000/svg";
  const diamond = () => {
    // The product's own mark, same geometry as the trust card's. Built as DOM
    // rather than innerHTML because Trusted Types (which Google's properties
    // ship) makes innerHTML throw outright.
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 32 32");
    svg.setAttribute("width", String(px));
    svg.setAttribute("height", String(px));
    const outer = document.createElementNS(svgNS, "rect");
    outer.setAttribute("x", "6"); outer.setAttribute("y", "6");
    outer.setAttribute("width", "20"); outer.setAttribute("height", "20");
    outer.setAttribute("rx", "5");
    outer.setAttribute("transform", "rotate(45 16 16)");
    outer.setAttribute("fill", "#fff");
    const inner = document.createElementNS(svgNS, "rect");
    inner.setAttribute("x", "11.5"); inner.setAttribute("y", "11.5");
    inner.setAttribute("width", "9"); inner.setAttribute("height", "9");
    inner.setAttribute("rx", "2.5");
    inner.setAttribute("transform", "rotate(45 16 16)");
    inner.setAttribute("fill", "rgba(9,8,7,0.9)");
    svg.append(outer, inner);
    return { svg, face: outer };
  };

  // A column, so the caption can sit UNDER the mark and the pair stay centred
  // together rather than the mark drifting up to make room for text.
  const stack = document.createElement("div");
  stack.style.setProperty("display", "flex");
  stack.style.setProperty("flex-direction", "column");
  stack.style.setProperty("align-items", "center");
  stack.style.setProperty("gap", `${cssPx(10)}px`);

  const href = pickIcon();
  if (href) {
    const img = document.createElement("img");
    img.width = px;
    img.height = px;
    img.decoding = "async";
    img.style.setProperty("border-radius", `${Math.round(px * 0.22)}px`);
    img.style.setProperty("object-fit", "contain");
    img.addEventListener("error", () => {
      // Blocked by CSP, 404, or not an image. Fall back to the product mark.
      img.remove();
      const { svg } = diamond();
      stack.prepend(svg);
    });
    img.src = href;
    stack.appendChild(img);
  } else {
    const { svg, face } = diamond();
    stack.appendChild(svg);
    // The same slow hue drift the trust card wears, so a window that is working
    // still reads as alive without showing a single word of the page.
    if (mark && mark.alive) {
      let hue = Math.floor(Math.random() * 360);
      const paint = () => {
        hue = (hue + 60 + Math.floor(Math.random() * 90)) % 360;
        face.style.fill = `oklch(0.78 0.15 ${hue})`;
      };
      paint();
      host.dataset.jcCycle = String(setInterval(paint, 1800));
    }
  }

  // The caption. Always built, shown only when the worker says the window is
  // still at the size Chrome granted it — so it is one line of instruction that
  // deletes itself the moment it has been followed, rather than permanent
  // furniture. Kept in the DOM either way so pageVeilHint can toggle it without
  // rebuilding the tile mid-ask.
  const note = document.createElement("div");
  note.id = "jc-veil-note";
  note.style.setProperty("font", `500 ${cssPx(11)}px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`);
  note.style.setProperty("color", "rgba(255,255,255,0.5)");
  note.style.setProperty("letter-spacing", `${cssPx(0.2)}px`);
  note.style.setProperty("text-align", "center");
  note.style.setProperty("max-width", `${cssPx(180)}px`);
  note.style.setProperty("user-select", "none");
  const hint = mark && typeof mark.hint === "string" ? mark.hint : "";
  note.textContent = hint;
  note.style.setProperty("display", hint ? "block" : "none");
  stack.appendChild(note);
  root.appendChild(stack);

  // No click handler, deliberately. This used to be "click to peek at the
  // page", and it read as the tile being broken glass over a chat you were
  // never meant to watch. There is nothing behind the tile the user is meant
  // to interact with — sign-in and errors take the veil down themselves
  // (llmPopupReveal), and a wedged window still has its own close button.
  // Clicks land here and die.
  document.documentElement.appendChild(host);
  return { veiled: true, usedIcon: !!href };
}

// Toggle the caption on a tile that is already up. Separate from pageVeil
// because a resize arrives WHILE an ask is in flight, and tearing the tile down
// to rebuild it would flash the provider's page through — the one thing the
// tile exists to prevent.
function pageVeilHint(text, realWidth) {
  const host = document.getElementById("__jc_veil");
  const note = host && host.shadowRoot && host.shadowRoot.getElementById("jc-veil-note");
  if (!note) return { ok: false };
  const scale = realWidth > 0 && innerWidth > 0 ? realWidth / innerWidth : 1;
  note.style.setProperty("font-size", `${Math.round(11 / scale)}px`);
  note.textContent = text || "";
  note.style.setProperty("display", text ? "block" : "none");
  return { ok: true, shown: !!text };
}

function llmPopupVeil(tabId, on, alive) {
  llmVeilWanted = !!on;
  if (tabId == null) return;
  llmExec(tabId, pageVeil, [
    on,
    {
      alive: !!alive,
      // Empty once they have shrunk it: the caption asked for one thing and got
      // it, so it stops asking.
      hint: llmTileShrunk() ? "" : LLM_TILE_HINT,
      tileWidth: (llmTile.now && llmTile.now.width) || (llmTile.base && llmTile.base.width) || 0,
    },
  ]).catch(() => {});
}

// Sign-in, rate limits, a Cloudflare check: the code deliberately pulls the
// window to the front for these so the user can act on it, and a tile left up
// hides the one thing it is trying to show. Reveal, and stay revealed until the
// next ask puts the tile back.
function llmPopupReveal(tabId) {
  llmPopupVeil(tabId, false);
}

// THE surface resolver. Popup window first, old hidden-tab path as the backstop
// if window creation is refused for any reason — so a Chrome that dislikes our
// bounds, or a locked-down environment, still answers rather than failing.
async function llmEnsureSurface(providerId, askUrl, cursor) {
  const provider = LLM_PROVIDERS[providerId];
  const stored = await chrome.storage.local.get([
    "jcLlmWindowId",
    "jcLlmTabId",
    "jcLlmTabProvider",
  ]);

  // A live window means a live CONVERSATION: later asks type into it and the
  // context accumulates, exactly like chatting there yourself.
  if (stored.jcLlmWindowId != null && stored.jcLlmTabProvider === providerId) {
    try {
      const win = await chrome.windows.get(stored.jcLlmWindowId, { populate: true });
      const tab = (win.tabs || []).find((t) => t.url && t.url.includes(provider.host));
      if (tab) {
        await llmPopupWake(win.id, tab.id, cursor);
        await chrome.storage.local.set({ jcLlmTabId: tab.id });
        llmStampTab(tab.id);
        llmTrace("surface", { mode: "existing", kind: "window", windowId: win.id, tabId: tab.id });
        return { tabId: tab.id, windowId: win.id, mode: "existing" };
      }
    } catch (_) {
      // Window is gone — fall through and make a new one.
    }
  }

  // Fresh little window, born already carrying the question.
  const size = { width: LLM_POPUP.width, height: LLM_POPUP.height };
  const place = llmPopupPlace(cursor, size);
  const spec = {
    url: askUrl || provider.url,
    type: "popup",
    ...size,
    // Deliberately NOT focused: it must never steal the keystroke you are in the
    // middle of typing. Measured to still render at full speed unfocused.
    focused: false,
  };
  if (place.left != null) {
    spec.left = place.left;
    spec.top = place.top;
  }

  let win = null;
  // Chrome enforces a minimum window size it does not document, so the tile may
  // well be clamped on creation — and a clamp fires onBoundsChanged just like a
  // drag does. Claim the move first or the clamp is recorded as user intent,
  // after which llmPopupWake respects it forever and never places the window
  // again.
  llmSelfMove();
  try {
    win = await chrome.windows.create(spec);
  } catch (error) {
    // Almost always the 50%-on-screen rule. Retry once letting Chrome choose.
    llmTrace("window-create-retry", { reason: String(error).slice(0, 90) });
    try {
      win = await chrome.windows.create({ url: spec.url, type: "popup", ...size, focused: false });
    } catch (error2) {
      llmTrace("window-create-failed", { reason: String(error2).slice(0, 90) });
      win = null;
    }
  }

  const winTab = win && win.tabs && win.tabs[0];
  if (win && winTab) {
    try { await chrome.tabs.update(winTab.id, { autoDiscardable: false }); } catch (_) {}
    await chrome.storage.local.set({
      jcLlmWindowId: win.id,
      jcLlmTabId: winTab.id,
      jcLlmTabProvider: providerId,
      // A brand new window is ours to place until they move it themselves.
      jcLlmWindowMoved: false,
    });
    await chrome.storage.local.remove(["jcLlmWindowBounds"]);
    llmStampTab(winTab.id);
    // The baseline the caption is measured against: not the 220 we asked for,
    // but the size Chrome was actually willing to give — otherwise "smaller
    // than initial" would be unreachable on every platform that clamps.
    llmTileSet({
      base: { width: win.width, height: win.height },
      now: { width: win.width, height: win.height },
      shrunk: false,
    });
    // Zoom before anything else: the page is mid-load, so this lands before it
    // has committed to a mobile layout it would then have to reflow out of.
    await llmTileZoom(winTab.id);
    // Chrome documents no minimum window size and enforces one anyway, and the
    // frame overhead is platform chrome rather than a constant. So don't guess:
    // ask for the tile, then record what was actually GRANTED.
    llmTrace("tile", {
      asked: `${LLM_POPUP.width}x${LLM_POPUP.height}`,
      granted: `${win.width}x${win.height}`,
      zoom: LLM_POPUP.zoom,
    });
    // The tile goes up as the page loads rather than after it, so there is as
    // little of a cropped-webpage flash as this can manage. Re-applied on every
    // navigation by the onUpdated hook, since each one wipes the page.
    llmPopupVeil(winTab.id, true, true);
    // The trust note, once, on the first window of a session: this runs on your
    // own account and JustClarify keeps nothing from it. The window being
    // visible does not say that on its own, and it is a promise the privacy
    // policy makes, so it still gets said out loud.
    llmShowOverlay(winTab.id);
    llmTrace("surface", { mode: "fresh", kind: "window", windowId: win.id, tabId: winTab.id });
    return { tabId: winTab.id, windowId: win.id, mode: "fresh", carriedPrompt: !!askUrl };
  }

  // Backstop: the original hidden-tab-in-a-group behaviour.
  llmTrace("surface", { mode: "fallback", kind: "tab" });
  const viaTab = await llmEnsureTab(providerId, askUrl);
  return { ...viaTab, windowId: null };
}

async function llmEnsureTab(providerId, askUrl) {
  const provider = LLM_PROVIDERS[providerId];
  const stored = await chrome.storage.local.get(["jcLlmTabId", "jcLlmTabProvider"]);

  // A live temp tab means a live CONVERSATION — later asks type into it and
  // the context accumulates, exactly like chatting there yourself. The URL
  // fast path is only for the very first ask, when there is nothing to continue.
  if (stored.jcLlmTabId != null && stored.jcLlmTabProvider === providerId) {
    try {
      const tab = await chrome.tabs.get(stored.jcLlmTabId);
      if (tab && tab.url && tab.url.includes(provider.host)) {
        llmStampTab(tab.id);
        return { tabId: tab.id, mode: "existing" };
      }
    } catch (_) {
      // Tab is gone — fall through.
    }
  }

  // The user's own open tab: adopt it, never navigate it — navigating would
  // destroy whatever conversation they have there. Never the active tab.
  try {
    const open = await chrome.tabs.query({ url: `*://${provider.host}/*` });
    const candidate = open.find((t) => !t.active && !t.pinned);
    if (candidate) {
      try { await chrome.tabs.update(candidate.id, { autoDiscardable: false }); } catch (_) {}
      await llmGroupTab(candidate.id, provider, true);
      await chrome.storage.local.set({ jcLlmTabId: candidate.id, jcLlmTabProvider: providerId });
      return { tabId: candidate.id, mode: "adopted" };
    }
  } catch (_) {}

  // Fresh tab, born already carrying the question when the provider supports
  // it — one navigation total. active:true is deliberate and only here: the
  // FIRST open takes the user along to show them what this tab is, under the
  // trust overlay; every later ask happens out of sight.
  const tab = await chrome.tabs.create({ url: askUrl || provider.url, active: true });
  llmStampTab(tab.id); // so the answer still paints once they leave
  // Flag it: llmAskNow must NOT navigate again. Re-issuing the same URL
  // restarts the load and kills the auto-submit that was already in flight.
  try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch (_) {}
  await llmGroupTab(tab.id, provider, false); // collapses when they leave
  await chrome.storage.local.set({ jcLlmTabId: tab.id, jcLlmTabProvider: providerId });
  llmShowOverlay(tab.id); // fire and forget — retries until the tab can hear
  return { tabId: tab.id, mode: "fresh", carriedPrompt: !!askUrl };
}

// --- the trust overlay --------------------------------------------------------

// Shown once, on the first open of a provider's temp tab. Says the one thing
// that matters — JustClarify keeps nothing that happens in this tab, and you
// can leave — then gets out of the way forever.
async function llmShowOverlay(tabId) {
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    try {
      const ack = await chrome.tabs.sendMessage(tabId, { type: "JC_LLM_OVERLAY", show: true });
      if (ack && ack.ok) return;
    } catch (_) {
      // Content script not injected yet — the page is still booting.
    }
  }
}

// Leaving the temp tab is the signal that the introduction is over: hide the
// overlay for good and tuck the tab back into its collapsed symbol group.
let llmLastActiveTab = null;
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const { jcLlmTabId } = await chrome.storage.local.get(["jcLlmTabId"]);
    if (jcLlmTabId != null && llmLastActiveTab === jcLlmTabId && tabId !== jcLlmTabId) {
      chrome.tabs.sendMessage(jcLlmTabId, { type: "JC_LLM_OVERLAY", show: false }).catch(() => {});
      try {
        const tab = await chrome.tabs.get(jcLlmTabId);
        if (tab.groupId != null && tab.groupId >= 0) {
          await chrome.tabGroups.update(tab.groupId, { collapsed: true });
        }
      } catch (_) {}
    }
    llmLastActiveTab = tabId;
  } catch (_) {}
});

// Wait until the tab is loaded AND the provider's editor exists — SPAs report
// status "complete" long before their composer mounts. Bounded, chatty about
// what it's doing, and the reason "sometimes it never stops loading" is gone:
// the old code waited a blind 4 seconds and then failed if the app was slower.
async function llmWaitReady(tempTabId, selectors, notify) {
  const startedAt = Date.now();
  let announced = false;
  while (Date.now() - startedAt < 25_000) {
    let tab;
    try {
      tab = await chrome.tabs.get(tempTabId);
    } catch (_) {
      return { ok: false, reason: "closed" };
    }
    if (tab.status === "complete") {
      let probe = null;
      try {
        probe = await llmExec(tempTabId, pageProbe, [selectors]);
      } catch (_) {
        // Injection can race the navigation; try again next tick.
      }
      if (probe?.editor) return { ok: true };
      if (probe?.login) return { ok: false, reason: "login" };
    }
    if (!announced && Date.now() - startedAt > 2000) {
      announced = true;
      notify("waiting");
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { ok: false, reason: "timeout" };
}

// --- in-page functions (serialized into the tab via executeScript) ------------

function pageProbe(selectors) {
  const first = (list) => {
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el && el.getClientRects().length) return el;
    }
    return null;
  };
  return {
    editor: !!first(selectors.editor),
    login: !!document.querySelector(
      'input[type="password"], [data-testid*="login" i], button[data-testid*="signup" i]',
    ),
  };
}

// Press send on a composer that already holds the text — either prefilled from
// the URL (Claude) or just inserted by pageSubmit. Retried by the caller until
// the page confirms. Never presses an empty box.
function pageSendOnly(selectors) {
  const first = (list) => {
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el && el.getClientRects().length) return el;
    }
    return null;
  };
  const editor = first(selectors.editor);
  const hasText = !!editor && (editor.isContentEditable
    ? (editor.innerText || "").trim().length > 0
    : (editor.value || "").trim().length > 0);
  if (!hasText) return { ok: false, reason: "empty" };

  const send = first(selectors.send);
  const blocked = !send || send.disabled || send.getAttribute("aria-disabled") === "true";
  if (send && !blocked) {
    // Full pointer sequence: plenty of framework buttons listen on pointerdown
    // or mousedown and never see a bare .click().
    const opts = { bubbles: true, cancelable: true, composed: true, button: 0 };
    try {
      send.dispatchEvent(new PointerEvent("pointerdown", opts));
      send.dispatchEvent(new MouseEvent("mousedown", opts));
      send.dispatchEvent(new PointerEvent("pointerup", opts));
      send.dispatchEvent(new MouseEvent("mouseup", opts));
    } catch (_) {}
    send.click();
    return { ok: true, via: "button" };
  }

  // No usable button — Enter in the composer. `composed` matters: ChatGPT's
  // composer sits behind a shadow boundary on some builds and a non-composed
  // event dies at it.
  const enter = {
    key: "Enter", code: "Enter", keyCode: 13, which: 13,
    bubbles: true, cancelable: true, composed: true,
  };
  editor.focus();
  editor.dispatchEvent(new KeyboardEvent("keydown", enter));
  editor.dispatchEvent(new KeyboardEvent("keypress", enter));
  editor.dispatchEvent(new KeyboardEvent("keyup", enter));
  return { ok: true, via: send ? "enter-disabled-button" : "enter" };
}

// Did the question actually go in? Evidence, never a verdict — and the reply
// count is measured AGAINST A BASELINE, because "a reply exists" proves
// nothing in a conversation that already has replies. That was a real bug:
// ask #2 typed its text, the first press silently failed, and the safety loop
// saw ask #1's OLD answer, read it as "answering", and never pressed again.
// The prompt sat in the composer and nothing ever streamed back.
//
// `answering` — a NEW reply (beyond `baseline`) exists, or the stop button is
//   up. Valid proof on any page. A fresh conversation passes baseline 0.
// `emptyComposer` — only proof when the composer demonstrably held our text a
//   moment ago (the typed path). A freshly loaded page is empty too, which
//   was this function's OTHER bug.
function pageSubmitTaken(selectors, baseline) {
  const first = (list) => {
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el && el.getClientRects().length) return el;
    }
    return null;
  };

  const busy = selectors.busy.some((sel) => {
    const el = document.querySelector(sel);
    return el && el.getClientRects().length;
  });
  const replies = document.querySelectorAll(selectors.reply.join(","));
  const answering = busy || replies.length > (baseline || 0);

  const editor = first(selectors.editor);
  const composerText = editor
    ? (editor.isContentEditable ? editor.innerText : editor.value) || ""
    : "";

  return {
    answering,
    emptyComposer: !!editor && !composerText.trim(),
    hasComposerText: !!composerText.trim(),
  };
}

// Put the question in the composer. Inserting only — pressing send is the
// caller's press-loop, which gives the site's framework a beat to enable the
// button before anything gets clicked.
//
// THE BACKGROUND-TAB TRAP, and the reason "the second ask never sends" was
// real: document.execCommand("insertText") requires the DOCUMENT ITSELF to be
// focused. Focusing the element is not enough. In a hidden tab
// document.hasFocus() is false, so execCommand silently no-ops, the composer
// stays empty, pageSendOnly refuses to press an empty box, and the ask dies in
// total silence. The FIRST ask escaped this only because its tab is created
// active — which is exactly why it worked once and never again.
//
// So: four techniques, cheapest and most framework-friendly first, and the
// composer is READ BACK after each one. Nothing is assumed to have worked.
function pageSubmit(selectors, text) {
  const first = (list) => {
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el && el.getClientRects().length) return el;
    }
    return null;
  };

  const editor = first(selectors.editor);
  if (!editor) {
    const looksLoggedOut = !!document.querySelector(
      'input[type="password"], [data-testid*="login" i], a[href*="login" i], button[data-testid*="signup" i]',
    );
    return { ok: false, reason: looksLoggedOut ? "login" : "no-editor" };
  }

  // The COUNT of replies is not enough on its own. ChatGPT reuses and
  // virtualises its message nodes, so a new answer does NOT reliably add a
  // countable one — the poll then waits out its whole two-minute clock while
  // the answer sits plainly on screen. (Measured: baseline 3, replies 3,
  // domChars 0, for the entire run.) So fingerprint the last reply's TEXT too,
  // and let either signal — a new node, or the last one's text changing —
  // count as "the answer arrived".
  const priorReplies = document.querySelectorAll(selectors.reply.join(","));
  const baseline = priorReplies.length;
  const lastPrior = priorReplies[priorReplies.length - 1];
  const baselineText = lastPrior
    ? ((lastPrior.innerText || "").trim() || (lastPrior.textContent || "").trim())
    : "";
  const read = () =>
    ((editor.isContentEditable ? editor.innerText : editor.value) || "").trim();
  const landed = () => {
    const now = read();
    // A prefix match is enough: ProseMirror may still be reconciling the tail.
    return now.length > 0 && (now === text.trim() || text.trim().startsWith(now.slice(0, 40)));
  };

  editor.focus();
  let method = "";

  if (editor.isContentEditable || editor.getAttribute("contenteditable") === "true") {
    // Select what's there so every technique REPLACES the draft, never appends.
    const selectAll = () => {
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {}
    };

    // 1. Paste. ProseMirror (ChatGPT, Claude), Lexical and Quill (Gemini) all
    //    implement a paste handler, and a synthetic ClipboardEvent needs no
    //    document focus — which is the whole point.
    try {
      selectAll();
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      editor.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
      );
      if (landed()) method = "paste";
    } catch (_) {}

    // 2. beforeinput/input carrying the text as `data` — editors that ignore
    //    synthetic paste often still honour the input events.
    if (!method) {
      try {
        selectAll();
        const opts = { bubbles: true, cancelable: true, inputType: "insertText", data: text };
        editor.dispatchEvent(new InputEvent("beforeinput", opts));
        editor.dispatchEvent(new InputEvent("input", opts));
        if (landed()) method = "beforeinput";
      } catch (_) {}
    }

    // 3. execCommand — correct and lossless, but only when this tab happens to
    //    hold document focus. Kept because when it works it works best.
    if (!method) {
      try {
        selectAll();
        document.execCommand("insertText", false, text);
        if (landed()) method = "execCommand";
      } catch (_) {}
    }

    // 4. Write the DOM and announce it. Crude, and some editors reconcile it
    //    straight back out, hence the read-back like everything else.
    if (!method) {
      try {
        editor.textContent = text;
        editor.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
        );
        if (landed()) method = "textContent";
      } catch (_) {}
    }
  } else {
    // textarea / input: the native value setter is what React's onChange sees.
    try {
      const proto = editor instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(editor, text);
      else editor.value = text;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      if (landed()) method = "value";
    } catch (_) {}
  }

  if (!method) return { ok: false, reason: "insert-failed", baseline, baselineText };
  return { ok: true, baseline, baselineText, method };
}

function pageRead(selectors, baseline, baselineText) {
  const replies = document.querySelectorAll(selectors.reply.join(","));
  // The busy check: exists AND not display:none. NOT getClientRects(), which is
  // layout-dependent and reads empty in a tab that isn't painting — the same
  // trap that broke the text read below. A stale/near-miss busy selector must
  // not be able to wedge the caller for two minutes, and the caller now has a
  // stable-text fallback for exactly that, but this keeps the reading honest.
  const busy = selectors.busy.some((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
  if (!replies.length) return { text: "", busy, replies: 0 };

  const last = replies[replies.length - 1];
  // innerText FIRST — it excludes hidden action buttons and reads cleanly when
  // the tab is painting. textContent SECOND — it needs no layout at all, so it
  // still returns the answer when the tab is hidden and innerText comes back
  // empty. That empty innerText, in a background tab, WAS the whole of "it
  // doesn't stream": read.text never grew, so the streaming emit never fired.
  const text = ((last.innerText || "").trim() || (last.textContent || "").trim());

  // A NEW reply node appeared. Unambiguous — this is ours.
  if (replies.length > baseline) return { text, replies: replies.length, busy };

  // No new node. That USED to end the read right here, and it is why an answer
  // could sit finished on screen while the poll reported nothing for two solid
  // minutes: ChatGPT does not reliably add a countable node per turn, so the
  // count stayed pinned at its baseline forever.
  //
  // The last reply's text CHANGING is the other, equally valid proof, and the
  // only one that survives a virtualised or reused message list. It is safe
  // against re-reading the PREVIOUS answer — the exact bug `baseline` was added
  // to prevent — because the previous answer's text is what `baselineText`
  // holds, and identical text is rejected here. emit() only ever grows the
  // answer, so a shorter or equal read can't stomp anything either.
  if (text && text !== (baselineText || "")) {
    return { text, replies: replies.length, busy, viaChange: true };
  }

  return { text: "", busy, replies: replies.length };
}

// One line per meaningful step, in the WORKER's console — chrome://extensions,
// JustClarify, "Inspect views: service worker", Console tab. This exists
// because "it doesn't work" has now meant five different broken steps, and a
// user-pasted trace names the exact one in a way no retelling can.
function llmTrace(step, data) {
  try {
    console.log(`[JC llm] ${step}`, data === undefined ? "" : JSON.stringify(data));
  } catch (_) {}
}

// --- keeping the tab awake ----------------------------------------------------
//
// Chrome's documented exemption: a tab that is PLAYING AUDIO is spared both the
// background timer budget (which otherwise gives a hidden tab roughly 1% of a
// CPU) and Energy Saver freezing (whose rule is "hidden AND SILENT for five
// minutes"). Those two are why the previous fix failed — it restored animation
// frames, and then throttling starved the timer that replaced them.
//
// The tone is near-ultrasonic and very quiet, and the tab is muted on top of
// that, so nothing should ever reach the speakers. Muting is a tab-level output
// suppression: Chrome may or may not still count a muted tab as audible, so
// llmKeepAwake MEASURES it with tab.audible rather than assuming, and only
// unmutes if muting turned out to cost the exemption.
function pageToneStart() {
  if (window.__jcTone) return { ok: true, already: true };
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return { ok: false, error: "no AudioContext" };
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // 19 kHz sits above almost every adult's hearing, and -34 dB is far below
    // anything a speaker reproduces at normal volume. It has to be non-zero:
    // digital silence reads as "not playing" and earns no exemption at all.
    osc.frequency.value = 19000;
    gain.gain.value = 0.02;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    window.__jcTone = { ctx, osc };
    // A context built without a user gesture starts suspended.
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return { ok: true, state: ctx.state };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 80) };
  }
}

function pageToneStop() {
  const tone = window.__jcTone;
  if (!tone) return { ok: true };
  try { tone.osc.stop(); } catch (_) {}
  try { tone.ctx.close(); } catch (_) {}
  window.__jcTone = null;
  return { ok: true };
}

async function llmKeepAwake(tabId) {
  let wasMuted = false;
  try {
    const tab = await chrome.tabs.get(tabId);
    wasMuted = !!(tab.mutedInfo && tab.mutedInfo.muted);
  } catch (_) {}

  let started = null;
  try {
    started = await llmExec(tabId, pageToneStart, []);
  } catch (_) {}
  if (!started || !started.ok) return { ok: false, wasMuted, reason: "tone-failed" };

  // NEVER muted. The first version muted the tab and then "verified" the
  // exemption with tab.audible — but the tabs API keeps audible=true for a
  // muted tab ("it might not be heard if also muted"), so that check was
  // incapable of failing. Meanwhile the freeze rule is "hidden AND SILENT",
  // and a muted tab IS silent: the mute bought a speaker-off icon and cost the
  // entire exemption. Confirmed in the field — mute icon showing, tab still
  // frozen. The tone stays inaudible by frequency and level instead.
  try { await chrome.tabs.update(tabId, { muted: false }); } catch (_) {}
  await new Promise((resolve) => setTimeout(resolve, 600));

  let audible = false;
  try { audible = !!(await chrome.tabs.get(tabId)).audible; } catch (_) {}
  return { ok: audible, wasMuted, muted: false, reason: audible ? null : "not-audible" };
}

// Always paired with llmKeepAwake, on every exit path — a tab left humming
// after the answer arrived would be a worse bug than the one being fixed.
async function llmLetSleep(tabId, state) {
  try { await llmExec(tabId, pageToneStop, []); } catch (_) {}
  try {
    await chrome.tabs.update(tabId, { muted: !!(state && state.wasMuted) });
  } catch (_) {}
}

async function llmExec(tabId, func, args) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    // Don't wait for document_idle. For probes this only shaves latency; for
    // the veil it is the difference between the tile appearing before the
    // provider's page ever paints and a flash of raw chat UI on every open.
    injectImmediately: true,
  });
  return result?.result;
}

// --- the ask ------------------------------------------------------------------

// Narrates setup into the answer panel's "Thinking" line — "Opening Claude…",
// "Waiting for ChatGPT to load…", "Sending your question…". Before this, the
// user stared at a skeleton with no idea a hidden tab was being driven.
function llmState(tabId, reqId, provider, text) {
  if (tabId == null) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: "CLAUDE_PROGRESS",
      reqId,
      thinking: text,
      answer: "",
      done: false,
      engine: "llm",
      model: provider.name,
    })
    .catch(() => {});
}

// Delivery failures used to be swallowed whole. If the origin tab has no live
// listener — content script torn down, tab navigated, popup already closed —
// sendMessage REJECTS, and silencing that rejection hid the entire class of
// "the LLM answered in its own tab but nothing appeared on my page". Logged
// once per ask so a broken hop is visible without spamming a token stream.
let llmDeliveryWarned = false;

function llmProgress(tabId, reqId, provider, answer, done, modelLabel) {
  if (tabId == null) {
    if (!llmDeliveryWarned) {
      llmDeliveryWarned = true;
      llmTrace("deliver-fail", { reason: "no origin tab id" });
    }
    return;
  }
  chrome.tabs
    .sendMessage(tabId, {
      type: "CLAUDE_PROGRESS",
      reqId,
      thinking: "",
      answer,
      done,
      engine: "llm",
      // The model's own name when the page told us ("GPT-5.2", "Sonnet 4.5"),
      // the provider's otherwise — so the badge names who actually wrote it.
      model: modelLabel || provider.name,
    })
    .then(
      () => {
        if (done) llmTrace("deliver-ok", { tabId, chars: answer.length, done });
      },
      (error) => {
        if (llmDeliveryWarned && !done) return;
        llmDeliveryWarned = true;
        llmTrace("deliver-fail", {
          tabId,
          done,
          reason: String((error && error.message) || error).slice(0, 120),
        });
      },
    );
}

// --- is the little window still wanted? --------------------------------------
//
// Counted per SITE, so moving between subpages keeps the count and only a
// different site starts over. Asked once up front, then every LLM_KEEP_EVERY
// asks after they say keep — often enough to stay honest, rare enough not to nag.
async function llmKeepState(host) {
  const { jcLlmKeep } = await chrome.storage.session.get(["jcLlmKeep"]).catch(() => ({}));
  if (jcLlmKeep && jcLlmKeep.host === host) return jcLlmKeep;
  return { host: host || "", keep: false, asksSince: 0, asked: false };
}

async function llmKeepBump(host) {
  const state = await llmKeepState(host);
  state.asksSince = (state.asksSince || 0) + 1;
  await chrome.storage.session.set({ jcLlmKeep: state }).catch(() => {});
  return state;
}

// True when it is time to ask again: never asked on this site yet, or they said
// keep and have since asked LLM_KEEP_EVERY more questions.
function llmKeepShouldAsk(state) {
  if (!state.asked) return true;
  if (!state.keep) return true;
  return (state.asksSince || 0) >= LLM_KEEP_EVERY;
}

// The "still wanted?" question, asked on the USER'S OWN PAGE — the same
// surface the answer just left — never inside the tile. Rendering it in the
// little window meant growing the window to fit a card, which turned a quiet
// question into a popup jumping around the screen, and put the ask in the one
// place the user was told never to look. The tile stays a tile; the question
// appears where their attention already is.
async function llmKeepAsk(windowId, tabId, host, askTabId) {
  if (windowId == null || askTabId == null) return;
  // Retire the trust note in the tile, if it's still up — the introduction is
  // long over by the time this question is worth asking.
  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, { type: "JC_LLM_OVERLAY", show: false }).catch(() => {});
  }

  let answer = null;
  try {
    const { jcLlmTabProvider } = await chrome.storage.local.get(["jcLlmTabProvider"]);
    const provider = LLM_PROVIDERS[jcLlmTabProvider];
    answer = await chrome.tabs.sendMessage(askTabId, {
      type: "JC_LLM_KEEP",
      provider: provider ? provider.name : "",
    });
  } catch (_) {
    // Content script not there (page navigated away mid-question). Treat
    // silence as "leave it as it was" rather than closing something they may
    // still want.
    return;
  }

  const state = await llmKeepState(host);
  state.asked = true;
  state.asksSince = 0;
  state.keep = !!(answer && answer.keep);
  await chrome.storage.session.set({ jcLlmKeep: state }).catch(() => {});
  llmTrace("keep-answer", { host, keep: state.keep });

  if (state.keep) {
    await llmPopupIdle(windowId, tabId);
    return;
  }
  try { await chrome.windows.remove(windowId); } catch (_) {}
}

// The answer card on the user's own page was dismissed. That is the moment to
// either tuck the window away or ask whether it is still wanted.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "JC_LLM_DISMISSED") return;
  (async () => {
    try {
      const { jcLlmWindowId, jcLlmTabId } = await chrome.storage.local.get([
        "jcLlmWindowId",
        "jcLlmTabId",
      ]);
      if (jcLlmWindowId == null) return;
      const host = msg.host || (sender && sender.tab && new URL(sender.tab.url).host) || "";
      const state = await llmKeepState(host);
      // The dismissing tab is where the question renders — the user is
      // demonstrably looking at it right now.
      const askTabId = (sender && sender.tab && sender.tab.id) ?? null;
      if (llmKeepShouldAsk(state)) await llmKeepAsk(jcLlmWindowId, jcLlmTabId, host, askTabId);
      else await llmPopupIdle(jcLlmWindowId, jcLlmTabId);
    } catch (_) {}
  })();
  sendResponse({ ok: true });
  return false;
});

// --- the network stream, arriving from the driven tab ------------------------
//
// llm-net.js (in the page) tees the provider's answer stream and posts each
// growing snapshot to content.js, which relays it here as JC_LLM_NET. We key
// the live ask by its tab id so a snapshot lands on the right ask. This is the
// PRIMARY answer source now; the DOM poll is the fallback for when no stream is
// intercepted (a provider that isn't SSE, or an older Chrome).
const llmNetByTab = new Map();

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "JC_LLM_NET") return;
  const tabId = sender && sender.tab && sender.tab.id;
  if (tabId == null) return;
  const handler = llmNetByTab.get(tabId);
  if (handler) handler(msg.text || "", !!msg.done);
  // No response needed; this is fire-and-forget telemetry from the page.
});

// Asks are serialized: two highlights in quick succession must not type into
// the same composer at once. The second waits; its "Thinking" line says so.
let llmChain = Promise.resolve();
// Bumped on every ask. A poll loop whose generation is no longer current stops
// immediately: if you highlight something new while an answer is still coming
// (or worse, hanging), you want the new question now, not after the old one
// runs out its two-minute clock. This is what stops "3 minutes for the next
// line" even in the worst case where an ask genuinely hangs.
let llmGeneration = 0;

function llmAsk(prompt, reqId, originTabId, place) {
  const myGen = ++llmGeneration;
  const run = llmChain.then(() => llmAskNow(prompt, reqId, originTabId, myGen, place));
  // The chain must survive a failed ask or every later ask inherits the error.
  llmChain = run.catch(() => {});
  return run;
}

async function llmAskNow(prompt, reqId, originTabId, myGen, place) {
  const superseded = () => myGen != null && myGen !== llmGeneration;
  const providerId = await llmCurrentProvider();
  const provider = LLM_PROVIDERS[providerId];
  // The user's model preference (popup → jcLlmModel), for providers whose ask
  // URL can carry one. Applies to NEW conversations only — an existing window
  // keeps whatever model its conversation is already on.
  const { jcLlmModel } = await chrome.storage.local.get(["jcLlmModel"]);
  const modelPref = String(jcLlmModel || "").trim();
  const selectors = {
    editor: provider.editor,
    send: provider.send,
    reply: provider.reply,
    busy: provider.busy,
  };
  const say = (text) => llmState(originTabId, reqId, provider, text);
  llmDeliveryWarned = false; // fresh ask, fresh chance to report a broken hop
  const cursor = (place && place.cursor) || null;
  const host = (place && place.host) || "";

  // Opening the window is the FIRST thing that happens and the slowest part of
  // a cold ask, so it is what the card should say. "Asking ChatGPT\u2026" while a
  // browser window is still being created reads as a stall; "Opening ChatGPT\u2026"
  // reads as progress, and it is also simply true.
  say(`Opening ${provider.name}\u2026`);
  llmTrace("ask", { provider: providerId, prompt: prompt.slice(0, 60) });
  let tabInfo;
  try {
    tabInfo = await llmEnsureSurface(
      providerId,
      provider.askUrl ? provider.askUrl(prompt, modelPref) : null,
      cursor,
    );
  } catch (error) {
    return { ok: false, error: `Couldn't open a ${provider.name} window (${String(error).slice(0, 80)}).` };
  }

  // Only an EXISTING window has a loaded page with a composer waiting, so only
  // there is the question really going in right now. A FRESH window still has
  // to load its page first, and saying "Asking ChatGPT…" over that load reads
  // as a false loading state — the very stall the "Opening…" line above exists
  // to avoid. Leave "Opening…" up; the fresh paths below narrate their own
  // loading states.
  if (tabInfo.mode === "existing") say(`Asking ${provider.name}\u2026`);

  // Counts toward the per-site "is this still wanted" cadence.
  if (host) llmKeepBump(host).catch(() => {});

  llmTrace("tab", { mode: tabInfo.mode, carriedPrompt: !!tabInfo.carriedPrompt, tabId: tabInfo.tabId, windowId: tabInfo.windowId });

  let baseline = 0;
  // The last reply's text as it stood BEFORE this ask, so pageRead can spot a
  // reused message node changing when the reply COUNT never grows.
  let baselineText = "";

  // The URL shortcut is an OPTIMISATION, never a dependency. Every provider
  // gets it attempted; if the question isn't demonstrably submitted within a
  // few seconds — because the parameter was renamed, removed, ignored, or was
  // never supported for this provider in the first place — we quietly fall
  // through to typing it in. That is what makes "they could close the side
  // door" a non-event: it costs a few seconds, not the feature.
  let submitted = false;

  if (tabInfo.mode === "fresh" && provider.askUrl) {
    try {
      // The tab was CREATED carrying this URL. Navigating to it again restarts
      // the load and cancels the auto-submit already in flight — which is
      // exactly why "it opens but never sends" kept happening.
      if (!tabInfo.carriedPrompt) {
        await chrome.tabs.update(tabInfo.tabId, { url: provider.askUrl(prompt, modelPref) });
      }

      const deadline = Date.now() + 14_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        let evidence = null;
        try {
          // Baseline 0: this is a brand-new conversation, so ANY reply is ours.
          evidence = await llmExec(tabInfo.tabId, pageSubmitTaken, [selectors, 0]);
        } catch (_) {
          continue; // page still navigating
        }
        if (!evidence) continue;

        // The ONLY acceptable proof here: the page is answering. An empty
        // composer proves nothing on a page that just loaded.
        if (evidence.answering) { submitted = true; llmTrace("url-path", { submitted: true }); break; }

        // Prefilled but idle (Claude/Gemini style): press send.
        if (evidence.hasComposerText) {
          await llmExec(tabInfo.tabId, pageSendOnly, [selectors]).catch(() => {});
        }
      }
    } catch (_) {
      // Navigation failed outright; the typed path below covers it.
    }
    if (!submitted) {
      llmTrace("url-path", { submitted: false, note: "14s with no evidence of answering" });
      say(`${provider.name} didn't take the shortcut \u2014 typing it in\u2026`);
    }
  }

  if (!submitted) {
    // TYPED PATH — the universal backstop. Also the normal path for continuing
    // an existing conversation, which is what keeps context accumulating.
    let ready = await llmWaitReady(tabInfo.tabId, selectors, () =>
      say(`Waiting for ${provider.name} to load\u2026`),
    );

    // No editor. The likeliest reason is now the tile: at ~220px of real width
    // a provider may render its mobile layout and collapse the composer behind
    // an overflow menu, leaving nothing with a client rect to type into. Zoom
    // is meant to buy back the viewport, but a provider that reads real window
    // size rather than CSS pixels defeats it. So give this ask a full-size
    // window and try once more \u2014 the tile stays up over it, so the cost is one
    // resize on the rare miss rather than a loud window on every ask.
    if (!ready.ok && ready.reason !== "login" && ready.reason !== "closed" && tabInfo.windowId != null) {
      llmTrace("tile-too-small", { reason: ready.reason, growingTo: `${LLM_POPUP.fallbackWidth}x${LLM_POPUP.fallbackHeight}` });
      llmSelfMove();
      try {
        const grown = await chrome.windows.update(tabInfo.windowId, {
          width: LLM_POPUP.fallbackWidth,
          height: LLM_POPUP.fallbackHeight,
          focused: false,
        });
        // `now` only — the shrunk verdict is deliberately left alone. This size
        // is borrowed for one ask and handed back by llmPopupIdle.
        if (grown) llmTileSet({ now: { width: grown.width, height: grown.height } });
      } catch (_) {}
      llmPopupVeil(tabInfo.tabId, true, true);
      ready = await llmWaitReady(tabInfo.tabId, selectors, () =>
        say(`Waiting for ${provider.name} to load\u2026`),
      );
    }

    if (!ready.ok) {
      if (ready.reason === "login") {
        // Take the tile down FIRST: this branch exists to show the user a
        // sign-in page, and a tile left up hides exactly that.
        llmPopupReveal(tabInfo.tabId);
        try { await chrome.tabs.update(tabInfo.tabId, { active: true }); } catch (_) {}
        return {
          ok: false,
          error: `You're signed out of ${provider.name} \u2014 log in in its tab, then ask again.`,
        };
      }
      if (ready.reason === "closed") {
        return { ok: false, error: `The ${provider.name} tab was closed before it finished loading.` };
      }
      return { ok: false, error: `${provider.name} didn't finish loading \u2014 try again.` };
    }

    let typed;
    try {
      typed = await llmExec(tabInfo.tabId, pageSubmit, [selectors, prompt]);
    } catch (error) {
      return { ok: false, error: `Couldn't reach the ${provider.name} tab (${String(error).slice(0, 80)}).` };
    }
    llmTrace("insert", typed || { ok: false, note: "no result" });
    if (!typed?.ok) {
      if (typed?.reason === "login") {
        // Take the tile down FIRST: this branch exists to show the user a
        // sign-in page, and a tile left up hides exactly that.
        llmPopupReveal(tabInfo.tabId);
        try { await chrome.tabs.update(tabInfo.tabId, { active: true }); } catch (_) {}
        return {
          ok: false,
          error: `You're signed out of ${provider.name} — log in in its tab, then ask again.`,
        };
      }
      if (typed?.reason === "insert-failed") {
        return {
          ok: false,
          error: `Couldn't get the question into ${provider.name}'s message box. Open the ${provider.symbol} tab and ask again, or switch engines in the popup.`,
        };
      }
      return {
        ok: false,
        error:
          `${provider.name}'s page doesn't look how I expect (their design may have changed). ` +
          "Switch engines in the popup, or try again in a moment.",
      };
    }
    baseline = typed.baseline;
    baselineText = typed.baselineText || "";
    let sendConfirmed = false;

    // FIRST prove the text is really in there, and STAYED there.
    //
    // pageSubmit reads the composer back after inserting, but that read is
    // synchronous — and ProseMirror (ChatGPT, Claude) reconciles its own model
    // back over a direct DOM write a frame later, so text that was
    // demonstrably present can be gone 16ms afterwards. Skipping this check is
    // what made the second question silently do nothing: the composer went
    // empty on its own, the loop below read that as "sent", and we sat waiting
    // for a reply to a question that was never asked.
    let textSeen = false;
    const settleDeadline = Date.now() + 3000;
    while (Date.now() < settleDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      let evidence = null;
      try {
        evidence = await llmExec(tabInfo.tabId, pageSubmitTaken, [selectors, baseline]);
      } catch (_) {
        break;
      }
      if (!evidence) break;
      // A send this fast means the editor submitted on insertion. Fine either way.
      if (evidence.answering) { textSeen = true; sendConfirmed = true; break; }
      if (evidence.hasComposerText) { textSeen = true; break; }
    }

    llmTrace("settle", { textSeen, sendConfirmed });
    if (!textSeen && !sendConfirmed) {
      return {
        ok: false,
        error: `Couldn't get the question into ${provider.name}'s message box — it won't hold the text. Open the ${provider.symbol} tab and ask there, or switch engines in the popup.`,
      };
    }

    // NOW an empty composer is real evidence, because we just watched the text
    // sit in it. A press that didn't take gets pressed again until the page
    // confirms — either by emptying the box it was holding, or by producing a
    // reply NEWER than the ones that existed before we pressed. Old replies
    // from earlier asks prove nothing, which is why `baseline` rides along.
    const pressDeadline = Date.now() + 12_000;
    while (!sendConfirmed && Date.now() < pressDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      let evidence = null;
      try {
        evidence = await llmExec(tabInfo.tabId, pageSubmitTaken, [selectors, baseline]);
      } catch (_) {
        break; // tab trouble — the poll loop below reports it properly
      }
      if (!evidence) break;
      if (evidence.answering || evidence.emptyComposer) { sendConfirmed = true; break; }
      await llmExec(tabInfo.tabId, pageSendOnly, [selectors]).catch(() => {});
    }

    llmTrace("send", { confirmed: sendConfirmed, baseline });

    // Twelve seconds of pressing and the text is still sitting there. Say so.
    // Sitting silently in the poll loop for two more minutes and then blaming
    // a timeout is how this failure stayed invisible for so long.
    if (!sendConfirmed) {
      return {
        ok: false,
        error: `${provider.name} wouldn't send the message. Open the ${provider.symbol} tab to see what it's showing, or switch engines in the popup.`,
      };
    }
  }

  say(`${provider.name} is thinking\u2026`);

  // Belt and braces before the polling starts: the answer is about to stream
  // into a tab the user is not looking at, and without the stamp none of it
  // reaches the DOM for us to read.
  await llmStampTab(tabInfo.tabId);

  // Which model is the page actually on? Read once off its switcher button so
  // the badge can say "GPT-5.2" rather than just "ChatGPT". Non-fatal on every
  // path \u2014 a rotted selector leaves the badge as it always was.
  let modelLabel = "";
  try {
    modelLabel = (await llmExec(tabInfo.tabId, pageModelLabel, [provider.modelLabel || []])) || "";
  } catch (_) {}
  if (modelLabel) llmTrace("model", { label: modelLabel });

  // The audio-tone exemption used to be skipped for the popup window — "a
  // popup window is genuinely visible, measured at 60fps unfocused". True
  // exactly as long as it is on screen. The moment the user clicks back to
  // their own browser window, that window covers the tile, Chrome's occlusion
  // tracker marks the page hidden, and the whole hidden-tab physics returns:
  // clamped timers, then intensive throttling, then no DOM writes at all.
  // That is the reported "it doesn't stream until I bring the window back".
  // An audible tab is exempt from every one of those tiers, so the tone runs
  // for the popup too — inaudible by frequency and level, stopped in cleanup.
  const awake = await llmKeepAwake(tabInfo.tabId);
  llmTrace("keep-awake", awake);

  // ONE answer, two sources. The network stream (llm-net.js, immune to the
  // hidden tab's throttling) is primary; the DOM poll is the fallback for a
  // provider that doesn't stream over SSE or a Chrome too old to register the
  // interceptor. Both feed `emit`, which only ever grows the answer and streams
  // the growth out, so whichever source is ahead wins token by token and a slow
  // or absent one can never shrink or stall what the other already showed.
  const stream = { text: "", done: false, netSeen: false };
  let lastChangeAt = Date.now();
  const emit = (text) => {
    if (!text || text.length <= stream.text.length) return;
    stream.text = text;
    lastChangeAt = Date.now();
    llmProgress(originTabId, reqId, provider, text, false, modelLabel);
  };

  llmNetByTab.set(tabInfo.tabId, (text, done) => {
    if (!stream.netSeen) {
      stream.netSeen = true;
      llmTrace("net-first", { at: Date.now() });
    }
    emit(text);
    if (done && stream.text) stream.done = true;
  });

  try {
  const started = Date.now();
  let lastLogged = "";
  let stallWarned = false;
  let execFailures = 0;

  const finish = (via) => {
    llmProgress(originTabId, reqId, provider, stream.text, true, modelLabel);
    llmTrace("done", { chars: stream.text.length, ms: Date.now() - started, via });
    return {
      ok: true,
      answer: stream.text,
      thinking: "",
      url: "",
      engine: "llm",
      model: modelLabel || provider.name,
    };
  };

  while (Date.now() - started < LLM_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, LLM_POLL_MS));

    // A newer ask has arrived \u2014 stop now and hand the tab straight to it,
    // rather than making the user wait out this one's clock.
    //
    // ALWAYS the superseded shape, never a partial answer. Returning
    // `{ok:true, answer:<what we had so far>}` here looked generous and was a
    // bug: both asks share one answer card, so this ask's half-finished text
    // would land in the card as if it were the NEWER question's answer. A
    // question the user has moved on from must render nothing at all.
    if (superseded()) {
      llmTrace("superseded", { gen: myGen, now: llmGeneration, discardedChars: stream.text.length });
      return { ok: false, error: "superseded", superseded: true };
    }

    // The network stream said it is finished. The fast, clean end.
    if (stream.done) return finish("net");

    // DOM read: the fallback answer source AND the busy/stop-button signal that
    // lets us finish promptly even when the network path never engages.
    let read = null;
    try {
      read = await llmExec(tabInfo.tabId, pageRead, [selectors, baseline, baselineText]);
      execFailures = 0;
    } catch (_) {
      execFailures += 1;
      try {
        await chrome.tabs.get(tabInfo.tabId);
      } catch (_) {
        return { ok: false, error: `The ${provider.name} tab was closed mid-answer.` };
      }
      if (execFailures >= 12) {
        return { ok: false, error: `Lost contact with the ${provider.name} tab \u2014 try again.` };
      }
      continue;
    }
    if (read) {
      const shape = `${read.replies}|${read.busy}|${read.text.length}|net:${stream.netSeen}`;
      if (shape !== lastLogged) {
        lastLogged = shape;
        llmTrace("poll", { replies: read.replies, busy: read.busy, domChars: read.text.length, netChars: stream.text.length, via: read.viaChange ? "text-change" : "new-node", at: Date.now() - started });
      }
      emit(read.text); // grows the answer only if the DOM is ahead of the net
    }

    // Completion for the DOM/fallback path: text exists and has stopped growing
    // from EITHER source. The stable-text fallback is the tombstone for the old
    // two-minute hang, where a stale stop-button selector read "still busy"
    // forever. Four seconds of a frozen answer is done, whatever the button says.
    const stableFor = Date.now() - lastChangeAt;
    if (stream.text) {
      const notBusy = !(read && read.busy);
      const cleanDone = notBusy && stableFor >= 900;
      const stableDone = stableFor >= STABLE_DONE_MS;
      if (cleanDone || stableDone) return finish(cleanDone ? "clean" : "stable");
    } else if (!stallWarned && Date.now() - started > 15_000) {
      stallWarned = true;
      // Was "click the <symbol> group to peek" — misinformation on both counts.
      // There is no collapsed tab group any more (it is a small window parked
      // bottom-right), and that window shows an opaque tile, so there is
      // nothing to peek at even if you find it. Say the true thing: it is
      // still going, the answer lands here.
      say(`${provider.name} is taking a while — the answer will appear here when it lands.`);
    }
  }

  if (stream.text) return finish("timeout-partial");
  llmTrace("timeout", { sawChars: 0 });
  return { ok: false, error: `${provider.name} didn't answer in time \u2014 open the ${provider.symbol} tab to see where it got to, or switch engines in the popup.` };
  } finally {
    llmNetByTab.delete(tabInfo.tabId);
    // Every exit above returns from inside the try, so this is the only place
    // cleanup happens — and it always runs, including on the error paths and on
    // a surface that vanished mid-answer.
    if (awake) await llmLetSleep(tabInfo.tabId, awake);
    // Done talking: shrink and dim so it stops competing for attention. It does
    // NOT close here — the conversation is worth keeping, and whether the window
    // stays is decided when the user dismisses the answer on their own page.
    if (tabInfo.windowId != null) {
      await llmPopupIdle(tabInfo.windowId, tabInfo.tabId).catch(() => {});
    }
  }
}
