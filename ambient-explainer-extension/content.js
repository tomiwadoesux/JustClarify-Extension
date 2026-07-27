let blobEl = null;
let popupEl = null;
let blobShowTimer = null;
let blobDismissTimer = null;
const API_BASE_URL = "https://api.justclarify.ayotomcs.me";

// --- Semantic Window Extraction ---

// Helper: Detect background, text colors, and font from the context
function getThemeColors(element) {
  let el = element;
  let bg = "rgb(250, 250, 250)"; // Default fallback (close to white)
  let text = "rgb(0, 0, 0)"; // Default fallback (black)
  let font = "Inter, -apple-system, BlinkMacSystemFont, sans-serif"; // Default fallback

  // 1. Get Text Color and Font (from immediate parent, as they inherit)
  if (el) {
    const style = window.getComputedStyle(el);
    if (style.color) text = style.color;
    if (style.fontFamily) font = style.fontFamily;
  }

  // 2. Get Background Color (traverse up until non-transparent)
  while (el) {
    const style = window.getComputedStyle(el);
    const bgColor = style.backgroundColor;

    // Check for transparency (keyword, rgba with alpha 0 or 0.0, etc.)
    if (
      bgColor &&
      bgColor !== "transparent" &&
      !bgColor.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(\.0*)?\s*\)/)
    ) {
      bg = bgColor;
      break;
    }
    el = el.parentElement;
  }

  return { bg, text, font };
}

// Where to hang the diamond and the popup. A multi-line selection's bounding
// box is as wide as its WIDEST line, so its right edge sits out in the margin
// whenever the final line stops short — the diamond then appears nowhere near
// the words the reader actually finished on. Anchor to the end of the last
// line box instead. Single-line selections are unaffected (one rect, and it is
// the bounding box).
function jcSelectionAnchorRect(range) {
  const box = range.getBoundingClientRect();
  const rects = Array.from(range.getClientRects()).filter((r) => r.width || r.height);
  if (rects.length < 2) return box;
  // Bottom-most line box; among ties (same line, split across nodes) the one
  // that ends furthest right.
  const last = rects.reduce((a, b) => {
    if (Math.abs(b.bottom - a.bottom) < 1) return b.right > a.right ? b : a;
    return b.bottom > a.bottom ? b : a;
  });
  return {
    top: box.top,
    bottom: last.bottom,
    left: box.left,
    right: last.right,
    width: Math.max(0, last.right - box.left),
    height: box.height,
    x: box.left,
    y: box.top,
  };
}

// Grab the passage around the selection. `sentences` controls how many full
// sentences to reach for on each side, and `maxRadius` is the character fallback
// when sentence boundaries can't be found. Explain reads a tight window; Expand
// asks for a wider one so it has more context to work with.
function extractSemanticWindow(fullText, selectionStart, selectionEnd, opts) {
  const sentences = (opts && opts.sentences) || 2;
  const MAX_RADIUS = (opts && opts.maxRadius) || 500; // fallback safety

  let start = selectionStart;
  let end = selectionEnd;

  // ---- Backward scan (N sentences)
  let backwardMatches = 0;
  for (let i = selectionStart; i >= 0; i--) {
    if (fullText[i] === "." && fullText[i + 1] === " ") {
      backwardMatches++;
      if (backwardMatches === sentences) {
        start = i + 2;
        break;
      }
    }
  }

  // ---- Forward scan (N sentences)
  let forwardMatches = 0;
  for (let i = selectionEnd; i < fullText.length; i++) {
    if (fullText[i] === "." && fullText[i + 1] === " ") {
      forwardMatches++;
      if (forwardMatches === sentences) {
        end = i + 1;
        break;
      }
    }
  }

  // ---- Fallback if too small
  if (end - start < 50) {
    start = Math.max(0, selectionStart - MAX_RADIUS);
    end = Math.min(fullText.length, selectionEnd + MAX_RADIUS);
  }

  return fullText.slice(start, end).trim();
}

// Helper: Expand partial word selections to full words
function expandToFullWord(text, start, end) {
  // Word characters (letters, numbers, hyphens, apostrophes)
  const isWordChar = (char) => /[\w'-]/i.test(char);

  let expandedStart = start;
  let expandedEnd = end;

  // Expand backward to find word start
  while (expandedStart > 0 && isWordChar(text[expandedStart - 1])) {
    expandedStart--;
  }

  // Expand forward to find word end
  while (expandedEnd < text.length && isWordChar(text[expandedEnd])) {
    expandedEnd++;
  }

  return {
    start: expandedStart,
    end: expandedEnd,
    fullWord: text.slice(expandedStart, expandedEnd),
  };
}

// --- Selection & Blob Logic ---

let selectionTimeout = null;

document.addEventListener("selectionchange", () => {
  // Clear the existing timer if the user is still highlighting
  if (selectionTimeout) {
    clearTimeout(selectionTimeout);
    selectionTimeout = null;
  }

  // Hide the blob immediately while they are making a new selection
  removeBlob(false);

  const selection = window.getSelection();
  if (!selection || selection.toString().trim() === "") {
    return;
  }

  // Set a 1-second timer before showing the blob
  selectionTimeout = setTimeout(() => {
    // Re-fetch the selection just in case it changed right at the end
    const currentSelection = window.getSelection();
    if (!currentSelection || currentSelection.toString().trim() === "") {
      return;
    }

    const range = currentSelection.getRangeAt(0);
    const container = range.commonAncestorContainer;

    // Get readable text
    const fullText =
      container.nodeType === Node.TEXT_NODE
        ? container.textContent
        : container.innerText || "";

    const selectionStart = range.startOffset;
    const selectionEnd = range.endOffset;

    // Get the raw selected text
    let selectedText = currentSelection.toString().trim();

    // If it looks like a partial word (no spaces), try to expand it
    if (!selectedText.includes(" ") && fullText) {
      const expanded = expandToFullWord(fullText, selectionStart, selectionEnd);

      // Only use expanded word if it's different and makes sense
      if (expanded.fullWord && expanded.fullWord.length > selectedText.length) {
        console.log("EXPANDED:", selectedText, "→", expanded.fullWord);
        selectedText = expanded.fullWord;
      }
    }

    const contextWindow = extractSemanticWindow(
      fullText,
      selectionStart,
      selectionEnd,
    );
    // Expand needs to understand more than Explain does, so grab a wider slice
    // of the surrounding page up front. buildClaudePrompt() picks which window
    // each action gets.
    const contextWindowWide = extractSemanticWindow(
      fullText,
      selectionStart,
      selectionEnd,
      { sentences: 6, maxRadius: 1400 },
    );

    // Debug log to verify context window
    console.log("CONTEXT WINDOW:", contextWindow);
    console.log("SELECTED TEXT:", selectedText);

    const rect = jcSelectionAnchorRect(range);
    // Visual line count (one client rect per line box the selection spans) — used
    // by the action menu to decide whether to offer Summarize.
    const lineCount = range.getClientRects().length;
    showBlob(rect, {
      selectedText,
      contextWindow,
      contextWindowWide,
      lineCount,
    });
  }, 500); // 0.5-second delay
});

// Handle clicking outside to close popup
document.addEventListener("mousedown", (e) => {
  if (
    e.target.closest("#ambient-popup") ||
    e.target.closest("#ambient-blob") ||
    e.target.closest("#jc-ambient-panel")
  ) {
    return;
  }
  removePopup();
});

// Handle ESC key to close popup
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    removePopup();
    removeBlob(false);
  }
});

// --- Mouse tracking (so the ask box / loading dot opens at the cursor) ---
let lastMouseX = window.innerWidth / 2;
let lastMouseY = window.innerHeight / 2;
document.addEventListener(
  "mousemove",
  (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  },
  { passive: true },
);

// --- Double-tap Shift opens the ask box ---
// Two clean Shift taps (no other key pressed in between) within 400ms, the way
// IDE/Spotlight-style double-shift works. Any other key resets the chain so it
// won't fire while you're typing capital letters.
const DOUBLE_SHIFT_MS = 400;
let lastShiftUp = 0;
let shiftChainBroken = false;

document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Shift") shiftChainBroken = true;
  },
  true,
);

document.addEventListener(
  "keyup",
  (e) => {
    if (e.key !== "Shift") return;

    const now = Date.now();
    const isDouble =
      !shiftChainBroken && lastShiftUp && now - lastShiftUp < DOUBLE_SHIFT_MS;

    shiftChainBroken = false;

    if (isDouble) {
      lastShiftUp = 0;
      // Toggle: a second double-tap closes the box, the first opens it.
      if (document.getElementById("ambient-popup")) {
        removePopup();
        removeBlob(false);
      } else {
        openAskBox();
      }
      return;
    }

    lastShiftUp = now;
  },
  true,
);

function showBlob(rect, data) {
  // Clear any pending show/dismiss timers
  clearTimeout(blobShowTimer);
  clearTimeout(blobDismissTimer);

  // Remove existing blob immediately (no animation for replacement)
  if (blobEl) {
    blobEl.remove();
    blobEl = null;
  }

  blobEl = document.createElement("div");
  blobEl.id = "ambient-blob";

  // Diamond mark in the shared accent (brand colour set on :root by brand.js).
  blobEl.innerHTML = `
      <svg width="30" height="30" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="color: var(--accent)">
        <rect x="6" y="6" width="20" height="20" rx="5" transform="rotate(45 16 16)" fill="currentColor"/>
        <rect x="11.5" y="11.5" width="9" height="9" rx="2.5" transform="rotate(45 16 16)" fill="#fff"/>
      </svg>
    `;

  blobEl.style.left = `${rect.right + window.scrollX + 6}px`;
  blobEl.style.top = `${rect.bottom + window.scrollY + 2}px`;

  blobEl.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(blobDismissTimer);
    openPopupAtSelection(rect, data);
  });

  document.body.appendChild(blobEl);

  // Auto-dismiss after 6 seconds of no interaction
  blobDismissTimer = setTimeout(() => {
    removeBlob(true);
  }, 6000);
}

function removeBlob(animate) {
  clearTimeout(blobShowTimer);
  clearTimeout(blobDismissTimer);

  if (blobEl) {
    if (animate) {
      blobEl.classList.add("blob-exit");
      blobEl.addEventListener(
        "animationend",
        () => {
          if (blobEl) {
            blobEl.remove();
            blobEl = null;
          }
        },
        { once: true },
      );
    } else {
      blobEl.remove();
      blobEl = null;
    }
  }
}

// --- Popup & Fetch Logic ---

let currentExplainData = null;
// The block element the highlight sits in — captured at popup-open for the
// Collapse action, since the selection may be gone by the time a menu is clicked.
let currentAnchorBlock = null;
// A clone of the highlighted range, captured at popup-open so the in-place
// "I don't understand this sentence" reword can edit exactly that text later,
// even after the live selection has been cleared.
let currentSelectionRange = null;

// True only when chrome.storage is reachable. After the extension is reloaded,
// content scripts in already-open tabs are orphaned: chrome.* namespaces go
// undefined / throw "Extension context invalidated". Guard against that so a
// stale tab degrades gracefully (falls back to localStorage) instead of
// throwing an uncaught TypeError and wedging the popup.
function extensionAlive() {
  try {
    return !!(chrome.runtime && chrome.runtime.id && chrome.storage);
  } catch (_) {
    return false;
  }
}

// Keep the popup from overflowing past the bottom of the viewport/page.
const POPUP_BOTTOM_GAP = 7;

function measurePopupSize(popup) {
  // The popup's size is mid-transition when content renders, so measure a
  // settled clone instead of the live element. Menu popups keep their auto
  // width; other states are measured at their full (is-loaded) size.
  const clone = popup.cloneNode(true);
  if (!clone.classList.contains("is-menu")) {
    clone.classList.remove("is-loading");
    clone.classList.add("is-loaded");
  }
  clone.style.cssText =
    "position:absolute; top:0; left:-9999px; max-width:none; max-height:none; transition:none; animation:none; transform:none; visibility:hidden;";
  document.body.appendChild(clone);
  const width = clone.offsetWidth;
  const height = clone.offsetHeight;
  clone.remove();
  return { width, height };
}

function clampPopupPosition(popup) {
  if (!popup) return;
  const { width, height } = measurePopupSize(popup);

  if (popup.dataset.desiredTop) {
    const desiredTop = parseFloat(popup.dataset.desiredTop);
    const minTop = window.scrollY + POPUP_BOTTOM_GAP;
    const maxTop =
      window.scrollY + window.innerHeight - height - POPUP_BOTTOM_GAP;
    // Stay below the selection when there's room; otherwise move up so the
    // popup bottom keeps a 7px clearance from the bottom of the viewport.
    popup.style.top = `${Math.max(minTop, Math.min(desiredTop, maxTop))}px`;
  }

  // Menu popups are centered on the selection's right edge (translateX(-50%) in
  // CSS). Clamp the center so the box, at its current width, stays on-screen.
  if (popup.dataset.desiredCenterX) {
    const desiredCenter = parseFloat(popup.dataset.desiredCenterX);
    const half = width / 2;
    const minCenter = window.scrollX + POPUP_BOTTOM_GAP + half;
    const maxCenter =
      window.scrollX + window.innerWidth - POPUP_BOTTOM_GAP - half;
    popup.style.left = `${Math.max(minCenter, Math.min(desiredCenter, maxCenter))}px`;
  }
}

async function openPopupAtSelection(rect, data) {
  removePopup();
  currentExplainData = data;

  const popup = document.createElement("div");
  popup.id = "ambient-popup";
  popup.classList.add("is-loading");

  popup.innerHTML = `
    <div class="popup-content loading">
      <div class="loader"></div>
    </div>
  `;

  const padding = 12;
  popup.dataset.desiredTop = `${rect.bottom + window.scrollY + padding}`;
  popup.style.top = `${rect.bottom + window.scrollY + padding}px`;

  // The action row + answer panel are centered on the selection's right-most
  // edge — even for a multi-line paragraph, this is the max-x of the selection
  // rect. renderActionMenu turns that anchor on once the row mounts; until then
  // the compact loading circle just sits past the selection's right edge.
  popup.dataset.selCenterX = `${rect.right + window.scrollX}`;
  const horizontalGap = 8;
  const desiredLeft = rect.right + window.scrollX + horizontalGap;
  const minLeft = window.scrollX + POPUP_BOTTOM_GAP;
  const maxLeft = window.scrollX + window.innerWidth - 356 - POPUP_BOTTOM_GAP;
  popup.style.left = `${Math.max(minLeft, Math.min(desiredLeft, maxLeft))}px`;

  // Detect theme context and apply colors
  const range = window.getSelection().getRangeAt(0);
  const container =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;

  // Remember the block the highlight lives in, for the Collapse action.
  currentAnchorBlock = getHighlightBlock(range);
  // Snapshot the exact highlighted range so the in-place reword can replace it.
  try {
    currentSelectionRange = range.cloneRange();
  } catch (_) {
    currentSelectionRange = null;
  }

  // White surface, dark text, soft border
  popup.style.setProperty("--surface-color", "#ffffff");
  popup.style.setProperty("--bg-color", "#ffffff");
  popup.style.setProperty("--text-primary", "#1a1a1a");
  popup.style.setProperty("--text-secondary", "#555555");
  popup.style.setProperty("--border-color", "#e6e6e6");

  document.body.appendChild(popup);
  popupEl = popup;

  // Force a frame, then reveal
  requestAnimationFrame(() => {
    popup.classList.add("visible");
  });

  renderActionMenu(popup);
}

function removePopup() {
  const popup = document.getElementById("ambient-popup");
  if (popup) popup.remove();
  popupEl = null;
  // Stop popup tweens so nothing keeps running on detached nodes.
  if (typeof gsap !== "undefined") gsap.globalTimeline.clear();
  clearInterval(jcLoadingTimer);
  if (jcStreamFrame) cancelAnimationFrame(jcStreamFrame);
  jcStreamFrame = null;
}

// Expand the popup out of the compact loading circle and show a short message
// (used for empty selections and fetch failures, so the user never gets stuck
// staring at a clipped loading circle).
function showPopupMessage(popup, message) {
  if (!popup) return;
  // In menu mode the row stays put; short messages/errors land in the panel.
  const panel = jcMenuPanel(popup);
  if (panel) {
    jcSetRowLoading(popup, false);
    clearInterval(jcLoadingTimer);
    jcMorphPanelWidth(panel, message);
    panel.innerHTML = `
      <div class="explanation-body">
        <h2 class="explanation">${message}</h2>
      </div>
    `;
    clampPopupPosition(popup);
    return;
  }
  popup.classList.remove("is-loading", "is-menu");
  popup.classList.add("is-loaded");
  const content = popup.querySelector(".popup-content");
  content.classList.remove("loading");
  content.classList.add("ready");
  content.innerHTML = `
    <div class="explanation-body">
      <h2 class="explanation">${message}</h2>
    </div>
  `;
  clampPopupPosition(popup);
}

// ============================================================================
// Action menu + Collapse (Phase 1: fold the context AROUND the highlight)
// ============================================================================

// The explanation styles offered both upfront (the action menu) and as
// follow-ups after an answer. `mode` is the key buildClaudePrompt() understands.
// Keep this list as the single source of truth so both menus stay in sync.
const JC_STYLES = [
  { mode: "eli5", title: "ELI5", sub: "Explain like I'm 5 — dead simple" },
  { mode: "default", title: "Explain", sub: "What does this mean, in context?" },
  { mode: "detailed", title: "Expand", sub: "Full detail, nuance, and why it matters" },
  { mode: "example", title: "Example", sub: "A vivid real-world example or analogy" },
];

// The popup is an action surface, not just an explanation. Clicking the blob
// shows a compact horizontal bar. Page 0 is the primary bar — Explain and
// Expand, joined by Define when a single word is highlighted. The › arrow
// flips to the context-sensitive second bar — Fact-check, Text area, Example,
// plus whatever the highlight invites (a non-English span offers Translate,
// a long span offers Summarize…), paged two at a time.
// Explanation-style actions fetch an answer that replaces the bar; Translate
// opens a language prompt. Reword, Collapse and Simplify are parked for now —
// their handlers stay wired (see jcRunAction / startTranslate / rewordInPlace /
// startCollapse) so they can be re-surfaced in the second bar later.
const JC_BAR_PER_PAGE = 2;
const JC_MENU_STYLES = [
  { name: "Axis", hint: "Architectural" },
  { name: "Margin", hint: "Editorial" },
  { name: "Index", hint: "Reference cards" },
  { name: "Marker", hint: "Annotated" },
  { name: "Lens", hint: "Instrumental" },
];
let jcMenuStyleIndex = 0;

try {
  chrome.storage.local.get(["jcMenuStyleIndex"], (stored) => {
    const index = Number(stored.jcMenuStyleIndex);
    if (Number.isInteger(index) && index >= 0 && index < JC_MENU_STYLES.length) {
      jcMenuStyleIndex = index;
    }
  });
} catch (_) {}

function jcSelectedWordCount(data) {
  return (data?.selectedText || "").trim().split(/\s+/).filter(Boolean).length;
}

// Distinctive function words that are common in other languages and essentially
// never stand-alone English words. Two or more distinct hits is a strong signal
// the highlight is that language (catches romance/germanic text that carries few
// or no accents, which the diacritic check below would miss).
const JC_FOREIGN_STOPWORDS = new Set([
  // Spanish
  "está", "están", "qué", "cómo", "dónde", "señor", "niño", "niña", "también",
  "más", "porque", "pero", "con", "para", "los", "las", "una", "unos", "unas",
  "esto", "eso", "muy", "ustedes",
  // French
  "très", "être", "où", "déjà", "plaît", "voilà", "français", "avec", "pour",
  "mais", "vous", "nous", "cette", "ces", "dans", "avez", "êtes",
  // German
  "nicht", "ich", "und", "über", "schön", "für", "eine", "einen", "auch",
  "aber", "oder", "sehr", "sich", "sind", "wird",
  // Italian
  "perché", "molto", "anche", "però", "città", "così", "sono", "della",
  "questo", "questa", "gli",
  // Portuguese
  "você", "não", "então", "coração", "isso", "obrigado",
]);

// Rough "is this another language?" check that decides whether the second bar
// offers Translate. No library — three cheap signals: a real share of non-Latin
// letters (CJK, Cyrillic, Arabic, Greek, Hebrew, Devanagari, Thai, Hangul,
// Kana…), Spanish inverted punctuation, distinctive foreign function words, or a
// dense run of Latin diacritics. Deliberately tuned so ordinary English (even
// with a stray "café") never trips it.
function jcLooksNonEnglish(text) {
  const s = (text || "").trim();
  const letters = s.match(/\p{L}/gu) || [];
  if (letters.length < 2) return false;

  const nonLatin = letters.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length;
  if (nonLatin / letters.length >= 0.3) return true;

  // Spanish opening ¿ / ¡ — unmistakable and never English.
  if (/[¿¡]/.test(s)) return true;

  // Two or more distinct foreign stopwords.
  const words = s.toLowerCase().match(/[\p{L}'’]+/gu) || [];
  const hits = new Set();
  for (const w of words) {
    if (JC_FOREIGN_STOPWORDS.has(w)) hits.add(w);
    if (hits.size >= 2) return true;
  }

  // A stray "café" in an English sentence shouldn't count — require several
  // accented letters AND a meaningful share of the Latin letters.
  const diacritics = (s.match(/[À-ÿ]/g) || []).length;
  const ascii = (s.match(/[A-Za-z]/g) || []).length;
  return diacritics >= 3 && diacritics / (ascii + diacritics) >= 0.12;
}

// Primary bar — Explain and Expand, always first. A single-word highlight
// invites a dictionary entry, so Define joins them right on the first page
// instead of hiding behind the arrow. Explain reads the tight surrounding
// passage; Expand pulls the wider one (buildClaudePrompt).
function jcPrimaryActions(data) {
  const primary = [
    { key: "default", label: "Explain", icon: "explain", kind: "style" },
    { key: "detailed", label: "Expand", icon: "expand", kind: "style" },
  ];
  // Define is a dictionary lookup, not a model answer (kind: "define").
  if (jcSelectedWordCount(data) <= 1) {
    primary.push({ key: "define", label: "Define", icon: "define", kind: "define" });
  }
  return primary;
}

// The second bar (behind the › arrow). Fixed lead trio — Fact-check, the Text
// area scratchpad, then Example — followed by whatever the highlight itself
// invites:
//   • non-English text          → Translate
//   • a long / multi-line span  → Summarize
// Paged two-at-a-time (JC_BAR_PER_PAGE), so with no context extras the arrow
// reveals Fact-check + Text area, then Example on the page after. Define lives
// on the primary bar now (single-word highlights only — see jcPrimaryActions).
// ELI5 stays retired from the bar (it survives as a follow-up restyle). Reword,
// Collapse and Simplify stay parked (handlers still wired in jcRunAction).
function jcMoreActions(data) {
  const words = (data.selectedText || "").trim().split(/\s+/).filter(Boolean);
  const isLong = (data.lineCount || 0) >= 4 || words.length >= 40;

  const more = [];
  // Fact-check is its own kind, not a "style": it runs the evidence pipeline
  // (published fact-checks, then web search) rather than a plain model answer.
  more.push({ key: "factcheck", label: "Fact-check", icon: "factcheck", kind: "factcheck" });
  // Text area morphs the popup into a resizable scratch editor.
  more.push({ key: "textarea", label: "Text area", icon: "textarea", kind: "textarea" });
  // One vivid real-world example or analogy.
  more.push({ key: "example", label: "Example", icon: "example", kind: "style" });

  if (jcLooksNonEnglish(data.selectedText)) {
    more.push({ key: "translate", label: "Translate", icon: "translate", kind: "translate" });
  }
  if (isLong) {
    more.push({ key: "summarize", label: "Summarize", icon: "summarize", kind: "style" });
  }
  return more;
}

// Phosphor-style duotone icon set. Each icon is two layers: a low-opacity
// filled silhouette (the "duo" tone) behind a crisp stroked foreground — the
// Phosphor duotone look, authored inline so there's no icon-font dependency.
// One family, reused across the action menu and the text-area toolbar.
const JC_ICON_DUO = {
  explain: '<circle cx="11" cy="11" r="7"/>',
  expand: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/>',
  factcheck: '<circle cx="12" cy="12" r="9"/>',
  textarea: '<rect x="3" y="4" width="18" height="16" rx="4"/>',
  define: '<path d="M12 6.5A3 3 0 0 0 9 4.5H3.5v13H9a3 3 0 0 1 3 2z"/>',
  translate: '<rect x="2.5" y="2.5" width="12" height="12" rx="3"/>',
  summarize: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/>',
  download: '<rect x="3.5" y="14.5" width="17" height="5.5" rx="2"/>',
  align: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/>',
  resize: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/>',
  minimize: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/>',
  humanize: '<circle cx="12" cy="8.5" r="4"/>',
  shorten: '<rect x="3.5" y="5" width="17" height="14" rx="3"/>',
  ondevice: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
};
const JC_ICON_FG = {
  explain: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4-4"/>',
  expand: '<path d="M14 5h5v5M19 5l-6 6M10 19H5v-5M5 19l6-6"/>',
  factcheck: '<circle cx="12" cy="12" r="9"/><path d="m8.4 12.2 2.4 2.4 4.8-5.2"/>',
  textarea: '<rect x="3" y="4" width="18" height="16" rx="4"/><path d="M7 9.5h10M7 13h10M7 16.5h6"/>',
  define:
    '<path d="M12 6.5V20M12 6.5A3 3 0 0 0 9 4.5H3.5v13H9a3 3 0 0 1 3 2M12 6.5A3 3 0 0 1 15 4.5h5.5v13H15a3 3 0 0 0-3 2"/>',
  translate: '<path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>',
  summarize: '<path d="M7 8.5h10M7 12h10M7 15.5h6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  download: '<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 20.5h16"/>',
  alignJustify: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  alignCenter: '<path d="M4 6h16M7 10h10M5 14h14M8 18h8"/>',
  alignLeft: '<path d="M4 6h16M4 10h10M4 14h13M4 18h8"/>',
  alignRight: '<path d="M4 6h16M10 10h10M7 14h13M12 18h8"/>',
  expandFull: '<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>',
  contract: '<path d="M20 10h-6V4M14 10l6-6M4 14h6v6M10 14l-6 6"/>',
  minimize: '<path d="M20 14h-6v6M14 14l6 6M10 4v6H4M10 10 4 4"/>',
  close: '<path d="M6 6 18 18M18 6 6 18"/>',
  humanize: '<circle cx="12" cy="8.5" r="4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  shorten: '<path d="M5 8.5h9M5 12h14M5 15.5h9M18 8.5l3 3-3 3"/>',
  ondevice:
    '<rect x="6" y="6" width="12" height="12" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
};

function jcIcon(name, cls) {
  const duoKey = name.startsWith("align")
    ? "align"
    : name === "expandFull" || name === "contract"
      ? "resize"
      : name;
  const duo = JC_ICON_DUO[duoKey] || "";
  const fg = JC_ICON_FG[name] || JC_ICON_FG.explain;
  return (
    `<svg class="jc-lucide jc-ph${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true">` +
    (duo
      ? `<g class="jc-ph-duo" fill="currentColor" stroke="none" opacity="0.2">${duo}</g>`
      : "") +
    `<g class="jc-ph-fg" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${fg}</g>` +
    `</svg>`
  );
}

// Kept for the existing menu/arrow call sites — now duotone under the hood.
function jcActionIcon(name) {
  return jcIcon(name);
}

function jcRunAction(popup, kind, key) {
  if (kind === "factcheck") {
    jcFactCheckSelection(popup);
  } else if (kind === "define") {
    jcDefineSelection(popup);
  } else if (kind === "textarea") {
    openTextArea(currentExplainData?.selectedText || "");
  } else if (kind === "style") {
    fetchExplanation(key, true);
  } else if (kind === "translate") {
    startTranslate(popup);
  } else if (kind === "reword") {
    rewordInPlace();
  } else if (kind === "collapse") {
    startCollapse(popup);
  }
}

function jcRenderActionButtons(container, actions, popup) {
  const selectedKey = popup?.dataset?.jcSelKey || "";
  container.innerHTML = actions
    .map(
      (a) =>
        `<button class="jc-bar-btn${a.key === selectedKey ? " is-selected" : ""}" data-jc-key="${a.key}" data-jc-kind="${a.kind}"><span class="jc-bar-icon">${jcActionIcon(a.icon)}</span><span class="jc-bar-label">${a.label}</span></button>`,
    )
    .join("");
  container.querySelectorAll(".jc-bar-btn").forEach((btn) => {
    if (typeof gsap !== "undefined") {
      if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        btn.addEventListener("pointerenter", () => {
          gsap.to(btn, { y: -1, duration: 0.14, ease: "power2.out", overwrite: "auto" });
        });
        btn.addEventListener("pointerleave", () => {
          gsap.to(btn, { y: 0, duration: 0.16, ease: "power3.out", overwrite: "auto" });
        });
      }
      btn.addEventListener("pointerdown", () => {
        gsap.to(btn, { scale: 0.96, duration: 0.09, ease: "power2.out", overwrite: "auto" });
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach((event) => {
        btn.addEventListener(event, () => {
          gsap.to(btn, { scale: 1, duration: 0.16, ease: "power3.out", overwrite: "auto" });
        });
      });
    }
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-jc-kind");
      const key = btn.getAttribute("data-jc-key");
      // Reword and Text area take over their own surface and close the popup,
      // so they never become the "current answer" — every other action lights
      // up as selected while its result shows in the panel below.
      if (kind !== "reword" && kind !== "textarea" && popup) {
        popup.dataset.jcSelKey = key;
        container
          .querySelectorAll(".jc-bar-btn")
          .forEach((b) => b.classList.toggle("is-selected", b === btn));
      }
      jcRunAction(popup, kind, key);
    });
  });
}

function renderActionMenu(popup) {
  popup.classList.remove("is-loading", "is-loaded");
  popup.classList.add("is-menu");
  // Switch positioning to the center-on-selection-right-edge anchor now that the
  // row (and, later, the panel) own the layout.
  if (popup.dataset.selCenterX) {
    popup.dataset.desiredCenterX = popup.dataset.selCenterX;
  }
  const content = popup.querySelector(".popup-content");
  content.classList.remove("loading");
  content.classList.add("ready");

  content.innerHTML = `
    <div class="jc-menu jc-menu--0">
      <div class="jc-action-row" role="toolbar" aria-label="Clarify actions">
        <button class="jc-row-arrow jc-row-prev" aria-label="Previous actions">${jcActionIcon("chevronLeft")}</button>
        <div class="jc-row-view"><div class="jc-row-track"></div></div>
        <button class="jc-row-arrow jc-row-next" aria-label="More actions">${jcActionIcon("chevronRight")}</button>
      </div>
    </div>
  `;

  const track = content.querySelector(".jc-row-track");
  const prev = content.querySelector(".jc-row-prev");
  const next = content.querySelector(".jc-row-next");
  // Page 0 is the primary bar (Explain / Expand, plus Define for a single
  // word). The › arrow reveals the context-sensitive second bar, split across
  // further pages if it runs long.
  const pages = [jcPrimaryActions(currentExplainData)];
  const more = jcMoreActions(currentExplainData);
  for (let i = 0; i < more.length; i += JC_BAR_PER_PAGE) {
    pages.push(more.slice(i, i + JC_BAR_PER_PAGE));
  }
  let page = 0;

  const renderPage = () => {
    jcRenderActionButtons(track, pages[page], popup);
    prev.disabled = page === 0;
    next.disabled = page === pages.length - 1;
    popup.dataset.jcSkin = "0";
    if (typeof gsap !== "undefined") {
      gsap.fromTo(
        track.querySelectorAll(".jc-bar-btn"),
        { opacity: 0, y: 5 },
        { opacity: 1, y: 0, duration: 0.18, stagger: 0.035, ease: "power3.out", overwrite: "auto" },
      );
    }
    clampPopupPosition(popup);
  };
  prev.addEventListener("click", () => {
    if (page > 0) { page -= 1; renderPage(); }
  });
  next.addEventListener("click", () => {
    if (page < pages.length - 1) { page += 1; renderPage(); }
  });
  renderPage();
}

// Translate: clicking the Translate option swaps the bar for a small language
// prompt. Enter (or the → button) runs the translation, which replaces the bar
// with the result just like an explanation.
function startTranslate(popup) {
  // Render the language prompt into the answer panel so the action row stays.
  const target = jcMenuPanel(popup) || popup.querySelector(".popup-content");
  if (target.classList.contains("jc-explain-panel")) jcMorphPanelWidth(target, "");
  target.innerHTML = `
    <div class="jc-bar jc-bar-form">
      <span class="jc-bar-label">Translate to</span>
      <input class="jc-lang-input" type="text" placeholder="language…" autocomplete="off" spellcheck="false" />
      <button class="jc-bar-arrow jc-bar-go" aria-label="Translate">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6h6M6 3l3 3-3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  `;
  const input = target.querySelector(".jc-lang-input");
  const go = target.querySelector(".jc-bar-go");
  const submit = () => {
    const lang = input.value.trim();
    if (lang) fetchTranslation(lang);
  };
  go.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });
  clampPopupPosition(popup);
  requestAnimationFrame(() => input.focus());
}

async function fetchTranslation(language) {
  const popup = document.getElementById("ambient-popup");
  if (!popup || !currentExplainData) return;

  const { selectedText } = currentExplainData;
  if (!selectedText || selectedText.trim() === "") {
    showPopupMessage(popup, "No text selected.");
    return;
  }

  setPopupLoading(popup);

  try {
    const result = await askChatGPT(
      buildClaudePrompt("translate", currentExplainData, language),
      (chunk) => renderStreaming(popup, chunk),
    );
    renderAnswer(
      popup,
      result.answer,
      `TRANSLATION · ${language.toUpperCase()}`,
      result.thinking,
    );
    recordAsk({
      question: `Translate to ${language}: ${selectedText}`,
      answer: result.answer,
      topic: result.topic,
      url: result.url,
    });
  } catch (err) {
    console.warn("Claude translate failed:", err);
    showClaudeError(popup, err);
  }
}

// --- Finding the highlight's block + its neighbouring context blocks ---

const JC_BLOCK_TAGS = new Set([
  "P", "LI", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "DIV",
  "TD", "DD", "DT", "FIGCAPTION", "H1", "H2", "H3", "H4", "H5", "H6",
]);

function jcIsOurNode(el) {
  return (
    !el ||
    el.id === "ambient-popup" ||
    el.id === "ambient-blob" ||
    (el.classList &&
      (el.classList.contains("jc-collapse-marker") ||
        el.dataset?.jcCollapsed))
  );
}

function jcIsBlockish(el) {
  if (!el || el.nodeType !== 1) return false;
  if (JC_BLOCK_TAGS.has(el.tagName)) return true;
  const d = window.getComputedStyle(el).display;
  return d === "block" || d === "list-item" || d === "flex" || d === "grid";
}

// Climb from the selection to the nearest block-level element holding real text.
function getHighlightBlock(range) {
  let el =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;

  while (el && el !== document.body) {
    if (jcIsBlockish(el) && (el.innerText || "").trim().length > 0) return el;
    el = el.parentElement;
  }
  return el;
}

// Collect up to `perSide` text-bearing block siblings on each side of the anchor.
function gatherNeighborBlocks(anchor, perSide = 3) {
  const side = (dir) => {
    const out = [];
    let el = dir < 0 ? anchor.previousElementSibling : anchor.nextElementSibling;
    while (el && out.length < perSide) {
      if (!jcIsOurNode(el) && (el.innerText || "").trim().length > 40) {
        out.push(el);
      }
      el = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    }
    return out;
  };
  // before in document order, then after
  return [...side(-1).reverse(), ...side(1)];
}

// --- Collapse: ask the backend (HF) which neighbours to fold, then fold them ---

const collapsedRegistry = [];

async function collapsePlan(highlightedText, blocks) {
  const res = await fetch(`${API_BASE_URL}/collapse-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ highlighted_text: highlightedText, blocks }),
  });
  if (!res.ok) throw new Error(`collapse-plan ${res.status}`);
  return res.json();
}

async function startCollapse(popup) {
  const anchor = currentAnchorBlock;
  if (!anchor) {
    showPopupMessage(popup, "Couldn't find the text to collapse around.");
    return;
  }

  const neighbors = gatherNeighborBlocks(anchor, 3);
  if (!neighbors.length) {
    showPopupMessage(popup, "No surrounding context to collapse here.");
    return;
  }

  // id → element map; send id + trimmed text to the backend.
  const blockMap = new Map();
  const blocks = neighbors.map((el, i) => {
    const id = i + 1;
    blockMap.set(id, el);
    return { id, text: (el.innerText || "").trim().slice(0, 600) };
  });

  setPopupLoading(popup);

  try {
    const plan = await collapsePlan(currentExplainData.selectedText, blocks);
    const fold = Array.isArray(plan?.fold) ? plan.fold : [];

    let count = 0;
    for (const item of fold) {
      const el = blockMap.get(item.id);
      if (el && !el.dataset.jcCollapsed) {
        collapseBlock(el, item.gist || "hidden context");
        count++;
      }
    }

    if (!count) {
      showPopupMessage(popup, "Nothing here was worth folding.");
      return;
    }
    recordLayoutEvent({
      type: "collapse",
      count,
      gists: fold.map((f) => f.gist).filter(Boolean),
    });
    showCollapseResult(popup, count);
  } catch (err) {
    console.warn("Collapse failed:", err);
    showPopupMessage(popup, "Couldn't collapse. Try again.");
  }
}

// Hide a block (never destroy) and drop a clickable marker in its place.
function collapseBlock(el, gist) {
  el.dataset.jcCollapsed = "1";
  el.dataset.jcPrevDisplay = el.style.display || "";

  const marker = document.createElement("div");
  marker.className = "jc-collapse-marker";
  marker.innerHTML = `<span class="jc-collapse-arrow">▸</span><span class="jc-collapse-gist"></span>`;
  marker.querySelector(".jc-collapse-gist").textContent = gist;

  el.style.display = "none";
  el.parentNode.insertBefore(marker, el);
  marker.addEventListener("click", () => toggleCollapse(marker, el));

  collapsedRegistry.push({ marker, el });
}

function toggleCollapse(marker, el) {
  const arrow = marker.querySelector(".jc-collapse-arrow");
  if (el.style.display === "none") {
    el.style.display = el.dataset.jcPrevDisplay || "";
    arrow.textContent = "▾";
    marker.classList.add("open");
  } else {
    el.style.display = "none";
    arrow.textContent = "▸";
    marker.classList.remove("open");
  }
}

function undoAllCollapses() {
  for (const { marker, el } of collapsedRegistry) {
    el.style.display = el.dataset.jcPrevDisplay || "";
    delete el.dataset.jcCollapsed;
    delete el.dataset.jcPrevDisplay;
    marker.remove();
  }
  collapsedRegistry.length = 0;
}

function showCollapseResult(popup, count) {
  popup.classList.remove("is-loading");
  popup.classList.add("is-loaded");
  const content = popup.querySelector(".popup-content");
  content.classList.remove("loading");
  content.classList.add("ready");

  const noun = count === 1 ? "section" : "sections";
  content.innerHTML = `
    <div class="explanation-body">
      <span class="content-label">COLLAPSED</span>
      <h2 class="explanation"><div class="expl-text">Folded ${count} ${noun} of context around your highlight. Click a <strong>▸</strong> marker on the page to reopen one.</div></h2>
    </div>
    <div class="buttons primary">
      <button data-jc-action="undo">Undo all</button>
      <button data-jc-action="done">Done</button>
    </div>
    <div class="popup-footer">
      <span class="footer-meta">© 2026 JustClarify</span>
    </div>
  `;

  content.querySelector('[data-jc-action="undo"]').addEventListener("click", () => {
    undoAllCollapses();
    removePopup();
  });
  content.querySelector('[data-jc-action="done"]').addEventListener("click", () => {
    removePopup();
  });

  clampPopupPosition(popup);
}

// --- Topic capture ----------------------------------------------------------
// Every ask also asks the model for a short topic title (appended to the prompt)
// so the conversation dock can label the thread. We parse the trailing tag back
// out of the answer and strip it from what the user sees.
const JC_TOPIC_TAG = "[[TOPIC]]";
const JC_TOPIC_INSTRUCTION = `\n\nThen, on a new final line, output exactly "${JC_TOPIC_TAG}" followed by a 2-4 word title naming the subject. Output nothing after that line.`;

// Pull the "[[TOPIC]] ..." tag off a finished answer → { body, topic }.
// Tolerant of a weak model's variations ("[[ topic ]]", wrong case) and takes
// the FIRST occurrence, since a rambling model sometimes emits it twice.
const JC_TOPIC_RE = /\[\[\s*TOPIC\s*\]\]/i;
function splitTopic(text) {
  if (!text) return { body: "", topic: "" };
  const m = JC_TOPIC_RE.exec(text);
  if (!m) return { body: text.trim(), topic: "" };
  const topic = text
    .slice(m.index + m[0].length)
    .replace(/[\r\n][\s\S]*$/, "")
    .trim();
  return { body: text.slice(0, m.index).trim(), topic };
}

// Strip the tag (even a half-streamed opener) so it never flashes in the popup.
function stripTopicForDisplay(text) {
  if (!text) return "";
  const m = /\[\[\s*TOPIC/i.exec(text);
  return (m ? text.slice(0, m.index) : text).trimEnd();
}

// Remove any layout/topic markers the block parser didn't consume — an unclosed
// [[KEY]], a lone [[/MORE]], a stray [[TOPIC]] — so a weak model's malformed
// tags never render as literal text in the answer.
function jcStripStrayMarkers(s) {
  return (s || "")
    .replace(/\[\[\s*TOPIC[^\]]*\]\][\s\S]*$/i, "")
    .replace(/\[\[\s*\/?\s*(?:KEY|MORE)(?::[^\]]*)?\s*\]\]/gi, "")
    .replace(/\[\[[^\]]*\]\]/g, "")
    .replace(/\[\[[^\]]*$/g, "");
}

// Optional guidance appended to explanation prompts inviting the model to tag
// content only it can judge — kept gentle so short answers stay plain. The
// local parser (detectBlocks) handles plain lists/steps/numbers on its own, so
// markers are reserved for the semantic calls a regex can't make.
const JC_LAYOUT_HINT = `
Formatting: only when useful, mark one key sentence as [[KEY]]...[[/KEY]] or one optional aside as [[MORE:short title]]...[[/MORE]].`;

// Hide layout markers (and any half-streamed opener) while text streams in, so
// the reader never sees raw [[MORE]]/[[KEY]] tags before the final parse runs.
function stripLayoutMarkers(text) {
  if (!text) return "";
  return text
    .replace(/\[\[\/?(?:MORE|KEY)(?::[^\]]*)?\]\]/g, "")
    .replace(/\[\[\/?(?:MORE|KEY)[^\]]*$/g, "")
    .replace(/\[\[?\s*$/g, "");
}

let claudeReqSeq = 0;

// --- On-device first-run consent --------------------------------------------
// The very first time the built-in model would need its one-time ~4GB download
// (and there's no key to answer with meanwhile), ask before starting it.
const JC_ONDEVICE_CONSENT_KEY = "jcOnDeviceConsent";
let jcConsentState = null; // "yes" | "no" (session-only decline) | null

function jcEngineStatus() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "JC_ENGINE_STATUS" }, (info) => {
        resolve(chrome.runtime.lastError ? null : info);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

// Consent card rendered into the popup panel; resolves "yes" | "no".
function jcAskOnDeviceConsent() {
  return new Promise((resolve) => {
    const popup = document.getElementById("ambient-popup");
    const target = popup
      ? jcMenuPanel(popup) || popup.querySelector(".popup-content")
      : null;
    if (!target) {
      resolve("yes"); // no surface to ask on — don't block the answer
      return;
    }
    if (popup) {
      jcSetRowLoading(popup, false);
      popup.classList.remove("is-loading");
      popup.classList.add("is-loaded");
      target.classList?.remove("loading");
      target.classList?.add("ready");
    }
    target.innerHTML = `
      <div class="jc-consent">
        <span class="jc-consent-ico">${jcIcon("ondevice")}</span>
        <div class="jc-consent-title">Set up on-device AI?</div>
        <p class="jc-consent-body">JustClarify can answer right on your machine — free, private, and it works offline. Chrome downloads the built-in model once (about 4GB); after that it's instant. Nothing you highlight ever leaves your device.</p>
        <div class="jc-consent-actions">
          <button class="jc-consent-yes" type="button">Use on-device AI</button>
          <button class="jc-consent-no" type="button">Not now</button>
        </div>
      </div>
    `;
    if (popup) clampPopupPosition(popup);
    target.querySelector(".jc-consent-yes").addEventListener("click", () => resolve("yes"));
    target.querySelector(".jc-consent-no").addEventListener("click", () => resolve("no"));
  });
}

async function jcEnsureEngineConsent() {
  if (jcConsentState === "yes") return;
  const stored = await jcStorageGet([JC_ONDEVICE_CONSENT_KEY]);
  if (stored[JC_ONDEVICE_CONSENT_KEY] === "yes") {
    jcConsentState = "yes";
    return;
  }
  const info = await jcEngineStatus();
  // Consent only matters when the built-in model needs its one-time download AND
  // there's no key to answer with meanwhile. Anything else → nothing to ask.
  const needsDownload = info && info.ok && info.availability === "downloadable" && !info.hasKey;
  if (!needsDownload) {
    jcConsentState = "yes";
    return;
  }
  if (jcConsentState === "no") {
    // Declined earlier this session — don't re-prompt on every ask, but don't
    // start the download behind their back either.
    throw new Error(
      "On-device AI setup was declined. Add your own AI Gateway key in the JustClarify popup to answer, or reopen JustClarify to accept the one-time download.",
    );
  }
  const choice = await jcAskOnDeviceConsent();
  if (choice === "yes") {
    await jcStorageSet({ [JC_ONDEVICE_CONSENT_KEY]: "yes" }); // remembered across sessions
    jcConsentState = "yes";
    return;
  }
  jcConsentState = "no"; // session-only — re-asked on the next page load
  throw new Error(
    "On-device AI setup was declined. Turn on “Use your own AI key” in the JustClarify popup to answer without the one-time download.",
  );
}

// Send a JustClarify request to the background worker, which answers with
// Chrome's on-device model when available, else the Vercel AI Gateway.
async function askChatGPT(prompt, onProgress) {
  await jcEnsureEngineConsent(); // may throw if the user declines the download
  const reqId = ++claudeReqSeq;
  jcPanelActivity("thinking");
  return new Promise((resolve, reject) => {
    const onMessage = (msg) => {
      if (msg && msg.type === "CLAUDE_PROGRESS" && msg.reqId === reqId) {
        const clean = stripLayoutMarkers(stripTopicForDisplay(msg.answer || ""));
        // The engine that's actually answering — the card badges it live, so a
        // Gateway fallback after an on-device miss is visible as it happens.
        jcSetEngine(msg.engine, msg.model);
        jcPanelActivity("streaming", clean);
        if (onProgress) {
          onProgress({ thinking: msg.thinking || "", answer: clean, download: msg.download });
        }
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.runtime.sendMessage(
      { type: "ASK_CLAUDE", prompt: prompt + JC_TOPIC_INSTRUCTION, reqId },
      (resp) => {
        chrome.runtime.onMessage.removeListener(onMessage);
        if (chrome.runtime.lastError) {
          jcPanelActivity("error", "Extension reloaded — refresh the page.");
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!resp?.ok) {
          const message = resp?.error || "JustClarify couldn't get an answer. Try again.";
          jcPanelActivity("error", message);
          return reject(new Error(message));
        }
        jcSetEngine(resp.engine, resp.model);
        jcPanelActivity("done");
        const { body, topic } = splitTopic(resp.answer || "");
        resolve({ answer: body, thinking: resp.thinking || "", url: resp.url || "", topic });
      },
    );
  });
}

// Build the prompt JustClarify sends to Claude. We lead with the surrounding
// passage and ask the model to explain the highlight AS IT IS USED RIGHT THERE
// — "when the text said '…<surrounding>…', what does '<highlight>' mean?" — so an
// ambiguous word/phrase gets read in its actual context instead of defined in a
// vacuum. Each `instruction` is a verb phrase that reads naturally after "please".
function buildClaudePrompt(mode, data, question) {
  const { selectedText, contextWindow, contextWindowWide } = data;

  // Translate is standalone — it doesn't want the surrounding-context grounding
  // the explanation modes use. `question` carries the target language.
  if (mode === "translate") {
    const lang = (question || "").trim() || "English";
    const sel = (selectedText || "").trim();
    return `Translate this text into ${lang}: "${sel}"
Reply with ONLY the translation — no quotes, no preamble, no notes. If the target uses a non-Latin script, add a short romanization in parentheses after it.`;
  }

  const instruction =
    {
      eli5:
        "explain it like I'm 5 years old — one or two very short sentences, the simplest everyday words, and no jargon at all.",
      simpler:
        "explain it in one short, friendly sentence using everyday words. Be concrete, not vague.",
      simplify:
        "rewrite it in much simpler, plainer language — short sentences, everyday words, and no jargon — while keeping the exact same meaning.",
      define:
        "give a concise dictionary-style definition: the part of speech if useful, a clear one-sentence meaning, then a short example sentence using it.",
      detailed:
        "explain it thoroughly in 4-6 sentences — its meaning, any nuance, and why it matters here.",
      example:
        "explain it with one vivid real-world example or analogy in 2-4 sentences.",
      factcheck:
        "fact-check it. Say plainly whether it's accurate, then briefly explain what's right or wrong and note any important caveats. If it's opinion or can't be verified, say so.",
      summarize:
        "summarize it in 2-4 sentences, capturing only the key points and dropping the filler.",
      followup: `answer this question about it: ${question}`,
    }[mode] ||
    "explain it clearly and accurately in about 3 sentences — get the meaning right in this context and don't leave out the main point.";

  // Expand ("detailed") and Summarize read the wider passage so they can reason
  // about more of the surrounding page; every other mode stays on the tight
  // window so the answer keeps its focus on the highlight.
  const wantsWide = mode === "detailed" || mode === "summarize";
  const context = (
    (wantsWide ? contextWindowWide : contextWindow) ||
    contextWindow ||
    ""
  ).trim();
  const selection = (selectedText || "").trim();

  // Keep the working prompt compact: the model gets the exact passage and the
  // desired transformation, without restating the product's entire UI contract.
  if (!context || context === selection) {
    return `Explain "${selection}": ${instruction}
Reply only with the answer.${JC_LAYOUT_HINT}`;
  }

  return `Passage: "${context}"
Explain "${selection}" in this passage: ${instruction}
Use the local meaning, not a generic definition. Reply only with the answer.${JC_LAYOUT_HINT}`;
}

// --- In-place reword: "I don't understand this sentence" ---------------------
// Ask ChatGPT to restate the highlighted sentence in plainer words and swap it
// straight into the page where the original sat, so the reader watches the
// confusing text turn clear without ever leaving the page or opening a panel.

function buildRewritePrompt(data) {
  const selection = (data.selectedText || "").trim();
  const context = (data.contextWindow || "").trim();
  const ctx =
    context && context !== selection
      ? `\nFor context, the surrounding passage reads: "${context}"\n`
      : "\n";
  return `I don't understand this sentence: "${selection}"
${ctx}Rewrite it so it's much easier to understand. Keep the exact same meaning, keep it about the same length, and keep the same voice and tense so it still reads naturally in place of the original. Just say it in plainer, clearer everyday words. Reply with ONLY the rewritten sentence — no quotes, no preamble, no notes, nothing else.`;
}

// Strip a stray wrapping quote pair / whitespace the model sometimes adds.
function cleanRewrite(text) {
  return (text || "")
    .trim()
    .replace(/^["“”'']+/, "")
    .replace(/["“”'']+$/, "")
    .trim();
}

// Grow a range outward to the whole sentence it sits in (previous terminator →
// next full stop), so rewording a half-highlighted phrase rephrases the entire
// thought. Only expands within a single text node; otherwise returns as-is.
function expandRangeToSentence(range) {
  const node = range.startContainer;
  if (node !== range.endContainer || !node || node.nodeType !== Node.TEXT_NODE) {
    return range;
  }
  const text = node.textContent || "";
  let start = range.startOffset;
  while (start > 0 && !/[.!?]/.test(text[start - 1])) start--; // back to prev stop
  while (start < text.length && /\s/.test(text[start])) start++; // skip spaces
  let end = range.endOffset;
  while (end < text.length && !/[.!?]/.test(text[end])) end++; // out to next stop
  if (end < text.length) end++; // include the full stop itself
  const out = range.cloneRange();
  try {
    out.setStart(node, start);
    out.setEnd(node, end);
  } catch (_) {
    return range;
  }
  return out;
}

async function rewordInPlace() {
  const popup = document.getElementById("ambient-popup");
  if (!currentExplainData || !currentSelectionRange) return;

  // Drop a span where the selection was so the text can morph in place. Capture
  // the original first, so we can put it back if the rewrite fails. We expand to
  // the full sentence so a half-highlighted phrase still gets reworded as a whole.
  let span = null;
  let original = "";
  try {
    const range = expandRangeToSentence(currentSelectionRange.cloneRange());
    original = range.toString();
    span = document.createElement("span");
    span.className = "jc-reworded jc-reworded-loading";
    span.textContent = original;
    range.deleteContents();
    range.insertNode(span);
  } catch (_) {
    span = null;
  }

  if (!span) {
    // Couldn't edit the page (range went stale) — fall back to a clear message.
    if (popup) showClaudeError(popup, new Error("Couldn't edit this text in place."));
    return;
  }

  // Clear the live selection and get our own UI out of the way — the page itself
  // is now the answer surface.
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
  removePopup();

  try {
    const result = await askChatGPT(
      buildRewritePrompt({
        selectedText: original, // the full sentence we expanded to
        contextWindow: currentExplainData.contextWindow,
      }),
      (chunk) => {
        if (chunk.answer) span.textContent = cleanRewrite(chunk.answer);
      },
    );
    span.textContent = cleanRewrite(result.answer) || original;
    span.classList.remove("jc-reworded-loading");
    span.classList.add("jc-reworded-show");
    // Let the highlight flash land, then fade it back into normal page text.
    setTimeout(() => span && span.classList.remove("jc-reworded-show"), 1300);
  } catch (err) {
    console.warn("Reword failed:", err);
    span.textContent = original; // restore the original sentence on failure
    span.classList.remove("jc-reworded-loading");
  }
}

// ── Menu-mode answer panel ──────────────────────────────────────────────────
// In menu mode the action row stays put and every answer (explanation,
// translation, collapse result, error) renders into a panel that scales out
// from center below the row and morphs its width to fit the content. Ask-box /
// thread popups aren't menu popups, so they keep rendering into .popup-content —
// the shared render fns below branch on jcMenuPanel() returning null for them.
function jcMenuPanel(popup, create = true) {
  if (!popup || !popup.classList.contains("is-menu")) return null;
  const menu = popup.querySelector(".jc-menu");
  if (!menu) return null;
  let panel = menu.querySelector(".jc-explain-panel");
  if (!panel && create) {
    panel = document.createElement("div");
    panel.className = "jc-explain-panel";
    menu.appendChild(panel);
    // Next frame → flip on the scale-out transition, then re-center the popup
    // now that it's taller/wider.
    requestAnimationFrame(() => {
      panel.classList.add("is-open");
      clampPopupPosition(popup);
    });
  }
  return panel;
}

// The panel holds ONE stable width and grows downward to fit the answer — it
// never widens as text streams in (that horizontal jitter was the complaint).
// 360px matches the harness answer panel; the height is left to the content.
const JC_PANEL_WIDTH = 360;
function jcMorphPanelWidth(panel) {
  if (!panel) return;
  panel.style.width = `${JC_PANEL_WIDTH}px`;
}

// Toggle the row's loading state. The loader IS the selection diamond: while
// waiting, the chosen action's diamond beams (scales) and its label shimmers
// left→right, and the whole row greys out and stops taking clicks (all handled
// in CSS via .jc-loading). Cleared the moment the answer starts arriving.
function jcSetRowLoading(popup, on) {
  const row = popup && popup.querySelector(".jc-action-row");
  if (row) row.classList.toggle("jc-loading", on);
}

// Loading state: no tall loading panel anymore — the loader lives in the row
// (beaming diamond + shimmering label). Any previous answer panel collapses
// away so only the compact row shows while we wait.
function jcPanelLoading(popup) {
  if (!popup || !popup.classList.contains("is-menu")) return false;
  jcSetRowLoading(popup, true);
  clearInterval(jcLoadingTimer);
  // Open the panel straight into a shimmering skeleton so the wait reads as the
  // answer forming, not a spinner. Streaming then fills it in paragraph by
  // paragraph (jcProgressiveReveal reuses this same layout).
  const panel = jcMenuPanel(popup);
  if (panel && !panel.querySelector(".jc-stream")) {
    panel.innerHTML = jcStreamLayoutHTML(popup);
    jcProgressiveReveal(panel.querySelector(".jc-answer-text"), "");
    jcMorphPanelWidth(panel);
  }
  clampPopupPosition(popup);
  return true;
}

// The panel's answer tag: an icon + a Title-case name (not an all-caps pill),
// chosen from the action the reader picked so it reads "◇ Explanation",
// "◇ Expanded", "◇ Translation", etc.
const JC_PANEL_LABELS = {
  default: { icon: "explain", title: "Explanation" },
  detailed: { icon: "expand", title: "Expanded" },
  define: { icon: "define", title: "Definition" },
  eli5: { icon: "eli5", title: "In simple terms" },
  simplify: { icon: "simplify", title: "Simplified" },
  example: { icon: "example", title: "Example" },
  factcheck: { icon: "factcheck", title: "Fact-check" },
  summarize: { icon: "summarize", title: "Summary" },
  translate: { icon: "translate", title: "Translation" },
};

function jcPanelTag(popup, fallbackLabel) {
  const key = popup?.dataset?.jcSelKey || "";
  const meta = JC_PANEL_LABELS[key];
  const iconKey = meta ? meta.icon : "explain";
  let title = meta ? meta.title : fallbackLabel || "Explanation";
  // Soften an ALL-CAPS fallback (e.g. "ANSWER") to Title case.
  if (!meta && title === title.toUpperCase()) {
    title = title.charAt(0) + title.slice(1).toLowerCase();
  }
  return `<span class="jc-panel-tag">${jcActionIcon(iconKey)}<span>${title}</span></span>`;
}

// Streaming view inside the panel — built on the first chunk, updated in place.
// The one-time on-device download, shown as a labelled progress bar (harness
// engine-bar style) instead of a bare "…0%" line. Only appears while Chrome is
// pulling the model down; normal loading keeps the dot loader.
function jcSetupBarBlock() {
  return `<div class="jc-setup" hidden>
      <div class="jc-setup-row">
        <span class="jc-setup-ico">${jcIcon("ondevice")}</span>
        <span class="jc-setup-label">Setting up on-device AI — one-time download</span>
        <span class="jc-setup-pct">0%</span>
      </div>
      <div class="jc-setup-bar"><i></i></div>
    </div>`;
}
function jcUpdateSetupBar(container, download) {
  if (!container) return;
  const setup = container.querySelector(".jc-setup");
  if (!setup) return;
  if (download == null) {
    setup.hidden = true;
    return;
  }
  const pct = Math.max(0, Math.min(100, Math.round(download)));
  setup.hidden = false;
  setup.querySelector(".jc-setup-pct").textContent = `${pct}%`;
  setup.querySelector(".jc-setup-bar i").style.width = `${pct}%`;
}

// A shimmering skeleton of a few placeholder lines — what shows while a
// paragraph is still being written.
function jcMakeSkeleton() {
  const d = document.createElement("div");
  d.className = "jc-skel";
  d.setAttribute("aria-hidden", "true");
  d.innerHTML =
    '<span style="width:97%"></span><span style="width:100%"></span><span style="width:78%"></span>';
  return d;
}

// Split streamed text into reveal units: paragraphs when the model uses blank
// lines, otherwise sentences. The reader watches finished units resolve one by
// one while the one still being written shimmers.
function jcSplitUnits(text) {
  const t = (text || "").trim();
  const paras = t.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (paras.length > 1) return paras;
  return t
    .split(/(?<=[.!?])\s+(?=["'“(A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Reveal completed units as solid text and keep a trailing skeleton for the
// unit still streaming. Only appends newly-finished units, so revealed text
// never re-animates.
function jcProgressiveReveal(container, answer) {
  if (!container) return;
  const units = jcSplitUnits(answer);
  const complete = Math.max(0, units.length - 1); // last unit is still coming
  const revealed = container.querySelectorAll("p.jc-astream-para").length;
  for (let i = revealed; i < complete; i++) {
    const p = document.createElement("p");
    p.className = "jc-astream-para";
    p.textContent = units[i];
    const skel = container.querySelector(".jc-skel");
    if (skel) container.insertBefore(p, skel);
    else container.appendChild(p);
  }
  if (!container.querySelector(".jc-skel")) container.appendChild(jcMakeSkeleton());
}

// The shared streaming/loading panel layout — the answer area starts as a
// skeleton and fills in.
function jcStreamLayoutHTML(popup) {
  return `
    <div class="popup-header">
      <h1 class="header-name">"${escapeHTML(currentExplainData.selectedText)}"</h1>
    </div>
    <div class="popup-divider"></div>
    <div class="jc-stream">
      ${jcSetupBarBlock()}
      <details class="jc-thinking" open hidden>
        <summary>Thinking</summary>
        <div class="jc-thinking-text expl-text"></div>
      </details>
      <div class="explanation-body jc-answer-wrap">
        ${jcPanelTag(popup, "Explanation")}
        <div class="expl-text jc-answer-text jc-astream"></div>
      </div>
    </div>`;
}

function jcPanelStreaming(popup, { thinking, answer, download }) {
  jcSetRowLoading(popup, false);
  const panel = jcMenuPanel(popup);
  if (!panel) return false;
  let stream = panel.querySelector(".jc-stream");
  if (!stream) {
    clearInterval(jcLoadingTimer);
    panel.innerHTML = jcStreamLayoutHTML(popup);
    stream = panel.querySelector(".jc-stream");
    jcMorphPanelWidth(panel);
  }
  const thinkingWrap = stream.querySelector(".jc-thinking");
  const thinkingText = stream.querySelector(".jc-thinking-text");
  const answerText = stream.querySelector(".jc-answer-text");
  jcUpdateSetupBar(stream, download);
  // While the model downloads, the bar carries the message — hide the raw
  // "…0%" thinking line so it isn't shown twice.
  thinkingWrap.hidden = !thinking || download != null;
  if (thinking) thinkingText.textContent = thinking;
  // Skeleton until text arrives, then reveal each finished paragraph/sentence.
  jcProgressiveReveal(answerText, download != null ? "" : answer);
  clampPopupPosition(popup);
  return true;
}

// Final answer inside the panel — keeps the quoted header, no footer and no
// follow-up buttons (the action row above already offers every option).
function jcPanelAnswer(popup, answer, label, thinking) {
  jcSetRowLoading(popup, false);
  const panel = jcMenuPanel(popup);
  if (!panel) return false;
  clearInterval(jcLoadingTimer);
  if (jcStreamFrame) cancelAnimationFrame(jcStreamFrame);
  jcStreamFrame = null;
  const explanationHTML = formatExplanation(answer);
  panel.innerHTML = `
    <div class="popup-header">
      <h1 class="header-name">"${escapeHTML(currentExplainData.selectedText)}"</h1>
    </div>
    <div class="popup-divider"></div>
    ${
      thinking
        ? `<details class="jc-thinking">
             <summary>Thinking</summary>
             <div class="jc-thinking-text expl-text"></div>
           </details>`
        : ""
    }
    <div class="explanation-body">
      ${jcPanelTag(popup, label)}
      <h2 class="explanation">${explanationHTML}</h2>
    </div>
  `;
  if (thinking) {
    const t = panel.querySelector(".jc-thinking-text");
    if (t) t.textContent = thinking;
  }
  jcMorphPanelWidth(panel, answer);
  clampPopupPosition(popup);
  return true;
}

function setPopupLoading(popup) {
  if (jcPanelLoading(popup)) return;
  const content = popup.querySelector(".popup-content");
  content.classList.remove("ready");
  content.classList.add("loading");
  content.innerHTML = `
    <div class="jc-loading-mark" aria-hidden="true"><i></i><b></b><i></i></div>
    <div class="jc-loading-copy">
      <span class="jc-loading-kicker">JUSTCLARIFY / LIVE</span>
      <p class="jc-passive-wait">Preparing your context</p>
      <span class="jc-loading-detail">The temporary chat stays visible and in your control.</span>
    </div>
  `;
  popup.classList.remove("is-loaded", "is-menu");
  popup.classList.add("is-loading");
  clearInterval(jcLoadingTimer);
  const messages = [
    ["Preparing your context", "Reading only the selected passage."],
    ["Opening a temporary chat", "Starting a clean, visible conversation."],
    ["Getting the explanation", "Streaming the response back as it arrives."],
  ];
  let messageIndex = 0;
  jcLoadingTimer = setInterval(() => {
    messageIndex = Math.min(messageIndex + 1, messages.length - 1);
    const title = content.querySelector(".jc-passive-wait");
    const detail = content.querySelector(".jc-loading-detail");
    if (title) title.textContent = messages[messageIndex][0];
    if (detail) detail.textContent = messages[messageIndex][1];
  }, 900);
}

let jcLoadingTimer = null;
let jcStreamFrame = null;
let jcStreamTarget = "";
let jcStreamShown = "";
let jcStreamElement = null;
let jcStreamLastTime = 0;

// Buffer model chunks into an intentionally fast, smooth live reveal. This
// preserves the feeling of a response arriving without making the text jitter
// or forcing readers to chase one character at a time.
function renderSmoothStream(element, target) {
  if (!element) return;
  if (!target.startsWith(jcStreamShown)) {
    jcStreamShown = "";
    element.textContent = "";
  }
  jcStreamElement = element;
  jcStreamTarget = target;
  if (jcStreamFrame) return;

  const step = (time) => {
    const elapsed = Math.max(16, time - (jcStreamLastTime || time));
    jcStreamLastTime = time;
    // ~700 characters/sec, with a generous first frame. Fast enough to feel
    // live, slow enough that words remain legible.
    const count = Math.max(8, Math.ceil(elapsed * 0.7));
    const nextLength = Math.min(jcStreamTarget.length, jcStreamShown.length + count);
    jcStreamShown = jcStreamTarget.slice(0, nextLength);
    if (jcStreamElement) jcStreamElement.textContent = jcStreamShown;
    if (jcStreamShown.length < jcStreamTarget.length) {
      jcStreamFrame = requestAnimationFrame(step);
    } else {
      jcStreamFrame = null;
      jcStreamLastTime = 0;
    }
  };
  jcStreamFrame = requestAnimationFrame(step);
}

// Live streaming view: built on the first chunk, then updated in place as more
// text arrives. Uses textContent so partial markup mid-stream can't inject HTML.
function renderStreaming(popup, { thinking, answer, download }) {
  if (jcPanelStreaming(popup, { thinking, answer, download })) return;
  const content = popup.querySelector(".popup-content");
  let stream = content.querySelector(".jc-stream");

  if (!stream) {
    clearInterval(jcLoadingTimer);
    // First chunk — morph out of the loader into the streaming layout.
    popup.classList.remove("is-loading");
    popup.classList.add("is-loaded");
    content.classList.remove("loading");
    content.classList.add("ready");
    content.innerHTML = `
      <div class="popup-header">
        <h1 class="header-name">"${escapeHTML(currentExplainData.selectedText)}"</h1>
      </div>
      <div class="popup-divider"></div>

      <div class="jc-stream">
        ${jcSetupBarBlock()}
        <details class="jc-thinking" open hidden>
          <summary>Thinking</summary>
          <div class="jc-thinking-text expl-text"></div>
        </details>
        <div class="explanation-body jc-answer-wrap">
          <span class="jc-panel-tag">${jcActionIcon("explain")}<span>Explanation</span></span>
          <div class="expl-text jc-answer-text jc-astream"></div>
        </div>
      </div>
    `;
    stream = content.querySelector(".jc-stream");
  }

  const thinkingWrap = stream.querySelector(".jc-thinking");
  const thinkingText = stream.querySelector(".jc-thinking-text");
  const answerText = stream.querySelector(".jc-answer-text");

  jcUpdateSetupBar(stream, download);
  thinkingWrap.hidden = !thinking || download != null;
  if (thinking) thinkingText.textContent = thinking;

  jcProgressiveReveal(answerText, download != null ? "" : answer);

  clampPopupPosition(popup);
}

// --- Soft email ask -----------------------------------------------------------
// The old early-access gate, demoted from a wall to a card: the first answer
// always renders, then this slides in under it inviting (not requiring) an
// email. Submitting or dismissing means it never comes back; ignoring it just
// skips it until the next page load.

const ACCESS_EMAIL_KEY = "justclarifyAccessEmail"; // set once the reader shares an email
const JC_EMAIL_DISMISS_KEY = "jcEmailCardDismissed"; // "✕" on the soft ask
let jcEmailCardShown = false; // at most one soft ask per page load

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Fire-and-forget — the card thanks the reader whether or not the POST lands.
function captureAccessEmail(email) {
  return fetch(`${API_BASE_URL}/capture-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  }).catch(() => {});
}

async function maybeShowEmailCard(popup) {
  if (jcEmailCardShown) return;
  try {
    const flags = await jcStorageGet([ACCESS_EMAIL_KEY, JC_EMAIL_DISMISS_KEY]);
    if (flags[ACCESS_EMAIL_KEY] || flags[JC_EMAIL_DISMISS_KEY]) return;
  } catch (_) {
    return;
  }
  const content = popup && popup.querySelector(".popup-content");
  if (!content || !popup.isConnected) return; // popup closed while we checked
  jcEmailCardShown = true;

  const waveSvg = `<svg viewBox="0 0 624 204" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="jc-gate-text-clip"><rect x="380" y="78" width="244" height="22"/></clipPath>
      <clipPath id="jc-understanding-clip"><rect id="jc-understanding-rect" x="30" y="103" width="220" height="20"/></clipPath>
    </defs>
    <path id="jc-wave" d="M374.5 100.502C369.5 71.1687 356.4 12.402 344 12.002C331.6 11.602 318.167 70.8353 313 100.502C307.667 131.168 293.8 192.5 281 192.5C268.2 192.5 254.333 131.168 249 100.502" stroke="black"/>
    <rect id="jc-dot-up" x="343.828" width="4.75" height="4.75" transform="rotate(45 343.828 0)" fill="#FF0000"/>
    <rect id="jc-dot-down" x="281.121" y="197" width="4.75" height="4.75" transform="rotate(45 281.121 197)" fill="#FF0000"/>
    <line y1="100.5" x2="624" y2="100.5" stroke="#FF0000"/>
    <text x="30" y="118" text-anchor="start" font-size="14" fill="#000000" clip-path="url(#jc-understanding-clip)"><tspan fill="#FF0000">understanding</tspan> what I am reading</text>
    <text x="594" y="94" text-anchor="end" font-size="14" fill="#000000" clip-path="url(#jc-gate-text-clip)">without <tspan fill="#FF0000">leaving the tab</tspan> I'm in</text>
  </svg>`;

  const circleSvg = `<svg viewBox="0 0 145 145" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M98.965 26.5176C73.5984 11.8722 41.1623 20.5635 26.5169 45.9301C11.8715 71.2967 20.5627 103.733 45.9293 118.378C71.2959 133.024 103.732 124.332 118.377 98.9658" stroke="black"/>
    <path d="M64.8906 59.3576C72.1205 55.1834 81.3654 57.6606 85.5396 64.8905C89.7138 72.1204 87.2366 81.3653 80.0067 85.5395C72.7768 89.7137 63.5319 87.2366 59.3577 80.0066" stroke="black"/>
    <path d="M107.806 62.9789C113.038 82.5055 101.45 102.576 81.9234 107.809C62.3968 113.041 42.3259 101.453 37.0938 81.9262C31.8616 62.3996 43.4496 42.3287 62.9762 37.0965" stroke="#FF0000"/>
    <rect x="72.7754" y="68.9385" width="4.75436" height="4.75436" transform="rotate(45 72.7754 68.9385)" fill="#FF0000"/>
  </svg>`;

  const triangleSvg = `<svg viewBox="0 0 222 196" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 0H222L111 196L0 0Z" fill="black"/>
  </svg>`;

  const card = document.createElement("div");
  card.className = "jc-email-card";
  card.innerHTML = `
    <button class="jc-email-close" type="button" aria-label="Dismiss">✕</button>

    <div class="gate-domain">
      <a href="https://justclarify.xyz" target="_blank" rel="noopener noreferrer"><span class="gate-domain-red">justclarify</span>.xyz</a>
    </div>

    <div class="email-gate email-gate--signin">
      <div class="gate-circle" aria-hidden="true">${circleSvg}</div>
      <div class="gate-triangle" aria-hidden="true">${triangleSvg}</div>
      <form id="ambient-email-form" class="email-form">
        <input id="ambient-email-input" class="email-input" type="email" placeholder="mail@domain.com" autocomplete="email" />
        <button type="submit" class="email-submit">Unlock Early Access</button>
      </form>
      <p id="ambient-email-error" class="email-error" hidden>Please enter a valid email.</p>
    </div>

    <div class="gate-wave" aria-hidden="true">${waveSvg}</div>

    <div class="popup-footer popup-footer--no-border gate-footer">
      <span class="footer-meta">© 2026 JustClarify</span>
      <span class="gate-footer-sep">|</span>
      <a class="gate-footer-mail" href="mailto:hello@ayotomcs.me">hello@ayotomcs.me</a>
    </div>
  `;

  // Sit above the footer so the card reads as part of the answer, not chrome.
  const footer = content.querySelector(".popup-footer");
  if (footer) footer.insertAdjacentElement("beforebegin", card);
  else content.appendChild(card);
  clampPopupPosition(popup);
  animateEmailWave(card);

  card.querySelector(".jc-email-close").addEventListener("click", () => {
    jcStorageSet({ [JC_EMAIL_DISMISS_KEY]: true });
    card.remove();
    clampPopupPosition(popup);
  });

  const form = card.querySelector("#ambient-email-form");
  const input = card.querySelector("#ambient-email-input");
  const errorEl = card.querySelector("#ambient-email-error");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = input.value.trim().toLowerCase();
    if (!isValidEmail(email)) {
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;
    input.disabled = true;
    form.querySelector("button").disabled = true;
    captureAccessEmail(email);
    jcStorageSet({ [ACCESS_EMAIL_KEY]: email });
    card.innerHTML = `<p class="jc-email-thanks">You're in — thanks ✓</p>`;
    clampPopupPosition(popup);
    setTimeout(() => {
      card.remove();
      clampPopupPosition(popup);
    }, 2200);
  });
}

// The original gate-wave choreography: the wave draws left→right, each diamond
// pops (springy bounce) as the drawing tip passes its extremum, then the right
// text writes on. Runs once when the card mounts.
function animateEmailWave(card) {
  if (typeof gsap === "undefined") return;

  const $ = (sel) => card.querySelector(sel);
  const wave = $("#jc-wave");
  const dotUp = $("#jc-dot-up");
  const dotDown = $("#jc-dot-down");
  const textClip = $("#jc-gate-text-clip rect");
  if (!wave || !dotUp || !dotDown || !textClip) return;

  const len = wave.getTotalLength();

  // Fraction of the left→right draw at which the tip passes a given point.
  // The path is defined right-to-left, so convert from path-start distance.
  const drawFractionAt = (tx, ty) => {
    let bestS = 0;
    let bestD = Infinity;
    for (let i = 0; i <= 200; i++) {
      const s = (len * i) / 200;
      const p = wave.getPointAtLength(s);
      const d = (p.x - tx) ** 2 + (p.y - ty) ** 2;
      if (d < bestD) {
        bestD = d;
        bestS = s;
      }
    }
    return 1 - bestS / len;
  };
  const valleyFrac = drawFractionAt(281, 192.5);
  const peakFrac = drawFractionAt(344, 12);

  gsap.set(wave, { strokeDasharray: len, strokeDashoffset: -len });
  gsap.set(dotUp, { y: 10, scale: 0, transformOrigin: "50% 50%" });
  gsap.set(dotDown, { y: -10, scale: 0, transformOrigin: "50% 50%" });
  gsap.set(textClip, { attr: { width: 0 } });

  const DRAW = 0.8;
  const tl = gsap.timeline({ delay: 0.3 });

  tl.to(wave, { strokeDashoffset: 0, duration: DRAW, ease: "none" }, 0);

  const pop = (dot, at) => {
    tl.to(dot, { y: 0, scale: 1, duration: 0.6, ease: "back.out(2)" }, at);
    tl.to(
      dot,
      { rotation: "+=360", duration: 3, repeat: 2, ease: "none" },
      at + 0.45,
    );
  };
  pop(dotDown, DRAW * valleyFrac);
  pop(dotUp, DRAW * peakFrac);

  tl.to(
    textClip,
    { attr: { width: 244 }, duration: 0.7, ease: "power1.inOut" },
    DRAW,
  );
}

function renderAnswer(popup, answer, label, thinking) {
  if (jcPanelAnswer(popup, answer, label, thinking)) return;
  clearInterval(jcLoadingTimer);
  if (jcStreamFrame) cancelAnimationFrame(jcStreamFrame);
  jcStreamFrame = null;
  const content = popup.querySelector(".popup-content");
  const explanationHTML = formatExplanation(answer);

  // Morph: switch from compact loader to full-width content
  popup.classList.remove("is-loading");
  popup.classList.add("is-loaded");
  content.classList.remove("loading");
  content.classList.add("ready");
  content.innerHTML = `
    <div class="popup-header">
      <h1 class="header-name">"${escapeHTML(currentExplainData.selectedText)}"</h1>
    </div>
    <div class="popup-divider"></div>

    ${
      thinking
        ? `<details class="jc-thinking">
             <summary>Thinking</summary>
             <div class="jc-thinking-text expl-text"></div>
           </details>`
        : ""
    }

    <div class="explanation-body">
       <span class="content-label">${label}</span>
       <h2 class="explanation">${explanationHTML}</h2>
    </div>

    ${
      currentExplainData.standalone
        ? ""
        : `<div class="buttons primary">
      ${JC_STYLES.map((s) => `<button data-mode="${s.mode}">${s.title}</button>`).join("\n      ")}
    </div>`
    }

    <div class="popup-footer">
      <span class="footer-meta">© 2026 JustClarify</span>
    </div>
  `;

  // Set thinking via textContent (it's raw model text, never trusted HTML).
  if (thinking) {
    const t = content.querySelector(".jc-thinking-text");
    if (t) t.textContent = thinking;
  }

  wireFollowUpButtons();
  clampPopupPosition(popup);
}

function showClaudeError(popup, err) {
  const message = err?.message?.includes("couldn't connect")
    ? err.message
    : err?.message ||
      "Couldn't get an answer. Check your AI Gateway key in the extension popup, then try again.";
  showPopupMessage(popup, message);
}

async function fetchExplanation(mode, isNew = false) {
  const popup = document.getElementById("ambient-popup");
  if (!popup || !currentExplainData) return;

  const { selectedText } = currentExplainData;
  if (!selectedText || selectedText.trim() === "") {
    showPopupMessage(popup, "No text selected.");
    return;
  }

  setPopupLoading(popup);

  try {
    const result = await askChatGPT(
      buildClaudePrompt(mode, currentExplainData),
      (chunk) => renderStreaming(popup, chunk),
    );
    renderAnswer(popup, result.answer, "EXPLANATION", result.thinking);
    // A style button on an existing answer (Simplify/Expand/…) continues the
    // thread; opening a fresh explanation from the action menu starts a new one.
    if (isNew || !currentThreadId) {
      recordAsk({
        question: selectedText,
        answer: result.answer,
        topic: result.topic,
        url: result.url,
      });
    } else {
      recordReply(currentThreadId, JC_MODE_LABEL[mode] || "More", result.answer);
    }
  } catch (err) {
    console.warn("Claude ask failed:", err);
    showClaudeError(popup, err);
  }
}

function wireFollowUpButtons() {
  document.querySelectorAll("#ambient-popup button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-mode");

      if (mode === "followup") {
        const question = btn.getAttribute("data-question");
        fetchFollowUpQuestion(question);
      } else {
        fetchExplanation(mode);
      }
    });
  });
}

async function fetchFollowUpQuestion(question) {
  const popup = document.getElementById("ambient-popup");
  if (!popup || !currentExplainData) return;

  setPopupLoading(popup);

  try {
    const result = await askChatGPT(
      buildClaudePrompt("followup", currentExplainData, question),
      (chunk) => renderStreaming(popup, chunk),
    );
    renderAnswer(popup, result.answer, "ANSWER", result.thinking);
    recordReply(currentThreadId, question, result.answer, result);
  } catch (err) {
    console.warn("Claude ask failed:", err);
    showClaudeError(popup, err);
  }
}

// --- Fact-check ---------------------------------------------------------------
// Unlike every other action, this one never renders a bare model answer. A
// verdict without a clickable source is just an opinion in a badge, so the card
// always shows where the ruling came from — and "Unverified" is a first-class,
// frequently-correct outcome rather than a failure state.

const JC_FC_VERDICTS = {
  TRUE: { label: "True", tone: "true" },
  MOSTLY_TRUE: { label: "Mostly true", tone: "true" },
  MIXED: { label: "Mixed", tone: "mixed" },
  MOSTLY_FALSE: { label: "Mostly false", tone: "false" },
  FALSE: { label: "False", tone: "false" },
  UNVERIFIABLE: { label: "Unverified", tone: "unknown" },
};

function jcFcMeta(verdict) {
  return JC_FC_VERDICTS[verdict] || JC_FC_VERDICTS.UNVERIFIABLE;
}

function jcFcSourceList(sources) {
  if (!sources || !sources.length) return "";
  return `<ol class="jc-fc-refs">${sources
    .map((s) => {
      let host = "source";
      try {
        host = new URL(s.url).hostname.replace(/^www\./, "");
      } catch (_) {}
      // The host is the useful part at a glance; the title trails it and is
      // allowed to truncate, so a long headline never pushes the source off.
      const title = s.title && s.title !== host ? s.title : "";
      return `<li><a href="${escapeHTML(s.url)}" target="_blank" rel="noopener noreferrer"><span class="jc-fc-refhost">${escapeHTML(host)}</span><span class="jc-fc-reftitle">${escapeHTML(title)}</span></a></li>`;
    })
    .join("")}</ol>`;
}

// The dateline: where the ruling came from and how sure it is, condensed to one
// short right-aligned string rather than a row of competing badges.
function jcFcDateline(result) {
  const parts = [];
  if (result.origin === "published") parts.push("Published ruling");
  if (result.confidence) parts.push(`${result.confidence} confidence`);
  return parts.join(" · ");
}

function jcFcCard(result, { showClaim = false } = {}) {
  const meta = jcFcMeta(result.verdict);
  const dateline = jcFcDateline(result);
  return `
    <div class="jc-fc jc-fc--${meta.tone}">
      <div class="jc-fc-verdict">
        <span class="jc-fc-mark" aria-hidden="true"></span>
        <span class="jc-fc-word">${escapeHTML(meta.label)}</span>
        ${dateline ? `<span class="jc-fc-meta">${escapeHTML(dateline)}</span>` : ""}
      </div>
      ${showClaim ? `<p class="jc-fc-quote">${escapeHTML(result.claim)}</p>` : ""}
      ${result.summary ? `<p class="jc-fc-body">${escapeHTML(result.summary)}</p>` : ""}
      ${jcFcSourceList(result.sources)}
    </div>`;
}

// Drop a finished verdict into the popup panel, reusing the same header/tag
// chrome the explanation answers use so it doesn't look like a bolted-on mode.
function jcFcRenderPanel(popup, result) {
  jcSetRowLoading(popup, false);
  const panel = jcMenuPanel(popup);
  if (!panel) return;
  clearInterval(jcLoadingTimer);
  // No panel tag here on purpose: the verdict line already names itself, and
  // stacking "Fact-check" above "False" gave the card two headings and two reds.
  panel.classList.add("is-factcheck");
  panel.innerHTML = `
    <div class="popup-header">
      <h1 class="header-name">"${escapeHTML(currentExplainData?.selectedText || result.claim)}"</h1>
    </div>
    <div class="popup-divider"></div>
    <div class="explanation-body">
      ${jcFcCard(result)}
    </div>
  `;
  panel.style.width = "420px";
  clampPopupPosition(popup);
}

// ── Define ────────────────────────────────────────────────────────────────
// A definition is a lookup, not a generation. Define asks the Free Dictionary
// API for the real entry — part of speech, senses, the dictionary's own example
// — and only falls back to the model when a word has no entry (jargon, proper
// nouns, coinages), where a contextual explanation beats nothing.
function jcDefineRenderPanel(popup, entry) {
  jcSetRowLoading(popup, false);
  const panel = jcMenuPanel(popup);
  if (!panel) return;
  clearInterval(jcLoadingTimer);
  panel.classList.remove("is-factcheck");

  const senses = entry.senses
    .map(
      (s, i) => `
      <li class="jc-dict-sense">
        <span class="jc-dict-num">${i + 1}</span>
        <div>
          ${s.partOfSpeech ? `<span class="jc-dict-pos">${escapeHTML(s.partOfSpeech)}</span>` : ""}
          <span class="jc-dict-def">${escapeHTML(s.definition)}</span>
          ${s.example ? `<span class="jc-dict-eg">“${escapeHTML(s.example)}”</span>` : ""}
        </div>
      </li>`,
    )
    .join("");

  panel.innerHTML = `
    <div class="popup-header">
      <h1 class="header-name">"${escapeHTML(entry.word)}"</h1>
    </div>
    <div class="popup-divider"></div>
    <span class="jc-panel-tag">
      ${jcActionIcon("define")}
      <span>Dictionary</span>
    </span>
    <div class="explanation-body">
      ${entry.phonetic ? `<div class="jc-dict-phonetic">${escapeHTML(entry.phonetic)}</div>` : ""}
      <ol class="jc-dict-senses">${senses}</ol>
      <div class="jc-dict-src">Free Dictionary — a real entry, not a generated one.</div>
    </div>
  `;
  panel.style.width = "380px";
  clampPopupPosition(popup);
}

function jcDefineSelection(popup) {
  if (!popup || !currentExplainData) return;
  const word = (currentExplainData.selectedText || "").trim();
  if (!word) {
    showPopupMessage(popup, "No text selected.");
    return;
  }
  setPopupLoading(popup);

  chrome.runtime.sendMessage({ type: "JC_DICTIONARY", word }, (resp) => {
    // No entry (or the lookup failed) → the model explains it in context
    // instead. Better a contextual explanation than a dead end.
    if (chrome.runtime.lastError || !resp?.ok) {
      fetchExplanation("define", true);
      return;
    }
    jcDefineRenderPanel(popup, resp.result);
    recordAsk({
      question: `Define: ${word}`,
      answer: resp.result.senses.map((s) => s.definition).join(" · "),
      topic: "Definition",
      url: location.href,
    });
  });
}

async function jcFactCheckSelection(popup) {
  if (!popup || !currentExplainData) return;
  const claim = (currentExplainData.selectedText || "").trim();
  if (!claim) {
    showPopupMessage(popup, "No text selected.");
    return;
  }
  setPopupLoading(popup);

  chrome.runtime.sendMessage(
    {
      type: "JC_FACTCHECK_ONE",
      claim,
      context: currentExplainData.contextWindowWide || currentExplainData.contextWindow || "",
    },
    (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        showPopupMessage(
          popup,
          "Couldn't run the fact-check. Check your connection, or add an AI Gateway key in the JustClarify popup.",
        );
        return;
      }
      jcFcRenderPanel(popup, resp.result);
      recordAsk({
        question: `Fact-check: ${claim}`,
        answer: `${jcFcMeta(resp.result.verdict).label} — ${resp.result.summary}`,
        topic: "Fact-check",
        url: location.href,
      });
    },
  );
}

// --- Whole page / video ---------------------------------------------------

// YouTube keeps the open transcript panel in the DOM, so when the reader has it
// up we get timestamped text for free — no captions API, no audio. Each cue
// keeps its start time so a verdict can deep-link to the moment it was said.
function jcYouTubeTranscript() {
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return null;
  const cues = document.querySelectorAll("ytd-transcript-segment-renderer");
  if (!cues.length) return null;
  const lines = [];
  cues.forEach((cue) => {
    const stamp = cue.querySelector(".segment-timestamp")?.textContent?.trim() || "";
    const text = cue.querySelector(".segment-text")?.textContent?.trim() || "";
    if (text) lines.push(stamp ? `[${stamp}] ${text}` : text);
  });
  return lines.length ? lines.join("\n") : null;
}

// Readable body text for the current page. Prefers a real article container and
// skips the furniture (nav, asides, figure captions) so claim extraction reads
// prose rather than menu labels.
function jcArticleText() {
  const root =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.body;
  if (!root) return "";
  const parts = [];
  root.querySelectorAll("p, li, h1, h2, h3, blockquote").forEach((el) => {
    if (el.closest("nav, aside, footer, header, figure, form")) return;
    const text = (el.innerText || "").trim();
    if (text.length > 40) parts.push(text);
  });
  return parts.join("\n\n").slice(0, 12000);
}

let jcFcRunId = 0;
let jcFcOverlay = null;
let jcFcLive = false;

function jcFcCloseOverlay() {
  if (jcFcLive) {
    chrome.runtime.sendMessage({ type: "JC_AUDIO_END" }, () => {
      void chrome.runtime.lastError;
    });
    jcFcLive = false;
  }
  if (jcFcOverlay) jcFcOverlay.remove();
  jcFcOverlay = null;
}

// A standing panel rather than the selection popup: a page check produces
// several verdicts that arrive at different times, and each one should appear
// the moment it lands instead of waiting for the slowest claim.
function jcFcOpenOverlay(sourceLabel) {
  jcFcCloseOverlay();
  const overlay = document.createElement("div");
  overlay.className = "jc-fc-overlay";
  overlay.innerHTML = `
    <div class="jc-fc-head">
      <div class="jc-fc-titles">
        <span class="jc-fc-kicker">Fact-check</span>
        <span class="jc-fc-src">${escapeHTML(sourceLabel)}</span>
      </div>
      <button class="jc-fc-close" type="button" aria-label="Close fact-check">×</button>
    </div>
    <div class="jc-fc-scroll">
      <p class="jc-fc-status">Finding claims worth checking</p>
      <div class="jc-fc-list"></div>
    </div>
  `;
  overlay.querySelector(".jc-fc-close").addEventListener("click", jcFcCloseOverlay);
  document.body.appendChild(overlay);
  jcFcOverlay = overlay;
  return overlay;
}

// Live mode: keep the tab's audio flowing through transcription and check each
// batch of speech as it accumulates. The overlay gains a running "heard" line
// so the reader can see it is actually listening, not hung.
function jcFcStartLive() {
  const overlay = jcFcOpenOverlay("Listening to this tab");
  overlay.classList.add("is-listening");
  overlay
    .querySelector(".jc-fc-status")
    .insertAdjacentHTML("afterend", `<p class="jc-fc-heard">Starting…</p>`);
  jcFcLive = true;

  chrome.runtime.sendMessage({ type: "JC_AUDIO_BEGIN" }, (resp) => {
    void chrome.runtime.lastError;
    if (!resp?.ok) {
      overlay.classList.remove("is-listening");
      jcFcLive = false;
      overlay.querySelector(".jc-fc-status").textContent =
        resp?.error || "Couldn't capture this tab's audio.";
      const heard = overlay.querySelector(".jc-fc-heard");
      if (heard) heard.remove();
      return;
    }
    overlay.querySelector(".jc-fc-status").textContent =
      "Listening — verdicts appear as claims are spoken.";
  });
}

function jcFcStartPageCheck(kind) {
  if (kind === "live") {
    jcFcStartLive();
    return;
  }
  const transcript = kind === "video" ? jcYouTubeTranscript() : null;
  if (kind === "video" && !transcript) {
    const overlay = jcFcOpenOverlay("YouTube");
    overlay.querySelector(".jc-fc-status").textContent =
      "Open the video's transcript first (⋯ → Show transcript), then run this again.";
    return;
  }
  const text = transcript || jcArticleText();
  if (!text || text.length < 200) {
    const overlay = jcFcOpenOverlay(kind === "video" ? "YouTube" : "This page");
    overlay.querySelector(".jc-fc-status").textContent =
      "Not enough readable text on this page to fact-check.";
    return;
  }

  const runId = ++jcFcRunId;
  const overlay = jcFcOpenOverlay(
    transcript ? "YouTube transcript" : document.title || "This page",
  );

  // Article mode marks the claims inline and keeps the overlay collapsed as a
  // fallback (revealed only if nothing matched the DOM). Video/transcript mode
  // has no page DOM to mark, so its overlay stays visible as before.
  if (kind === "page" && window.top === window) {
    jcClaimActive = true;
    jcClaimRunId = runId;
    overlay.classList.add("is-collapsed");
  }

  chrome.runtime.sendMessage({ type: "JC_FACTCHECK_TEXT", text, runId, limit: 6 }, () => {
    void chrome.runtime.lastError; // verdicts arrive as their own messages
  });
}

// Timestamps survive claim extraction often enough to be worth linking: turn a
// leading [1:23] back into a seek link on the video the claim came from.
function jcFcLinkTimestamp(claim) {
  const match = claim.match(/\[(\d+):(\d{2})(?::(\d{2}))?\]/);
  if (!match || !/(^|\.)youtube\.com$/.test(location.hostname)) {
    return escapeHTML(claim);
  }
  const [, a, b, c] = match;
  const seconds = c ? +a * 3600 + +b * 60 + +c : +a * 60 + +b;
  const url = new URL(location.href);
  url.searchParams.set("t", `${seconds}s`);
  return `<a class="jc-fc-stamp" href="${escapeHTML(url.toString())}">${escapeHTML(match[0])}</a> ${escapeHTML(claim.replace(match[0], "").trim())}`;
}

// ============================================================================
// Inline claim map — underline each check-worthy claim in the page itself and
// color it by verdict as the ruling lands, instead of listing verdicts in a
// side panel. Click an underline to see the verdict + sources in place.
// ============================================================================
// Page (article) mode drives this; video/live keep the overlay, since a
// transcript has no stable DOM to mark.

let jcClaimRunId = 0; // the fact-check run these marks belong to
let jcClaimActive = false; // marks are live on the page
const jcClaimMarks = new Map(); // claim index -> [<mark> elements]
const jcClaimResults = new Map(); // claim index -> verdict result
let jcClaimCardEl = null; // the open verdict card, if any

// Collect the page's text nodes once, skipping our own UI and non-prose so a
// claim quote is matched against readable content only.
function jcClaimTextNodes() {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (
          p.closest(
            "mark.jc-claim, #ambient-popup, #jc-ambient-panel, .jc-fc-overlay, .jc-claim-chip, .jc-claim-card, script, style, noscript",
          )
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  return nodes;
}

// Whitespace in the DOM (newlines, indentation) never matches the single spaces
// in an extracted quote, so both sides are collapsed to single spaces and the
// match is mapped back to real (node, offset) positions through an index table.
function jcClaimLocate(nodes, needle) {
  const want = String(needle || "").replace(/\s+/g, " ").trim();
  if (want.length < 8) return null;

  let full = "";
  const charNode = []; // per char: index into `nodes`
  const charOff = []; // per char: offset within that node
  nodes.forEach((node, ni) => {
    const v = node.nodeValue;
    for (let j = 0; j < v.length; j++) {
      full += v[j];
      charNode.push(ni);
      charOff.push(j);
    }
  });

  // Normalize `full` the same way, keeping a map from normalized index -> raw.
  let norm = "";
  const nmap = [];
  let prevSpace = false;
  for (let k = 0; k < full.length; k++) {
    if (/\s/.test(full[k])) {
      if (prevSpace) continue;
      norm += " ";
      nmap.push(k);
      prevSpace = true;
    } else {
      norm += full[k];
      nmap.push(k);
      prevSpace = false;
    }
  }
  const normTrimmed = norm.replace(/^ /, "");
  const trimShift = norm.length - normTrimmed.length;

  let at = normTrimmed.indexOf(want);
  let matchLen = want.length;
  if (at === -1) {
    // Fallback: the model trimmed or altered the tail — match a solid prefix.
    const prefix = want.split(" ").slice(0, 8).join(" ");
    if (prefix.length >= 12) {
      at = normTrimmed.indexOf(prefix);
      matchLen = prefix.length;
    }
    if (at === -1) return null;
  }
  at += trimShift;

  const fullStart = nmap[at];
  const fullEnd = nmap[at + matchLen - 1];
  if (fullStart == null || fullEnd == null) return null;
  return {
    startIdx: charNode[fullStart],
    startOff: charOff[fullStart],
    endIdx: charNode[fullEnd],
    endOff: charOff[fullEnd] + 1, // exclusive
  };
}

// Wrap the located span in <mark>s — one per text node it crosses — so the
// underline survives links and inline formatting inside the sentence.
function jcClaimWrap(nodes, loc, index) {
  const marks = [];
  for (let ni = loc.startIdx; ni <= loc.endIdx; ni++) {
    const node = nodes[ni];
    if (!node || !node.parentNode) continue;
    const from = ni === loc.startIdx ? loc.startOff : 0;
    const to = ni === loc.endIdx ? loc.endOff : node.nodeValue.length;
    if (from >= to) continue;

    let target = node;
    if (from > 0) target = target.splitText(from);
    if (to - from < target.nodeValue.length) target.splitText(to - from);

    const mark = document.createElement("mark");
    mark.className = "jc-claim is-pending";
    mark.dataset.claim = String(index);
    target.parentNode.insertBefore(mark, target);
    mark.appendChild(target);
    marks.push(mark);
  }
  return marks;
}

function jcClaimClearMarks() {
  jcClaimMarks.forEach((marks) => {
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
  });
  jcClaimMarks.clear();
  jcClaimResults.clear();
}

function jcClaimMapClear() {
  jcClaimCloseCard();
  jcClaimClearMarks();
  jcClaimActive = false;
  const chip = document.querySelector(".jc-claim-chip");
  if (chip) chip.remove();
  // Page mode keeps a hidden overlay as a fallback; clear it too so a re-run
  // starts clean.
  if (jcFcOverlay && jcFcOverlay.classList.contains("is-collapsed")) {
    jcFcCloseOverlay();
  }
}

// Underline every claim we can find in the page. Returns how many landed, so
// the caller can fall back to the overlay when the DOM doesn't match.
function jcClaimMapInit(claims, runId) {
  // Reset marks/card from any prior run WITHOUT closing the fallback overlay
  // this run just opened.
  jcClaimCloseCard();
  jcClaimClearMarks();
  jcClaimRunId = runId;
  jcClaimActive = true;

  let found = 0;
  claims.forEach((claim, index) => {
    const quote = claim && (claim.quote || claim.claim);
    if (!quote) return;
    // Re-collect each time: wrapping a prior claim split text nodes and the
    // `mark.jc-claim` filter now hides that claim's text from this search.
    const nodes = jcClaimTextNodes();
    const loc = jcClaimLocate(nodes, quote);
    if (!loc) return;
    const marks = jcClaimWrap(nodes, loc, index);
    if (marks.length) {
      marks.forEach((mark) =>
        mark.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          jcClaimOpenCard(index);
        }),
      );
      jcClaimMarks.set(index, marks);
      found++;
    }
  });

  jcClaimChip(`Checking ${claims.length} claim${claims.length === 1 ? "" : "s"}…`);
  return found;
}

function jcClaimMapResolve(index, result) {
  jcClaimResults.set(index, result);
  const marks = jcClaimMarks.get(index);
  if (marks) {
    const tone = jcFcMeta(result.verdict).tone;
    marks.forEach((mark) => {
      mark.classList.remove("is-pending");
      mark.classList.add(`jc-claim--${tone}`);
    });
  }
  jcClaimUpdateChip();
}

function jcClaimMapDone() {
  jcClaimUpdateChip(true);
}

// Floating tally, bottom-right. Doubles as the off switch for the whole layer.
function jcClaimChip(statusText) {
  let chip = document.querySelector(".jc-claim-chip");
  if (!chip) {
    chip = document.createElement("div");
    chip.className = "jc-claim-chip";
    chip.innerHTML = `
      <span class="jc-claim-chip-dot" aria-hidden="true"></span>
      <span class="jc-claim-chip-text"></span>
      <button class="jc-claim-chip-x" type="button" aria-label="Clear fact-check">×</button>
    `;
    chip.querySelector(".jc-claim-chip-x").addEventListener("click", jcClaimMapClear);
    document.body.appendChild(chip);
  }
  if (statusText) chip.querySelector(".jc-claim-chip-text").textContent = statusText;
  return chip;
}

function jcClaimUpdateChip(done) {
  const chip = document.querySelector(".jc-claim-chip");
  if (!chip) return;
  const tally = { true: 0, false: 0, mixed: 0, unknown: 0 };
  jcClaimResults.forEach((r) => {
    tally[jcFcMeta(r.verdict).tone]++;
  });
  const bits = [];
  if (tally.false) bits.push(`${tally.false} false`);
  if (tally.mixed) bits.push(`${tally.mixed} mixed`);
  if (tally.true) bits.push(`${tally.true} true`);
  if (tally.unknown) bits.push(`${tally.unknown} unverified`);
  const summary = bits.join(" · ") || "no verdicts yet";
  const marked = jcClaimMarks.size;
  const checked = jcClaimResults.size;
  chip.querySelector(".jc-claim-chip-text").textContent = done
    ? `${summary} — ${marked} marked on page`
    : `Checking… ${checked} done · ${summary}`;
  chip.classList.toggle("is-done", !!done);
}

function jcClaimCloseCard() {
  if (jcClaimCardEl) {
    jcClaimCardEl.remove();
    jcClaimCardEl = null;
    document.removeEventListener("keydown", jcClaimCardEsc, true);
  }
}

function jcClaimCardEsc(e) {
  if (e.key === "Escape") jcClaimCloseCard();
}

// Anchor the verdict card just under the first underline of the clicked claim.
function jcClaimOpenCard(index) {
  jcClaimCloseCard();
  const marks = jcClaimMarks.get(index);
  if (!marks || !marks.length) return;
  const anchor = marks[0];
  const result = jcClaimResults.get(index);

  const card = document.createElement("div");
  card.className = "jc-claim-card";
  card.innerHTML = result
    ? jcFcCard(result, { showClaim: true })
    : `<div class="jc-fc jc-fc--unknown"><div class="jc-fc-verdict">
         <span class="jc-fc-mark" aria-hidden="true"></span>
         <span class="jc-fc-word">Checking…</span></div>
         <p class="jc-fc-body">This claim is still being verified.</p></div>`;
  document.body.appendChild(card);
  jcClaimCardEl = card;

  const rect = anchor.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const gap = 8;
  let left = window.scrollX + rect.left;
  left = Math.max(
    window.scrollX + gap,
    Math.min(left, window.scrollX + window.innerWidth - cardRect.width - gap),
  );
  let top = window.scrollY + rect.bottom + gap;
  // Flip above the sentence if it would spill past the viewport bottom.
  if (rect.bottom + gap + cardRect.height > window.innerHeight) {
    top = window.scrollY + rect.top - cardRect.height - gap;
  }
  card.style.left = `${left}px`;
  card.style.top = `${Math.max(window.scrollY + gap, top)}px`;

  document.addEventListener("keydown", jcClaimCardEsc, true);
  setTimeout(() => {
    document.addEventListener(
      "mousedown",
      function onAway(e) {
        if (jcClaimCardEl && !jcClaimCardEl.contains(e.target) && e.target !== anchor) {
          jcClaimCloseCard();
          document.removeEventListener("mousedown", onAway, true);
        }
      },
      true,
    );
  }, 0);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;

  // Triggered from the toolbar popup. Answer synchronously so the popup can
  // close itself only once the page has actually taken the request.
  if (msg.type === "JC_FACTCHECK_PAGE") {
    jcFcStartPageCheck(msg.kind || "page");
    sendResponse({ ok: true });
    return;
  }

  // Inline claim map (page mode) runs whether or not the overlay is open, so it
  // is dispatched before the overlay guard below. It does not `return` — when
  // both layers are live they update together.
  if (jcClaimActive && msg.runId === jcClaimRunId) {
    if (msg.type === "JC_FACTCHECK_CLAIMS") {
      const found = jcClaimMapInit(msg.claims, msg.runId);
      // Nothing matched the DOM (SPA, paraphrased quotes) — hand off entirely to
      // the overlay list, which is already being populated below.
      if (!found) {
        const chip = document.querySelector(".jc-claim-chip");
        if (chip) chip.remove();
        jcClaimActive = false;
        if (jcFcOverlay) jcFcOverlay.classList.remove("is-collapsed");
      }
    } else if (msg.type === "JC_FACTCHECK_RESULT") {
      jcClaimMapResolve(msg.index, msg.result);
    } else if (msg.type === "JC_FACTCHECK_DONE") {
      jcClaimMapDone();
    }
  }

  if (!jcFcOverlay) return;

  // Live audio: each batch of speech is its own run, so rows are keyed by
  // run + index and new batches append below the ones already on screen.
  if (msg.type === "JC_AUDIO_LINE") {
    const heard = jcFcOverlay.querySelector(".jc-fc-heard");
    if (heard) {
      heard.textContent = msg.text;
      heard.classList.toggle("is-final", !!msg.isFinal);
    }
    return;
  }

  if (msg.type === "JC_AUDIO_ERROR") {
    const status = jcFcOverlay.querySelector(".jc-fc-status");
    if (status) status.textContent = msg.error;
    jcFcOverlay.classList.remove("is-listening");
    return;
  }

  if (msg.type === "JC_AUDIO_ENDED") {
    jcFcOverlay.classList.remove("is-listening");
    const heard = jcFcOverlay.querySelector(".jc-fc-heard");
    if (heard) heard.textContent = "Stopped listening.";
    return;
  }

  if (!jcFcLive && msg.runId !== jcFcRunId) return;

  if (msg.type === "JC_FACTCHECK_CLAIMS") {
    const status = jcFcOverlay.querySelector(".jc-fc-status");
    const list = jcFcOverlay.querySelector(".jc-fc-list");
    if (!msg.claims.length) {
      if (!jcFcLive) status.textContent = "No checkable factual claims found here.";
      return;
    }
    status.textContent = jcFcLive
      ? "Listening"
      : `Checking ${msg.claims.length} claim${msg.claims.length > 1 ? "s" : ""}`;
    const rows = msg.claims
      .map((claim, i) => {
        // Claims are {quote, claim} objects; show the sentence as it appeared.
        const display = typeof claim === "string" ? claim : claim.quote || claim.claim || "";
        return `<div class="jc-fc-row is-pending" data-jc-fc="${msg.runId}:${i}">
             <p class="jc-fc-quote">${jcFcLinkTimestamp(display)}</p>
             <div class="jc-fc-slot"><span class="jc-fc-pending">Checking</span></div>
           </div>`;
      })
      .join("");
    if (jcFcLive) list.insertAdjacentHTML("beforeend", rows);
    else list.innerHTML = rows;
    return;
  }

  if (msg.type === "JC_FACTCHECK_RESULT") {
    const row = jcFcOverlay.querySelector(`[data-jc-fc="${msg.runId}:${msg.index}"]`);
    if (!row) return;
    row.classList.remove("is-pending");
    row.querySelector(".jc-fc-slot").innerHTML = jcFcCard(msg.result);
    return;
  }

  if (msg.type === "JC_FACTCHECK_DONE") {
    const status = jcFcOverlay.querySelector(".jc-fc-status");
    if (status && !jcFcLive) {
      // State what happened, don't instruct. "Sources below each verdict" was
      // telling the reader something the layout already says.
      const n = jcFcOverlay.querySelectorAll(".jc-fc-row").length;
      status.textContent = `${n} claim${n === 1 ? "" : "s"} checked`;
    }
  }
});

// --- Adaptive layout: turn a freeform answer into typed UI blocks -------------
// The model returns plain text — no tool calls. We reshape the UI two ways:
//   1) LOCAL PARSING  — detect structure that's visible in the text itself
//      (numbered/bulleted lists, steps, term:def, number-heavy lines, long
//      prose) and render the matching component. Robust, never breaks.
//   2) LLM MARKERS    — the model optionally tags things only it understands:
//      [[MORE:title]]…[[/MORE]] folds an optional aside, [[KEY]]…[[/KEY]]
//      pins the single most important takeaway. See JC_LAYOUT_HINT.
// detectBlocks() splits text → [{type,…}]; renderBlocks() turns those into HTML.

// Escape + light inline formatting (**bold**, `code`) for a run of text.
function jcInline(text) {
  let s = escapeHTML((text || "").replace(/\s*\n\s*/g, " ").trim());
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

// Classify a marker-free chunk into a flat list of blocks, paragraph by
// paragraph. A "paragraph" is text separated by a blank line.
function jcParsePlain(segment) {
  const out = [];
  const paras = (segment || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const para of paras) {
    const lines = para
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // Numbered list: "1." / "1)" on every line.
    if (lines.length >= 2 && lines.every((l) => /^\d+[.)]\s+/.test(l))) {
      out.push({
        type: "list",
        ordered: true,
        items: lines.map((l) => l.replace(/^\d+[.)]\s+/, "")),
      });
      continue;
    }

    // Step-by-step: "Step 1", "Step 2" …
    if (lines.length >= 2 && lines.every((l) => /^step\s+\d+/i.test(l))) {
      out.push({
        type: "steps",
        items: lines.map((l) => l.replace(/^step\s+\d+\s*[:.)-]?\s*/i, "")),
      });
      continue;
    }

    // Bulleted list: "-", "*" or "•" on every line.
    if (lines.length >= 2 && lines.every((l) => /^[-*•]\s+/.test(l))) {
      out.push({
        type: "list",
        ordered: false,
        items: lines.map((l) => l.replace(/^[-*•]\s+/, "")),
      });
      continue;
    }

    // Term : definition list — a short label, a colon, then text, on each line.
    if (
      lines.length >= 2 &&
      lines.every((l) => /^[^:]{1,40}:\s+\S/.test(l) && !/[.!?]/.test(l.split(":")[0]))
    ) {
      out.push({
        type: "defs",
        items: lines.map((l) => {
          const i = l.indexOf(":");
          return { term: l.slice(0, i).trim(), def: l.slice(i + 1).trim() };
        }),
      });
      continue;
    }

    // Number-heavy line — 3+ numeric tokens ($, %, plain) in a short paragraph.
    // Lift the numbers into a compact chip strip above the sentence.
    const nums = (para.match(/\$?\d[\d,]*(?:\.\d+)?(?:\s?%|[kmbKMB]\b)?/g) || [])
      .map((n) => n.replace(/[,\s]+$/, "").trim())
      .filter(Boolean);
    if (nums.length >= 3 && para.length < 240) {
      out.push({ type: "stats", numbers: nums, text: para });
      continue;
    }

    // Long prose → collapse after the first sentence with a "show more".
    if (para.length > 280) {
      const m = para.match(/^[\s\S]*?[.!?](?=\s|$)/);
      const head = (m ? m[0] : para.slice(0, 160)).trim();
      out.push({ type: "prose", text: para, head, rest: para.slice(head.length).trim() });
      continue;
    }

    out.push({ type: "prose", text: para });
  }
  return out;
}

// Split the full answer into blocks, honoring [[MORE]]/[[KEY]] markers and
// running everything between them through the local classifier.
function detectBlocks(raw) {
  let text = (raw || "").trim();
  // Weak models (Gemini Nano) forget the closing tag or trail a [[TOPIC]] the
  // splitter missed. Drop a stray TOPIC, and auto-close a lone [[KEY]] so the
  // key sentence is still highlighted instead of the marker leaking as text.
  text = text.replace(/\[\[\s*TOPIC[^\]]*\]\][\s\S]*$/i, "").trim();
  if (/\[\[\s*KEY\s*\]\]/i.test(text) && !/\[\[\s*\/\s*KEY\s*\]\]/i.test(text)) {
    // Close at the end of the first sentence (or line) so the marker wraps just
    // the key sentence, not everything that follows it.
    text = /\[\[\s*KEY\s*\]\]\s*[\s\S]*?[.!?]/i.test(text)
      ? text.replace(/\[\[\s*KEY\s*\]\]\s*([\s\S]*?[.!?])/i, "[[KEY]]$1[[/KEY]]")
      : text.replace(/\[\[\s*KEY\s*\]\]\s*([^\n]+)/i, "[[KEY]]$1[[/KEY]]");
  }

  const blocks = [];
  const pushPlain = (slice) => {
    const t = jcStripStrayMarkers(slice).trim();
    if (t) blocks.push(...jcParsePlain(t));
  };
  const markerRe = /\[\[(MORE|KEY)(?::([^\]]*))?\]\]([\s\S]*?)\[\[\/\1\]\]/g;
  let last = 0;
  let m;
  while ((m = markerRe.exec(text))) {
    if (m.index > last) pushPlain(text.slice(last, m.index));
    const inner = jcStripStrayMarkers(m[3] || "").trim();
    if (m[1] === "MORE") {
      blocks.push({
        type: "collapse",
        title: (m[2] || "More detail").trim() || "More detail",
        body: jcParsePlain(inner),
      });
    } else {
      blocks.push({ type: "key", text: inner });
    }
    last = markerRe.lastIndex;
  }
  if (last < text.length) pushPlain(text.slice(last));
  return blocks;
}

function renderBlock(b) {
  switch (b.type) {
    case "key":
      return `<div class="jc-block jc-key">${jcInline(b.text)}</div>`;

    case "collapse":
      return `<details class="jc-block jc-collapse">
        <summary>${escapeHTML(b.title)}</summary>
        <div class="jc-collapse-body">${renderBlocks(b.body)}</div>
      </details>`;

    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      return `<${tag} class="jc-block jc-list${b.ordered ? " jc-list-num" : ""}">${b.items
        .map((i) => `<li>${jcInline(i)}</li>`)
        .join("")}</${tag}>`;
    }

    case "steps":
      return `<ol class="jc-block jc-steps">${b.items
        .map((i) => `<li><span class="jc-step-dot"></span><span>${jcInline(i)}</span></li>`)
        .join("")}</ol>`;

    case "defs":
      return `<dl class="jc-block jc-defs">${b.items
        .map(
          (d) =>
            `<div class="jc-def"><dt>${escapeHTML(d.term)}</dt><dd>${jcInline(d.def)}</dd></div>`,
        )
        .join("")}</dl>`;

    case "stats":
      return `<div class="jc-block jc-stats">
        <div class="jc-chips">${b.numbers
          .map((n) => `<span class="jc-chip">${escapeHTML(n)}</span>`)
          .join("")}</div>
        <p class="jc-stats-text">${jcInline(b.text)}</p>
      </div>`;

    case "prose":
      if (b.rest) {
        return `<details class="jc-block jc-prose-long">
          <summary><span class="jc-prose-head">${jcInline(b.head)}</span></summary>
          <div class="jc-prose-rest">${jcInline(b.rest)}</div>
        </details>`;
      }
      return `<p class="jc-block jc-prose">${jcInline(b.text)}</p>`;

    default:
      return `<p class="jc-block jc-prose">${jcInline(b.text || "")}</p>`;
  }
}

function renderBlocks(blocks) {
  return blocks.map(renderBlock).join("");
}

// Public entry used by renderAnswer / the dock: freeform text → adaptive HTML.
function formatExplanation(text) {
  return `<div class="jc-blocks">${renderBlocks(detectBlocks(text))}</div>`;
}

function escapeHTML(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

// --- Hotkey ask box ---
// Opened via the keyboard shortcut. Shows a text input; if the user has text
// highlighted it's carried in as context, otherwise the question is standalone.
// Enter morphs the panel into the loading circle, then it morphs back open with
// the answer (same is-loading / is-loaded transition as the highlight flow).

function openAskBox() {
  removePopup();
  removeBlob(false);

  // Carry any active selection in as context (the box still opens at the mouse).
  let data = null;
  const sel = window.getSelection();
  if (sel && sel.toString().trim() !== "") {
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const fullText =
      container.nodeType === Node.TEXT_NODE
        ? container.textContent
        : container.innerText || "";
    const contextWindow = extractSemanticWindow(
      fullText,
      range.startOffset,
      range.endOffset,
    );
    const contextWindowWide = extractSemanticWindow(
      fullText,
      range.startOffset,
      range.endOffset,
      { sentences: 6, maxRadius: 1400 },
    );
    data = {
      selectedText: sel.toString().trim(),
      contextWindow,
      contextWindowWide,
    };
  }

  const popup = document.createElement("div");
  popup.id = "ambient-popup";
  popup.classList.add("is-loaded");
  popup.innerHTML = `<div class="popup-content ready"></div>`;

  // White surface, dark text, soft border (mirrors openPopupAtSelection).
  popup.style.setProperty("--surface-color", "#ffffff");
  popup.style.setProperty("--bg-color", "#ffffff");
  popup.style.setProperty("--text-primary", "#1a1a1a");
  popup.style.setProperty("--text-secondary", "#555555");
  popup.style.setProperty("--border-color", "#e6e6e6");

  // Anchor the box (and the loading dot it morphs into) at the mouse cursor,
  // clamped so the full-width panel never spills off the viewport edges.
  const POPUP_WIDTH = 520;
  const left =
    window.scrollX +
    Math.max(
      POPUP_BOTTOM_GAP,
      Math.min(lastMouseX, window.innerWidth - POPUP_WIDTH - POPUP_BOTTOM_GAP),
    );
  const top = window.scrollY + Math.max(POPUP_BOTTOM_GAP, lastMouseY);
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
  popup.dataset.desiredTop = `${top}`;

  document.body.appendChild(popup);
  popupEl = popup;
  requestAnimationFrame(() => popup.classList.add("visible"));

  renderAskForm(popup, data);
}

function renderAskForm(popup, data) {
  popup.classList.remove("is-loading");
  popup.classList.add("is-loaded");

  const content = popup.querySelector(".popup-content");
  content.classList.remove("loading");
  content.classList.add("ready");

  const hasSel = !!(data && data.selectedText);
  const headerText = hasSel ? `"${data.selectedText}"` : "Ask JustClarify";
  const placeholder = hasSel
    ? "Ask about the highlighted text…"
    : "Ask anything…";

  content.innerHTML = `
    <div class="popup-header">
      <h1 class="header-name">${escapeHTML(headerText)}</h1>
    </div>
    <div class="popup-divider"></div>

    <form id="jc-ask-form" class="jc-ask-form">
      <input id="jc-ask-input" class="jc-ask-input" type="text" placeholder="${escapeHTML(placeholder)}" autocomplete="off" />
      <button type="submit" class="jc-ask-submit" aria-label="Ask">↵</button>
    </form>

    <div class="popup-footer">
      <span class="footer-meta">© 2026 JustClarify</span>
    </div>
  `;

  const form = content.querySelector("#jc-ask-form");
  const input = content.querySelector("#jc-ask-input");
  input.focus({ preventScroll: true });
  clampPopupPosition(popup);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    submitAsk(popup, data, question);
  });
}

function submitAsk(popup, data, question) {
  const hasSel = !!(data && data.selectedText);
  currentExplainData = hasSel
    ? {
        selectedText: data.selectedText,
        contextWindow: data.contextWindow,
        askQuestion: question,
      }
    : {
        selectedText: question,
        contextWindow: "",
        standalone: true,
        askQuestion: question,
      };

  // Morph the input panel down into the loading circle.
  setPopupLoading(popup);

  (async () => {
    try {
      const prompt = hasSel
        ? buildClaudePrompt("followup", data, question)
        : buildAskPrompt(question);
      const result = await askChatGPT(prompt, (chunk) =>
        renderStreaming(popup, chunk),
      );
      renderAnswer(popup, result.answer, "ANSWER", result.thinking);
      recordAsk({
        question,
        answer: result.answer,
        topic: result.topic,
        url: result.url,
      });
    } catch (err) {
      console.warn("Claude ask failed:", err);
      showClaudeError(popup, err);
    }
  })();
}

// Standalone question (no highlighted text to anchor to).
function buildAskPrompt(question) {
  return `Answer the following question clearly and concisely — a few sentences unless it genuinely needs more. Reply with just the answer, no preamble.

QUESTION:
${question}`;
}

// ============================================================================
// Conversation topics dock (bottom-right) + thread view
// ============================================================================
// Every ask is grouped into a "thread" under the short topic the model returns.
// A floating dock lists the CURRENT conversation's topics; hovering expands it,
// and clicking a topic reopens that Q&A with a reply box to keep chatting.

const JC_THREADS_KEY = "jcThreads"; // array of thread objects, newest first
const JC_CONVID_KEY = "jcDockConvId"; // id of the conversation we're showing
const JC_LAYOUT_KEY = "jcLayoutEvents"; // page-layout changes (collapse), newest first
const JC_PANEL_KEY = "jcPanelOn"; // user toggle: ambient floating panel on pages
const JC_PANEL_POS_KEY = "jcPanelPos"; // {left, top} once the user drags it
const JC_MAX_THREADS = 30; // cap kept per conversation
const JC_MAX_LAYOUT = 50; // cap kept for layout events
const JC_MODE_LABEL = {
  eli5: "ELI5",
  default: "Explain",
  detailed: "Expand",
  example: "Example",
  simpler: "Simplify",
  simplify: "Simplify",
  define: "Define",
  factcheck: "Factcheck",
  summarize: "Summarize",
  translate: "Translate",
};

let jcThreads = []; // all threads across conversations (filtered by convId to show)
let jcConvId = null; // conversation currently reflected in the dock
let currentThreadId = null; // thread new replies/follow-ups append to
let jcPanelOn = false; // ambient panel enabled from the toolbar toggle

function jcConversationId(url) {
  const m = url && url.match(/\/c\/([0-9a-f-]+)/i);
  return m ? m[1] : null;
}

function deriveTopic(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return "Untitled";
  const words = t.split(" ").slice(0, 4).join(" ");
  return words.length > 40 ? words.slice(0, 40) + "…" : words;
}

// --- Topic tag colors --------------------------------------------------------
// Each explained topic gets its own hue so its tag in the dock is visually
// distinct. We store just the hue (0-359) on the thread and let CSS derive the
// fill/border/text from it via OKLCH, which keeps every tag equally vivid and
// readable regardless of the hue that came up.

// Curated rotating palette as OKLCH hue angles: red (brand), orange, green,
// blue, purple, teal. Each new topic takes the next hue so chips cycle cleanly.
const JC_TAG_HUES = [25, 60, 145, 255, 310, 195];

// The hue for the Nth topic of a conversation (cycles through the palette).
function jcHueForIndex(n) {
  const len = JC_TAG_HUES.length;
  return JC_TAG_HUES[((n % len) + len) % len];
}

// Stable hash from a thread id — used to backfill threads saved before hues
// existed, so an old topic keeps the same palette colour every render.
function jcHueFromString(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

// The hue to paint a thread's tag with (its own, or a stable palette fallback).
function jcThreadHue(thread) {
  return typeof thread.hue === "number"
    ? thread.hue
    : jcHueForIndex(jcHueFromString(thread.id));
}

// A fully random OKLCH colour — lightness, chroma AND hue all vary, so every
// pile tile gets its own distinct shade. Stored on the thread at creation so it
// stays stable across re-renders/reloads.
function jcRandomOklch() {
  const L = (0.45 + Math.random() * 0.22).toFixed(3); // 0.45–0.67
  const C = (0.09 + Math.random() * 0.11).toFixed(3); // 0.09–0.20
  const H = Math.floor(Math.random() * 360);
  return `oklch(${L} ${C} ${H})`;
}

// The pile-tile colour for a thread: its own random colour, or a stable random
// fallback derived from its id for threads saved before colours existed.
function jcThreadColor(thread) {
  if (thread.color) return thread.color;
  const seed = jcHueFromString(thread.id || thread.topic || "x");
  const L = (0.45 + (seed % 23) / 100).toFixed(3); // 0.45–0.67
  const C = (0.09 + ((seed >> 5) % 12) / 100).toFixed(3); // 0.09–0.20
  const H = (seed >> 9) % 360;
  return `oklch(${L} ${C} ${H})`;
}

// --- Storage (chrome.storage.local with a localStorage fallback) -------------

function jcStorageGet(keys) {
  return new Promise((resolve) => {
    if (!extensionAlive()) {
      const out = {};
      keys.forEach((k) => {
        try {
          out[k] = JSON.parse(localStorage.getItem("jc:" + k));
        } catch (_) {
          out[k] = null;
        }
      });
      resolve(out);
      return;
    }
    try {
      chrome.storage.local.get(keys, (res) =>
        resolve(chrome.runtime.lastError ? {} : res),
      );
    } catch (_) {
      resolve({});
    }
  });
}

function jcStorageSet(obj) {
  try {
    Object.keys(obj).forEach((k) =>
      localStorage.setItem("jc:" + k, JSON.stringify(obj[k])),
    );
  } catch (_) {}
  return new Promise((resolve) => {
    if (!extensionAlive()) {
      resolve();
      return;
    }
    try {
      chrome.storage.local.set(obj, () => resolve());
    } catch (_) {
      resolve();
    }
  });
}

async function loadThreads() {
  const data = await jcStorageGet([JC_THREADS_KEY, JC_CONVID_KEY]);
  jcThreads = Array.isArray(data[JC_THREADS_KEY]) ? data[JC_THREADS_KEY] : [];
  jcConvId = data[JC_CONVID_KEY] || null;
}

function persistThreads() {
  return jcStorageSet({
    [JC_THREADS_KEY]: jcThreads,
    [JC_CONVID_KEY]: jcConvId,
  });
}

function threadsForCurrentConv() {
  return jcThreads.filter((t) => t.convId === jcConvId);
}

// --- Recording asks / replies into threads -----------------------------------

async function recordAsk({ question, answer, topic, url }) {
  const convId = jcConversationId(url) || jcConvId || "default";
  jcConvId = convId;

  const thread = {
    id: "t" + Date.now() + "-" + Math.floor(Math.random() * 1e6),
    convId,
    topic: topic || deriveTopic(question),
    hue: jcHueForIndex(jcThreads.filter((t) => t.convId === convId).length),
    color: jcRandomOklch(),
    messages: [
      { role: "user", text: question },
      { role: "assistant", text: answer },
    ],
    updated: Date.now(),
  };
  jcThreads.unshift(thread);
  currentThreadId = thread.id;

  // Cap how many we keep for this conversation (drop the oldest).
  const mine = jcThreads.filter((t) => t.convId === convId);
  if (mine.length > JC_MAX_THREADS) {
    const drop = new Set(mine.slice(JC_MAX_THREADS));
    jcThreads = jcThreads.filter((t) => !drop.has(t));
  }

  await persistThreads();
  renderPanel();
}

async function recordReply(threadId, question, answer, result) {
  const thread = jcThreads.find((t) => t.id === threadId);
  if (!thread) {
    // No thread to attach to (e.g. a stray suggested question) — start one.
    return recordAsk({
      question,
      answer,
      topic: result && result.topic,
      url: result && result.url,
    });
  }
  thread.messages.push(
    { role: "user", text: question },
    { role: "assistant", text: answer },
  );
  thread.updated = Date.now();
  // Bump to the top so the most recently touched thread leads the list.
  jcThreads = [thread, ...jcThreads.filter((t) => t !== thread)];
  await persistThreads();
  renderPanel();
}

// --- Recording layout changes ------------------------------------------------
// Collapse folds page context to change the layout. We persist a compact record
// of each fold — which page, what got hidden — tied to the conversation that was
// active, so the "All conversations" popup can show how the layout changed.
async function recordLayoutEvent({ type, count, gists }) {
  const convId = jcConvId || "default";
  const event = {
    id: "L" + Date.now() + "-" + Math.floor(Math.random() * 1e6),
    convId,
    type: type || "collapse",
    url: location.href,
    title: document.title || location.hostname,
    count: count || (gists ? gists.length : 0),
    gists: Array.isArray(gists) ? gists.slice(0, 6) : [],
    time: Date.now(),
  };

  const data = await jcStorageGet([JC_LAYOUT_KEY]);
  let events = Array.isArray(data[JC_LAYOUT_KEY]) ? data[JC_LAYOUT_KEY] : [];
  events.unshift(event);
  if (events.length > JC_MAX_LAYOUT) events = events.slice(0, JC_MAX_LAYOUT);
  await jcStorageSet({ [JC_LAYOUT_KEY]: events });
}


// --- Thread view (reopened from the ambient panel) ---------------------------

function buildReplyPrompt(thread, question) {
  return `Continuing our discussion about "${thread.topic}". Answer this follow-up clearly and concisely. Reply with just the answer, no preamble.

FOLLOW-UP:
${question}`;
}

function openThreadView(thread) {
  removePopup();
  removeBlob(false);
  currentThreadId = thread.id;

  const popup = document.createElement("div");
  popup.id = "ambient-popup";
  popup.classList.add("is-loaded", "jc-thread-popup");
  popup.innerHTML = `<div class="popup-content ready"></div>`;

  popup.style.setProperty("--surface-color", "#ffffff");
  popup.style.setProperty("--bg-color", "#ffffff");
  popup.style.setProperty("--text-primary", "#1a1a1a");
  popup.style.setProperty("--text-secondary", "#555555");
  popup.style.setProperty("--border-color", "#e6e6e6");

  document.body.appendChild(popup);
  popupEl = popup;
  requestAnimationFrame(() => popup.classList.add("visible"));

  renderThreadView(popup, thread);
}

function threadMessageHTML(m) {
  return m.role === "user"
    ? `<div class="jc-msg user"><span class="jc-msg-role">You</span>${escapeHTML(m.text)}</div>`
    : `<div class="jc-msg assistant"><span class="jc-msg-role">JustClarify</span>${formatExplanation(m.text)}</div>`;
}

function renderThreadView(popup, thread) {
  const content = popup.querySelector(".popup-content");
  const hue = jcThreadHue(thread);
  content.innerHTML = `
    <div class="popup-header" style="--jc-tag-hue: ${hue};">
      <h1 class="header-name"><span class="jc-tag">${escapeHTML(thread.topic)}</span></h1>
    </div>
    <div class="popup-divider"></div>

    <div class="jc-thread">${thread.messages.map(threadMessageHTML).join("")}</div>

    <form class="jc-reply-form jc-ask-form">
      <input class="jc-ask-input" type="text" placeholder="Reply…" autocomplete="off" />
      <button type="submit" class="jc-ask-submit" aria-label="Reply">↵</button>
    </form>

    <div class="popup-footer">
      <span class="footer-meta">© 2026 JustClarify</span>
    </div>
  `;

  const form = content.querySelector(".jc-reply-form");
  const input = content.querySelector(".jc-ask-input");
  const list = content.querySelector(".jc-thread");
  list.scrollTop = list.scrollHeight;
  input.focus({ preventScroll: true });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    submitReply(popup, thread.id, q);
  });
}

async function submitReply(popup, threadId, question) {
  const thread = jcThreads.find((t) => t.id === threadId);
  if (!thread) return;

  const list = popup.querySelector(".jc-thread");
  list.insertAdjacentHTML(
    "beforeend",
    `<div class="jc-msg user"><span class="jc-msg-role">You</span>${escapeHTML(question)}</div>
     <div class="jc-msg assistant jc-live"><span class="jc-msg-role">JustClarify</span><span class="jc-live-text"></span></div>`,
  );
  list.scrollTop = list.scrollHeight;
  const liveText = list.querySelector(".jc-live .jc-live-text");

  try {
    const result = await askChatGPT(buildReplyPrompt(thread, question), ({ answer }) => {
      if (liveText) liveText.textContent = answer;
      list.scrollTop = list.scrollHeight;
    });
    await recordReply(threadId, question, result.answer, result);
    const updated = jcThreads.find((t) => t.id === threadId);
    if (updated) renderThreadView(popup, updated);
  } catch (err) {
    console.warn("Reply failed:", err);
    if (liveText) {
      liveText.textContent = err?.message || "Couldn't get an answer. Try again.";
    }
  }
}

// Build the dock from saved threads on load (top frame only), and keep it in
// sync when other tabs record asks into storage.

// Paint this page's injected UI with the shared random accent (brand.js loads
// before content.js). Runs in every frame so nested popups match too.
try {
  if (typeof jcInitBrand === "function") jcInitBrand();
} catch (_) {}

(async function jcInitAmbient() {
  if (window.top !== window) return;
  try {
    await loadThreads();
    const s = await jcStorageGet([JC_PANEL_KEY]);
    jcPanelOn = !!s[JC_PANEL_KEY];
  } catch (_) {}
  renderPanel();

  try {
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes[JC_PANEL_KEY]) {
          jcPanelOn = !!changes[JC_PANEL_KEY].newValue;
          if (jcPanelOn) renderPanel();
          else removePanel();
        }
        if (changes[JC_THREADS_KEY] || changes[JC_CONVID_KEY]) {
          loadThreads().then(renderPanel);
        }
      });
    }
  } catch (_) {
    // storage events unavailable (stale context) — panel still works per-tab
  }
})();

// ============================================================================
// Ambient panel — a floating in-page workspace (our own DOM only)
// ============================================================================
// Off by default; enabled from the toolbar popup. A small draggable card that
// shows what JustClarify is doing while it does it: the live streaming answer
// as it arrives, then this page's recent topics as clickable chips. It never
// touches or restructures the host page — it only floats above it.

let jcPanelEl = null;
let jcPanelIdleTimer = null;

function ensurePanel() {
  if (!jcPanelOn || window.top !== window) return null;
  if (jcPanelEl && document.body.contains(jcPanelEl)) return jcPanelEl;

  const panel = document.createElement("div");
  panel.id = "jc-ambient-panel";
  panel.innerHTML = `
    <div class="jc-ap-head">
      <span class="jc-ap-dot" aria-hidden="true"></span>
      <span class="jc-ap-title">JustClarify</span>
      <span class="jc-ap-status"></span>
      <button class="jc-ap-x" aria-label="Turn off ambient panel">×</button>
    </div>
    <div class="jc-ap-livewrap"></div>
    <div class="jc-ap-threads"></div>
    <button class="jc-ap-ask" type="button">Ask anything…</button>
  `;

  // Closing the panel is the same as switching it off in the popup.
  panel.querySelector(".jc-ap-x").addEventListener("click", () => {
    try {
      chrome.storage.local.set({ [JC_PANEL_KEY]: false });
    } catch (_) {}
    jcPanelOn = false;
    removePanel();
  });

  panel.querySelector(".jc-ap-ask").addEventListener("click", () => openAskBox());

  jcPanelDragInit(panel);
  document.body.appendChild(panel);
  jcPanelEl = panel;

  // Restore the last dragged spot (clamped on-screen); default is CSS-set.
  jcStorageGet([JC_PANEL_POS_KEY]).then((s) => {
    const pos = s[JC_PANEL_POS_KEY];
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      jcPanelPlace(panel, pos.left, pos.top);
    }
  });

  requestAnimationFrame(() => panel.classList.add("jc-ap-in"));
  return panel;
}

function removePanel() {
  clearTimeout(jcPanelIdleTimer);
  if (jcPanelEl) {
    jcPanelEl.remove();
    jcPanelEl = null;
  }
}

function jcPanelPlace(panel, left, top) {
  const w = panel.offsetWidth || 250;
  const h = panel.offsetHeight || 120;
  const x = Math.min(Math.max(8, left), window.innerWidth - w - 8);
  const y = Math.min(Math.max(8, top), window.innerHeight - h - 8);
  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

function jcPanelDragInit(panel) {
  const head = panel.querySelector(".jc-ap-head");
  let startX = 0, startY = 0, baseLeft = 0, baseTop = 0, dragging = false;

  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".jc-ap-x")) return;
    dragging = true;
    const r = panel.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    baseLeft = r.left;
    baseTop = r.top;
    head.setPointerCapture(e.pointerId);
    panel.classList.add("jc-ap-dragging");
  });
  head.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    jcPanelPlace(panel, baseLeft + (e.clientX - startX), baseTop + (e.clientY - startY));
  });
  head.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("jc-ap-dragging");
    const r = panel.getBoundingClientRect();
    try {
      chrome.storage.local.set({ [JC_PANEL_POS_KEY]: { left: r.left, top: r.top } });
    } catch (_) {}
  });
}

// The page's recent topics as chips (same threads the diamonds dock shows).
function renderPanel() {
  const panel = ensurePanel();
  if (!panel) {
    if (!jcPanelOn) removePanel();
    return;
  }
  const wrap = panel.querySelector(".jc-ap-threads");
  const threads = threadsForCurrentConv().slice(0, 6);
  if (!threads.length) {
    wrap.innerHTML = `<div class="jc-ap-empty">Highlight anything to start.</div>`;
  } else {
    wrap.innerHTML = threads
      .map(
        (t) => `<button class="jc-ap-chip" data-thread-id="${t.id}"
          style="--jc-chip-hue:${jcThreadHue(t)}">${escapeHTML(t.topic)}</button>`,
      )
      .join("");
    wrap.querySelectorAll(".jc-ap-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const thread = jcThreads.find((t) => t.id === btn.getAttribute("data-thread-id"));
        if (thread) openThreadView(thread);
      });
    });
  }
}

// --- Which model is answering ------------------------------------------------
// The engine is reported by the background worker on every progress message
// (see gateway.js / ondevice.js), so the card can badge the model that is
// actually producing the text — including when an on-device miss falls back to
// the Gateway mid-request.
//
// Marks: an official brand SVG is used when one is present at
// icons/providers/<slug>.svg; otherwise a lettered tile in the provider's
// colour stands in. Drop the vendors' own SVGs into that folder and they get
// picked up automatically — nothing else to change.
const JC_ENGINES = {
  chrome: { name: "Chrome built-in", color: "#4285f4" },
  openai: { name: "OpenAI", color: "#10a37f" },
  anthropic: { name: "Anthropic", color: "#d97757" },
  google: { name: "Google", color: "#4285f4" },
  meta: { name: "Meta", color: "#0866ff" },
  mistral: { name: "Mistral", color: "#fa520f" },
  deepseek: { name: "DeepSeek", color: "#4d6bfe" },
  alibaba: { name: "Alibaba", color: "#ff6a00" },
  xai: { name: "xAI", color: "#141414" },
  cohere: { name: "Cohere", color: "#39594d" },
  perplexity: { name: "Perplexity", color: "#20808d" },
};

let jcEngine = null; // { slug, name, color, model }

function jcSetEngine(slug, model) {
  if (!slug) return;
  const key = String(slug).toLowerCase();
  const meta = JC_ENGINES[key] || { name: key, color: "#8a847e" };
  jcEngine = { slug: key, name: meta.name, color: meta.color, model: model || "" };
  // Repaint an open card so a mid-request engine switch is visible live.
  const panel = jcPanelEl;
  const head = panel && panel.querySelector(".jc-ap-card-head");
  if (head) jcFillEngineHead(head);
}

// The model line: "OpenAI · gpt-4o-mini", with the vendor prefix dropped from
// the model id since the provider name already carries it.
function jcEngineLabel() {
  if (!jcEngine) return "";
  const id = String(jcEngine.model || "").split("/").pop();
  return id ? `${jcEngine.name} · ${id}` : jcEngine.name;
}

// Build the mark element: official SVG if the file is there, lettered tile if
// not. Loading is per-element and silent — a missing file just means the tile
// stays.
function jcEngineMark() {
  const slug = jcEngine ? jcEngine.slug : "";
  const color = jcEngine ? jcEngine.color : "#8a847e";
  const name = jcEngine ? jcEngine.name : "";

  const holder = document.createElement("span");
  holder.className = "jc-ap-engine-mark";
  holder.style.background = color;
  holder.textContent = (name || "?").charAt(0).toUpperCase();

  if (slug) {
    try {
      const img = document.createElement("img");
      img.alt = "";
      img.addEventListener("load", () => {
        holder.textContent = "";
        holder.style.background = "transparent";
        holder.appendChild(img);
      });
      img.src = chrome.runtime.getURL(`icons/providers/${slug}.svg`);
    } catch (_) {
      // extension context gone — the lettered tile is already in place
    }
  }
  return holder;
}

function jcFillEngineHead(head) {
  const slot = head.querySelector(".jc-ap-engine-slot");
  const label = head.querySelector(".jc-ap-engine-name");
  if (slot) slot.replaceChildren(jcEngineMark());
  if (label) label.textContent = jcEngineLabel();
}

// Build (or return) the live card: a miniature of the real explain card —
// logo + quoted highlight header, divider, labelled streaming body — that
// scales out from under the panel's header exactly the way the answer panel
// scales out under the action buttons (.jc-explain-panel's is-open morph).
function jcPanelCard(panel) {
  const wrap = panel.querySelector(".jc-ap-livewrap");
  let card = wrap.querySelector(".jc-ap-card");
  if (card) return card;

  const sel = (currentExplainData?.selectedText || "").trim();
  card = document.createElement("div");
  card.className = "jc-ap-card";
  card.innerHTML = `
    <div class="jc-ap-card-head">
      <span class="jc-ap-engine-slot"></span>
      <div class="jc-ap-card-titles">
        <h1 class="header-name">${sel ? `"${escapeHTML(sel)}"` : "JustClarify"}</h1>
        <span class="jc-ap-engine-name"></span>
      </div>
    </div>
    <div class="jc-ap-card-divider"></div>
    <span class="content-label"></span>
    <div class="expl-text jc-ap-card-text"></div>
  `;
  jcFillEngineHead(card.querySelector(".jc-ap-card-head"));
  wrap.appendChild(card);
  requestAnimationFrame(() => card.classList.add("is-open"));
  return card;
}

// Collapse the card with the same morph in reverse, then drop it.
function jcPanelCardAway(panel) {
  const card = panel.querySelector(".jc-ap-card");
  if (!card) return;
  card.classList.remove("is-open");
  card.addEventListener("transitionend", () => card.remove(), { once: true });
  setTimeout(() => card.remove(), 500); // safety if transitionend never fires
}

// Live activity: called from askChatGPT as a request starts, streams, and ends.
// The panel breathes with the model — that's the "ambient" part.
function jcPanelActivity(state, text) {
  const panel = ensurePanel();
  if (!panel) return;
  clearTimeout(jcPanelIdleTimer);

  const status = panel.querySelector(".jc-ap-status");
  panel.classList.toggle("jc-ap-busy", state === "thinking" || state === "streaming");

  if (state === "thinking") {
    // A fresh ask always opens a fresh card so the scale-out plays again.
    jcPanelCardAway(panel);
    const card = jcPanelCard(panel);
    status.textContent = "thinking";
    card.querySelector(".content-label").textContent = "Thinking";
    card.querySelector(".jc-ap-card-text").textContent = "";
  } else if (state === "streaming") {
    const card = jcPanelCard(panel);
    status.textContent = "streaming";
    card.querySelector(".content-label").textContent = "Explanation";
    const t = (text || "").trim();
    card.querySelector(".jc-ap-card-text").textContent =
      t.length > 420 ? "…" + t.slice(-420) : t;
  } else if (state === "error") {
    const card = jcPanelCard(panel);
    status.textContent = "";
    card.querySelector(".content-label").textContent = "Hit a snag";
    card.querySelector(".jc-ap-card-text").textContent = text || "Try again.";
    jcPanelIdleTimer = setTimeout(() => jcPanelCardAway(panel), 6000);
  } else {
    // done — let the finished answer sit for a beat, then settle back to
    // ambient with the chips freshly updated.
    status.textContent = "";
    jcPanelIdleTimer = setTimeout(() => {
      jcPanelCardAway(panel);
      renderPanel();
    }, 2500);
  }
}

// --- Rewrite box (text tools) ---
// Opened from the toolbar popup. A centered, Grammarly-style box: paste text
// in, hit one of the rewrite buttons, get the transformed text back from the
// backend /transform endpoint.

const JC_RW_MODES = [
  { mode: "humanize", label: "Humanize" },
  { mode: "paraphrase", label: "Paraphrase" },
  { mode: "formal", label: "Formal" },
  { mode: "casual", label: "Casual" },
  { mode: "simplify", label: "Simplify" },
  { mode: "shorten", label: "Shorten" },
  { mode: "expand", label: "Expand" },
  { mode: "grammar", label: "Fix grammar" },
];

function closeRewriteBox() {
  const overlay = document.getElementById("jc-rw-overlay");
  if (!overlay) return;
  overlay.classList.remove("visible");
  document.removeEventListener("keydown", overlay._jcOnKeydown, true);
  setTimeout(() => overlay.remove(), 180);
}

function openRewriteBox() {
  if (document.getElementById("jc-rw-overlay")) return;
  removePopup();
  removeBlob(false);

  const overlay = document.createElement("div");
  overlay.id = "jc-rw-overlay";
  overlay.innerHTML = `
    <div class="jc-rw-panel" role="dialog" aria-modal="true" aria-label="JustClarify text tools">
      <div class="jc-rw-head">
        <span class="jc-rw-title">Text tools</span>
        <button class="jc-rw-close" type="button" aria-label="Close">✕</button>
      </div>
      <textarea class="jc-rw-input" placeholder="Paste or type your text here…" spellcheck="false"></textarea>
      <div class="jc-rw-actions">
        ${JC_RW_MODES.map(
          (m) =>
            `<button class="jc-rw-action" type="button" data-mode="${m.mode}">${m.label}</button>`,
        ).join("")}
      </div>
      <div class="jc-rw-status" hidden></div>
      <div class="jc-rw-result" hidden>
        <div class="jc-rw-result-label"></div>
        <div class="jc-rw-result-text"></div>
        <div class="jc-rw-result-bar">
          <button class="jc-rw-copy" type="button">Copy</button>
          <button class="jc-rw-useinput" type="button">Use as input</button>
        </div>
      </div>
    </div>`;

  const panel = overlay.querySelector(".jc-rw-panel");
  const input = overlay.querySelector(".jc-rw-input");
  const status = overlay.querySelector(".jc-rw-status");
  const result = overlay.querySelector(".jc-rw-result");
  const resultLabel = overlay.querySelector(".jc-rw-result-label");
  const resultText = overlay.querySelector(".jc-rw-result-text");
  const copyBtn = overlay.querySelector(".jc-rw-copy");
  const useBtn = overlay.querySelector(".jc-rw-useinput");
  const actionBtns = [...overlay.querySelectorAll(".jc-rw-action")];

  let busy = false;

  const setStatus = (msg, isError) => {
    status.hidden = !msg;
    status.textContent = msg || "";
    status.classList.toggle("is-error", !!isError);
  };

  const setBusy = (on, activeBtn) => {
    busy = on;
    actionBtns.forEach((b) => {
      b.disabled = on;
      b.classList.toggle("is-busy", on && b === activeBtn);
    });
  };

  const runTransform = async (mode, label, btn) => {
    const text = input.value.trim();
    if (!text) {
      setStatus("Paste some text in first.", true);
      input.focus();
      return;
    }
    if (busy) return;

    setBusy(true, btn);
    result.hidden = true;
    setStatus(`${label}…`);

    try {
      const res = await fetch(`${API_BASE_URL}/transform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mode }),
      });
      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.json()).detail || "";
        } catch (_) {}
        throw new Error(detail || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setStatus("");
      resultLabel.textContent = label;
      resultText.textContent = data.text || "";
      result.hidden = false;
      copyBtn.textContent = "Copy";
    } catch (e) {
      setStatus(e && e.message ? e.message : "Rewrite failed — try again.", true);
    } finally {
      setBusy(false, null);
    }
  };

  actionBtns.forEach((btn) => {
    btn.addEventListener("click", () =>
      runTransform(btn.dataset.mode, btn.textContent, btn),
    );
  });

  copyBtn.addEventListener("click", () => {
    navigator.clipboard
      .writeText(resultText.textContent || "")
      .then(() => {
        copyBtn.textContent = "Copied ✓";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1400);
      })
      .catch(() => setStatus("Couldn't copy — select the text manually.", true));
  });

  // Chain rewrites: feed the result back in as the next input.
  useBtn.addEventListener("click", () => {
    input.value = resultText.textContent || "";
    result.hidden = true;
    input.focus();
  });

  overlay.querySelector(".jc-rw-close").addEventListener("click", closeRewriteBox);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeRewriteBox();
  });
  // Keep page hotkeys (Shift+C etc.) from firing while typing in the box.
  panel.addEventListener("keydown", (e) => e.stopPropagation());

  overlay._jcOnKeydown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeRewriteBox();
    }
  };
  document.addEventListener("keydown", overlay._jcOnKeydown, true);

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("visible"));
  input.focus();
}

// ============================================================================
// Text area — the popup's "Text area" action morphs into a floating, resizable
// scratch editor: paste text in, reflow/align it, run quick rewrites, then copy
// or download it. Minimizes to a bottom-right bubble; expands to a spotlighted
// modal. Its own DOM only; nothing here touches the page.
// ============================================================================

let jcTaEl = null; // the editor card wrapper (#jc-ta)
let jcTaAlignIdx = -1; // -1 = untouched; 0..3 index into JC_TA_ALIGN
let jcTaExpanded = false; // spotlighted modal state
const JC_TA_ALIGN = ["justify", "center", "left", "right"];
const JC_TA_ALIGN_ICON = {
  justify: "alignJustify",
  center: "alignCenter",
  left: "alignLeft",
  right: "alignRight",
};
// The quick rewrites offered on the minimized bubble — same /transform modes as
// the toolbar text tools, pared to the three the reader reaches for most.
const JC_TA_QUICK = [
  { mode: "humanize", label: "Humanize" },
  { mode: "shorten", label: "Shorten" },
  { mode: "expand", label: "Expand" },
];

function jcTaEditor() {
  return jcTaEl && jcTaEl.querySelector(".jc-ta-editor");
}

function jcTaSetStatus(msg, isError) {
  if (!jcTaEl) return;
  const el = jcTaEl.querySelector(".jc-ta-status");
  if (!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
  el.classList.toggle("is-error", !!isError);
}

// The text-transform tools, shown as a real row along the bottom of the card
// (and a quick subset on the minimized bubble). Each runs the /transform
// backend on the editor's text and replaces it in place.
const JC_TA_TOOLS = [
  { mode: "humanize", label: "Humanize" },
  { mode: "shorten", label: "Shorten" },
  { mode: "expand", label: "Expand" },
  { mode: "summarize", label: "Summarize" },
  { mode: "paraphrase", label: "Paraphrase" },
  { mode: "grammar", label: "Fix grammar" },
];

let jcTaResizeObs = null; // keeps the external cancel pinned to the card corner

function openTextArea(prefill) {
  jcTaClose();
  removePopup();
  removeBlob(false);

  const wrap = document.createElement("div");
  wrap.id = "jc-ta";
  wrap.className = "jc-ta";
  // The cancel lives OUTSIDE the card: the card is overflow:hidden (for the
  // rounded corners + resize handle), which was clipping the corner ✕. It is
  // JS-positioned to the card's top-right corner instead.
  wrap.innerHTML = `
    <div class="jc-ta-card">
      <div class="jc-ta-tools" role="toolbar" aria-label="Text area tools">
        <button class="jc-ta-tool" data-act="copy" type="button" title="Copy">${jcIcon("copy")}</button>
        <div class="jc-ta-dl">
          <button class="jc-ta-tool" data-act="download" type="button" title="Download">${jcIcon("download")}</button>
          <div class="jc-ta-dl-menu" hidden>
            <button type="button" data-fmt="md">Markdown (.md)</button>
            <button type="button" data-fmt="pdf">PDF</button>
          </div>
        </div>
        <button class="jc-ta-tool" data-act="align" type="button" title="Align text">${jcIcon("alignJustify")}</button>
        <button class="jc-ta-tool" data-act="expand" type="button" title="Expand">${jcIcon("expandFull")}</button>
        <button class="jc-ta-tool" data-act="minimize" type="button" title="Minimize">${jcIcon("minimize")}</button>
      </div>
      <div class="jc-ta-editor" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true" data-placeholder="Paste or type text here…"></div>
      <div class="jc-ta-status" hidden></div>
      <div class="jc-ta-actions" role="toolbar" aria-label="Text tools">
        ${JC_TA_TOOLS.map(
          (t) => `<button class="jc-ta-action" type="button" data-mode="${t.mode}">${t.label}</button>`,
        ).join("")}
      </div>
    </div>
    <button class="jc-ta-cancel" type="button" aria-label="Close">${jcIcon("close")}</button>
  `;
  document.body.appendChild(wrap);
  jcTaEl = wrap;
  jcTaAlignIdx = -1;
  jcTaExpanded = false;

  const editor = jcTaEditor();
  if (prefill) editor.textContent = prefill;

  // Paste lands as plain text — deliberately "anyhow", no source formatting;
  // the Align control is what turns it back into shaped paragraphs.
  editor.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, text);
  });
  // Page hotkeys (double-Shift etc.) must not fire while typing here.
  wrap.addEventListener("keydown", (e) => e.stopPropagation());

  wrap.querySelector(".jc-ta-cancel").addEventListener("click", jcTaClose);
  wrap.querySelectorAll(".jc-ta-tool").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      jcTaTool(btn.dataset.act, btn);
    });
  });
  wrap.querySelectorAll(".jc-ta-action").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      jcTaTransform(btn.dataset.mode, btn.textContent, btn);
    });
  });
  wrap.querySelectorAll(".jc-ta-dl-menu button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.dataset.fmt === "md") jcTaDownloadMd();
      else jcTaDownloadPdf();
      wrap.querySelector(".jc-ta-dl-menu").hidden = true;
    });
  });

  wrap._jcOnKeydown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (jcTaExpanded) jcTaToggleExpand();
      else jcTaClose();
    }
  };
  document.addEventListener("keydown", wrap._jcOnKeydown, true);
  document.addEventListener("mousedown", jcTaDismissDlMenu, true);
  window.addEventListener("resize", jcTaPositionCancel);

  // Keep the external ✕ pinned to the card's corner as it resizes/expands.
  const card = wrap.querySelector(".jc-ta-card");
  if (typeof ResizeObserver !== "undefined") {
    jcTaResizeObs = new ResizeObserver(jcTaPositionCancel);
    jcTaResizeObs.observe(card);
  }

  requestAnimationFrame(() => {
    wrap.classList.add("visible");
    jcTaPositionCancel();
    editor.focus();
  });
}

// Pin the external cancel button to the live top-right corner of the card.
function jcTaPositionCancel() {
  if (!jcTaEl) return;
  const card = jcTaEl.querySelector(".jc-ta-card");
  const cancel = jcTaEl.querySelector(".jc-ta-cancel");
  if (!card || !cancel) return;
  const r = card.getBoundingClientRect();
  cancel.style.left = `${r.right - 13}px`;
  cancel.style.top = `${r.top - 13}px`;
}

function jcTaTool(act, btn) {
  if (!jcTaEl) return; // a tool clicked during the close animation
  if (act === "copy") jcTaCopy(btn);
  else if (act === "download") {
    const menu = jcTaEl.querySelector(".jc-ta-dl-menu");
    menu.hidden = !menu.hidden;
  } else if (act === "align") jcTaCycleAlign();
  else if (act === "expand") jcTaToggleExpand();
  else if (act === "minimize") jcTaMinimize();
}

// Close the download format menu on any click outside it.
function jcTaDismissDlMenu(e) {
  if (!jcTaEl) return;
  const menu = jcTaEl.querySelector(".jc-ta-dl-menu");
  if (!menu || menu.hidden) return;
  if (!e.target.closest(".jc-ta-dl")) menu.hidden = true;
}

function jcTaCopy(btn) {
  const editor = jcTaEditor();
  if (!editor) return;
  navigator.clipboard
    .writeText(editor.innerText || "")
    .then(() => {
      btn.classList.add("is-ok");
      setTimeout(() => btn.classList.remove("is-ok"), 1200);
    })
    .catch(() => jcTaSetStatus("Couldn't copy — select the text manually.", true));
}

// Split the raw text on blank lines into real paragraphs — done once, the first
// time the reader asks for alignment, so pasted "anyhow" text gets shaped.
function jcTaReflow() {
  const editor = jcTaEditor();
  if (!editor) return;
  const paras = (editor.innerText || "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (paras.length) {
    editor.innerHTML = paras
      .map((p) => `<p>${escapeHTML(p).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }
}

function jcTaCycleAlign() {
  const editor = jcTaEditor();
  if (!editor || !jcTaEl) return;
  if (jcTaAlignIdx < 0) jcTaReflow(); // first press also shapes paragraphs
  jcTaAlignIdx = (jcTaAlignIdx + 1) % JC_TA_ALIGN.length;
  const mode = JC_TA_ALIGN[jcTaAlignIdx];
  editor.style.textAlign = mode;
  const btn = jcTaEl.querySelector('[data-act="align"]');
  btn.innerHTML = jcIcon(JC_TA_ALIGN_ICON[mode]);
  btn.title = `Align: ${mode}`;
}

function jcTaToggleExpand() {
  if (!jcTaEl) return;
  jcTaExpanded = !jcTaExpanded;
  jcTaEl.classList.toggle("is-expanded", jcTaExpanded);
  let overlay = jcTaEl.querySelector(".jc-ta-overlay");
  if (jcTaExpanded && !overlay) {
    overlay = document.createElement("div");
    overlay.className = "jc-ta-overlay";
    overlay.addEventListener("click", jcTaToggleExpand);
    jcTaEl.insertBefore(overlay, jcTaEl.firstChild);
  } else if (!jcTaExpanded && overlay) {
    overlay.remove();
  }
  const btn = jcTaEl.querySelector('[data-act="expand"]');
  btn.innerHTML = jcIcon(jcTaExpanded ? "contract" : "expandFull");
  btn.title = jcTaExpanded ? "Shrink" : "Expand";
  // The card recenters/resizes over the transition — track its corner.
  jcTaPositionCancel();
  setTimeout(jcTaPositionCancel, 200);
}

function jcTaMinimize() {
  if (!jcTaEl) return;
  if (jcTaExpanded) jcTaToggleExpand();
  jcTaEl.classList.add("is-min");
  let bubble = jcTaEl.querySelector(".jc-ta-bubble");
  if (!bubble) {
    bubble = document.createElement("div");
    bubble.className = "jc-ta-bubble";
    bubble.innerHTML = `
      <button class="jc-ta-bubble-open" type="button" aria-label="Reopen text area">${jcIcon("textarea")}</button>
      <div class="jc-ta-bubble-actions">
        ${JC_TA_QUICK.map(
          (q) => `<button type="button" data-mode="${q.mode}">${q.label}</button>`,
        ).join("")}
      </div>
    `;
    bubble.querySelector(".jc-ta-bubble-open").addEventListener("click", jcTaRestore);
    bubble.querySelectorAll(".jc-ta-bubble-actions button").forEach((b) => {
      b.addEventListener("click", () => {
        jcTaRestore();
        jcTaTransform(b.dataset.mode, b.textContent);
      });
    });
    jcTaEl.appendChild(bubble);
  }
}

function jcTaRestore() {
  if (!jcTaEl) return;
  jcTaEl.classList.remove("is-min");
  jcTaPositionCancel();
  const editor = jcTaEditor();
  if (editor) editor.focus();
}

let jcTaBusy = false; // one /transform in flight at a time

async function jcTaTransform(mode, label, btn) {
  const editor = jcTaEditor();
  if (!editor || jcTaBusy) return;
  const text = (editor.innerText || "").trim();
  if (!text) {
    jcTaSetStatus("Nothing to rewrite yet.", true);
    return;
  }
  jcTaBusy = true;
  if (btn) btn.classList.add("is-busy");
  jcTaEl.querySelectorAll(".jc-ta-action").forEach((b) => (b.disabled = true));
  jcTaSetStatus(`${label}…`);
  try {
    const res = await fetch(`${API_BASE_URL}/transform`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, mode }),
    });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const data = await res.json();
    // The editor may have been closed/reopened while the request was in flight.
    const live = jcTaEditor();
    if (live) {
      live.textContent = data.text || text;
      jcTaAlignIdx = -1; // fresh text — alignment restarts from reflow
      live.style.textAlign = "";
    }
    jcTaSetStatus("");
  } catch (e) {
    jcTaSetStatus(e && e.message ? e.message : "Rewrite failed — try again.", true);
  } finally {
    jcTaBusy = false;
    if (jcTaEl) {
      jcTaEl.querySelectorAll(".jc-ta-action").forEach((b) => {
        b.disabled = false;
        b.classList.remove("is-busy");
      });
    }
  }
}

function jcTaDownloadMd() {
  const editor = jcTaEditor();
  if (!editor) return;
  // innerText already carries the visual line breaks; collapse runs of 3+ blank
  // lines so browser-inserted <div> wrappers don't double-space every line.
  const md = (editor.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "justclarify.md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// No PDF library in a content script — write the text into a hidden iframe and
// hand it to the browser's print dialog, where "Save as PDF" is one click.
function jcTaDownloadPdf() {
  const editor = jcTaEditor();
  if (!editor) return;
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(
    `<html><head><title>JustClarify</title><style>` +
      `body{font:14px/1.65 -apple-system,system-ui,"Segoe UI",sans-serif;color:#111;padding:48px;max-width:720px;margin:auto}` +
      `p{margin:0 0 1em}</style></head><body>${editor.innerHTML}</body></html>`,
  );
  doc.close();
  frame.contentWindow.focus();
  setTimeout(() => {
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 1000);
  }, 250);
}

function jcTaClose() {
  if (!jcTaEl) return;
  document.removeEventListener("keydown", jcTaEl._jcOnKeydown, true);
  document.removeEventListener("mousedown", jcTaDismissDlMenu, true);
  window.removeEventListener("resize", jcTaPositionCancel);
  if (jcTaResizeObs) {
    jcTaResizeObs.disconnect();
    jcTaResizeObs = null;
  }
  jcTaEl.classList.remove("visible");
  const el = jcTaEl;
  jcTaEl = null;
  jcTaExpanded = false;
  setTimeout(() => el.remove(), 160);
}

// listener for context menu message
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "EXPLAIN_SELECTION") {
    const selection = window.getSelection();
    const text = selection ? selection.toString() : "";
    removeBlob(false);
    openPopupAtSelection(jcSelectionAnchorRect(selection.getRangeAt(0)), {
      selectedText: text,
      contextWindow: text,
    });
  }

  if (request.type === "OPEN_ASK_BOX") {
    openAskBox();
  }

  // Popup button: spawn the centered text-tools box on this page.
  if (request.type === "OPEN_REWRITE_BOX") {
    openRewriteBox();
    sendResponse({ ok: true });
  }

});
