// commands.js — turn one spoken phrase into one browser action.
//
// Loaded AFTER content.js, so it calls straight into what the mouse already
// uses: jcRunAction for the JustClarify verbs, openPopupAtSelection for the
// answer surface, extractSemanticWindow for context. Voice is deliberately NOT
// a parallel feature set — nearly every verb below ends in a function a click
// already reaches, so the two input paths cannot drift apart.
//
// Two ideas carry the whole thing:
//
//  1. Reference resolution. "Explain this" names no object. jcResolveTarget()
//     picks the most RECENT thing the user could mean and returns a real DOM
//     Range wherever one exists — because a Range lets the entire existing
//     highlight pipeline run untouched, rather than growing a second one.
//
//  2. A grammar that runs before any model. Sending "scroll down" to an LLM
//     costs ~400ms and a fraction of a cent to decide something a regex
//     settles in microseconds. The model is the fallback, never the path.
//
// Exposes: jcVoiceExecute(transcript) -> { ok, label, spoken? }
//          jcResolveTarget(), jcVoiceUndo(), jcVoiceStopSpeaking()

(function () {
  // ---------------------------------------------------------------- context

  // What the tab's audio most recently said, when live listening is on. Keeps
  // "wait, is that true?" answerable — "that" is the video, not the page.
  const HEARD_MAX = 12;
  const heard = [];
  let heardAt = 0;

  // The first-open trust overlay for the LLM temp tab. Shadow DOM so the
  // provider's page can't restyle it; backdrop blurred, not opaque, so the
  // conversation is visibly happening behind the words.
  let llmOverlay = null;

  let llmOverlayCycle = null;

  function llmOverlayShow() {
    if (llmOverlay && llmOverlay.isConnected) return;
    llmOverlay = document.createElement("div");
    const root = llmOverlay.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { position: fixed; inset: 0; z-index: 2147483647; display: flex;
        align-items: center; justify-content: center;
        background: rgba(9, 8, 7, 0.62); backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        opacity: 0; transition: opacity 0.4s ease-out; }
      :host(.in) { opacity: 1; }
      .card { max-width: 360px; padding: 0 32px; text-align: center; color: #fff; }
      .mark { display: block; margin: 0 auto 26px; }
      .mark rect:first-child { transition: fill 1.6s ease-in-out; }
      h1 { font-size: 19px; font-weight: 600; line-height: 1.4; margin: 0 0 20px;
        letter-spacing: -0.01em; }
      p { font-size: 14px; line-height: 1.6; margin: 0 0 12px;
        color: rgba(255, 255, 255, 0.62); }
      button { margin-top: 26px; padding: 9px 26px; border: 0; border-radius: 999px;
        background: rgba(255, 255, 255, 0.12); color: #fff; font-size: 13.5px;
        font-family: inherit; cursor: pointer; transition: background 0.18s ease-out; }
      button:hover { background: rgba(255, 255, 255, 0.2); }
      @media (prefers-reduced-motion: reduce) {
        :host { transition: none; }
        .mark rect:first-child { transition: none; }
      }
    `;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <svg class="mark" width="36" height="36" viewBox="0 0 32 32" fill="none">
        <rect x="6" y="6" width="20" height="20" rx="5" transform="rotate(45 16 16)" fill="#fff"/>
        <rect x="11.5" y="11.5" width="9" height="9" rx="2.5" transform="rotate(45 16 16)" fill="rgba(9,8,7,0.9)"/>
      </svg>
      <h1>Your answer is on its way back to your page.</h1>
      <p>This tab runs on your own AI account. JustClarify stores nothing from it.</p>
      <p>You can leave whenever you like.</p>
      <button type="button">Got it</button>
    `;
    card.querySelector("button").addEventListener("click", () => llmOverlayHide());
    root.append(style, card);
    (document.body || document.documentElement).appendChild(llmOverlay);

    // The diamond drifts through random OKLCH hues, same palette language the
    // rest of the product wears. Bright enough to read on the dark scrim,
    // which the muted brand values used elsewhere would not be.
    const diamond = card.querySelector(".mark rect:first-child");
    let hue = Math.floor(Math.random() * 360);
    const paint = () => {
      // A big irregular step so consecutive colours never look like a gradient.
      hue = (hue + 60 + Math.floor(Math.random() * 90)) % 360;
      diamond.style.fill = `oklch(0.78 0.15 ${hue})`;
    };
    paint();
    llmOverlayCycle = setInterval(paint, 1800);

    requestAnimationFrame(() => llmOverlay && llmOverlay.classList.add("in"));
  }

  function llmOverlayHide() {
    const el = llmOverlay;
    llmOverlay = null;
    if (llmOverlayCycle) {
      clearInterval(llmOverlayCycle);
      llmOverlayCycle = null;
    }
    if (!el) return;
    el.classList.remove("in");
    setTimeout(() => el.remove(), 380);
  }

  // "Is this little window still wanted?" — asked on the USER'S page, the one
  // they are actually looking at, the moment they dismiss an answer. It used
  // to render inside the tile window itself, which meant growing that window
  // to fit a card — a popup the user was told to ignore suddenly resizing and
  // demanding a decision. Here it is a small corner card: no backdrop, no
  // dimming, and ignoring it means keeping, so it never has to be answered.
  let llmKeepCard = null;

  function llmKeepAsk(providerName) {
    return new Promise((resolve) => {
      if (llmKeepCard && llmKeepCard.isConnected) llmKeepCard.remove();
      llmKeepCard = document.createElement("div");
      const root = llmKeepCard.attachShadow({ mode: "open" });

      const style = document.createElement("style");
      style.textContent = `
        :host { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          opacity: 0; transform: translateY(10px);
          transition: opacity 0.22s ease-out, transform 0.28s cubic-bezier(0.16, 1, 0.3, 1); }
        :host(.in) { opacity: 1; transform: translateY(0); }
        .card { width: 268px; padding: 14px 16px; background: #fff; color: #14110f;
          border: 1px solid rgba(17, 17, 17, 0.1); border-radius: 14px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16); text-align: left; }
        h1 { font-size: 13.5px; font-weight: 650; line-height: 1.4; margin: 0 0 3px; }
        p { font-size: 12px; line-height: 1.5; margin: 0 0 12px; color: #7c736c; }
        .row { display: flex; gap: 8px; }
        button { flex: 1; padding: 6px 0; border: 0; border-radius: 999px; font-size: 12.5px;
          font-weight: 550; font-family: inherit; cursor: pointer;
          transition: filter 0.15s ease-out, background 0.15s ease-out; }
        .keep { background: #14110f; color: #fff; }
        .keep:hover { filter: brightness(1.25); }
        .close { background: #f1ede9; color: #14110f; }
        .close:hover { background: #e8e2dc; }
        @media (prefers-reduced-motion: reduce) { :host { transition: opacity 0.15s ease-out; transform: none; } }
      `;

      const card = document.createElement("div");
      card.className = "card";
      const name = providerName ? String(providerName) : "chat";
      card.innerHTML = `
        <h1>Keep the ${name} window open?</h1>
        <p>It answers your next question instantly. Close it any time.</p>
        <div class="row">
          <button type="button" class="keep">Keep it</button>
          <button type="button" class="close">Close</button>
        </div>
      `;

      let answered = false;
      const answer = (keep) => {
        if (answered) return;
        answered = true;
        document.removeEventListener("keydown", onKey, true);
        try { llmKeepCard.classList.remove("in"); } catch (_) {}
        setTimeout(() => { try { llmKeepCard.remove(); } catch (_) {} }, 300);
        resolve({ keep });
      };
      // Escape waves the question away, and waving away is keeping — the same
      // meaning as the timeout, just sooner.
      const onKey = (e) => { if (e.key === "Escape") answer(true); };
      document.addEventListener("keydown", onKey, true);
      card.querySelector(".keep").addEventListener("click", () => answer(true));
      card.querySelector(".close").addEventListener("click", () => answer(false));

      root.append(style, card);
      document.documentElement.appendChild(llmKeepCard);
      requestAnimationFrame(() => llmKeepCard.classList.add("in"));

      // Unanswered is not a decision. Left alone, it keeps the window rather
      // than closing something the user may still be about to use — and takes
      // itself off their page, because it is a guest there.
      setTimeout(() => answer(true), 15000);
    });
  }

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "JC_LLM_OVERLAY") {
        if (msg.show) llmOverlayShow();
        else llmOverlayHide();
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "JC_LLM_KEEP") {
        llmKeepAsk(msg.provider).then(sendResponse);
        return true; // async answer
      }
      // The free-asks meter crossing a milestone — one chip, no modal, in the
      // spirit of never making noise. Shown here because this file owns the
      // chip helper and runs on every page.
      if (msg?.type === "JC_METER_NOTE" && typeof jcVoiceChip === "function") {
        jcVoiceChip(
          "confirm",
          `You've used ${msg.used} of your ${msg.total} free asks \u2014 $3.99/month or your own AI key makes it unlimited.`,
          null,
          7000,
        );
      }
      // Additive: content.js has its own listener for this message and both run.
      if (msg?.type === "JC_AUDIO_LINE" && msg.isFinal && msg.text) {
        heard.push(String(msg.text).trim());
        while (heard.length > HEARD_MAX) heard.shift();
        heardAt = Date.now();
      }
    });
  } catch (_) {}

  // The last few sentences as one block — enough to carry a claim, short enough
  // that the model isn't asked to verify half a podcast.
  function heardRecently() {
    return heard.slice(-4).join(" ").trim();
  }

  let highlightAt = 0;
  document.addEventListener(
    "selectionchange",
    () => {
      const sel = window.getSelection();
      if (sel && sel.toString().trim()) highlightAt = Date.now();
    },
    { passive: true },
  );

  // ------------------------------------------------------- reference ladder

  // Blocks worth treating as "a thing on the page" — enough text to explain,
  // not so little that the cursor lands on a nav link.
  function textBlockAt(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el && el !== document.body) {
      const text = (el.innerText || "").trim();
      if (text.length >= 80 && text.length <= 4000) return el;
      el = el.parentElement;
    }
    return null;
  }

  function rangeOfElement(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range;
  }

  // Most-recent-wins rather than a fixed priority list. A live selection always
  // outranks everything because it is present tense — the user is pointing at
  // it as they speak. Below that, a highlight from ten seconds ago and a
  // sentence the video said two seconds ago are not comparable by category,
  // only by recency, and recency is what "that" actually tracks.
  function jcResolveTarget() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && sel.toString().trim()) {
      return {
        kind: "selection",
        range: sel.getRangeAt(0),
        text: sel.toString().trim(),
      };
    }

    const recentHighlight =
      typeof currentExplainData !== "undefined" && currentExplainData?.selectedText
        ? { at: highlightAt, value: currentExplainData }
        : null;
    const recentHeard = heard.length ? { at: heardAt, value: heardRecently() } : null;

    // Anything older than this stopped being what "that" means.
    const STALE_MS = 120_000;
    const now = Date.now();
    const fresh = [recentHighlight, recentHeard].filter(
      (c) => c && now - c.at < STALE_MS,
    );
    fresh.sort((a, b) => b.at - a.at);

    if (fresh.length) {
      const winner = fresh[0];
      if (winner === recentHeard) {
        // No DOM range exists for spoken audio — it was never on the page.
        return { kind: "heard", range: null, text: winner.value };
      }
      return {
        kind: "recent",
        range: null,
        text: winner.value.selectedText,
        data: winner.value,
      };
    }

    const x = typeof lastMouseX === "number" ? lastMouseX : window.innerWidth / 2;
    const y = typeof lastMouseY === "number" ? lastMouseY : window.innerHeight / 2;
    const block = textBlockAt(x, y);
    if (block) {
      return {
        kind: "cursor",
        range: rangeOfElement(block),
        text: (block.innerText || "").trim(),
      };
    }

    return null;
  }

  // Hand a resolved target to the existing highlight pipeline by actually
  // selecting it. Everything downstream — the popup, buildClaudePrompt, the
  // thread recorder — then behaves exactly as if the user had dragged over it.
  function adoptTarget(target) {
    if (!target?.range) return false;
    try {
      // Announce that the NEXT selectionchange is ours, not the user's — so
      // content.js doesn't pop the blob at a highlight the system just made.
      // The extension startling itself was a reported bug, not a theory.
      globalThis.jcSystemSelectionAt = Date.now();
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(target.range);
    } catch (_) {
      return false;
    }
    return true;
  }

  // Highlight as a POINTING gesture: select, scroll, flash — and stop. No
  // popup, no explanation. Saying a phrase you can see is how you point at it
  // with your voice; the follow-up ("explain", "read it") decides what happens.
  function highlightOnly(range) {
    globalThis.jcSystemSelectionAt = Date.now();
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {
      return { ok: false, label: "I couldn't select that." };
    }
    scrollRangeIntoView(range);
    flashRange(range);
    return { ok: true, label: "Highlighted — say\u201cexplain\u201d to dig in." };
  }

  // Ranges don't scroll themselves; their start element does.
  function scrollRangeIntoView(range) {
    let el = range.startContainer;
    if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // ------------------------------------------ context around a tight selection

  // A short selection must not mean a short context. commonAncestorContainer
  // for three spoken words is usually a single text node — reading the window
  // from that alone hands the model back the exact words it was already given
  // and nothing around them, which is the whole reason an explanation needs a
  // page at all. So: keep the SELECTION tight, and climb for the CONTEXT.
  const CONTEXT_MIN_CHARS = 240;
  const CONTEXT_MAX_CHARS = 6000;

  function contextRootFor(range) {
    let el = range.commonAncestorContainer;
    if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    if (!el) return null;

    let best = el;
    while (el && el !== document.body) {
      best = el;
      if ((el.innerText || "").trim().length >= CONTEXT_MIN_CHARS) break;
      const parent = el.parentElement;
      if (!parent) break;
      // Stop before the passage becomes the whole page — a window that wide
      // buries the sentence that was actually asked about.
      if ((parent.innerText || "").trim().length > CONTEXT_MAX_CHARS) break;
      el = parent;
    }
    return best;
  }

  // innerText and a Range's own toString disagree about whitespace often enough
  // that a plain indexOf misses. A miss used to silently anchor the window at
  // character 0, so a phrase near the end of a paragraph was explained with the
  // paragraph's opening as its surroundings.
  function locateText(haystack, needle) {
    const direct = haystack.indexOf(needle);
    if (direct >= 0) return { from: direct, to: direct + needle.length };

    // Whitespace-insensitive second pass, mapping back to real offsets.
    let flat = "";
    const map = [];
    for (let i = 0; i < haystack.length; i++) {
      const ch = /\s/.test(haystack[i]) ? " " : haystack[i];
      if (ch === " " && (!flat || flat.endsWith(" "))) continue;
      flat += ch;
      map.push(i);
    }
    const want = String(needle).replace(/\s+/g, " ").trim();
    if (!want) return null;
    const at = flat.indexOf(want);
    if (at < 0) return null;
    const last = Math.min(at + want.length - 1, map.length - 1);
    return { from: map[at], to: map[last] + 1 };
  }

  // Build the { selectedText, contextWindow, ... } shape openPopupAtSelection
  // expects, the same way the selectionchange handler in content.js does.
  function dataForRange(range, text) {
    const root = contextRootFor(range);
    const fullText = (root && (root.innerText || root.textContent)) || text || "";
    const at = locateText(fullText, text) || {
      from: 0,
      to: Math.min(String(text || "").length, fullText.length),
    };

    return {
      selectedText: text,
      contextWindow: extractSemanticWindow(fullText, at.from, at.to),
      contextWindowWide: extractSemanticWindow(fullText, at.from, at.to, {
        sentences: 6,
        maxRadius: 1400,
      }),
      lineCount: range.getClientRects().length,
    };
  }

  // The user's words, verbatim, for the ask currently being dispatched. Set at
  // every entry point (the grammar, the intent runner) so the prompt can carry
  // the QUESTION rather than only the phrase it grounded to. "What does he
  // mean by 'I spend my days'?" is a different ask than "explain 'I spend my
  // days'" — answering the second when the first was asked is exactly how "it
  // just defined the words" happens.
  let jcUtterance = "";

  // Only a question earns a seat in the prompt. An imperative ("explain this",
  // "read it out loud") adds nothing the action key doesn't already say, and
  // echoing it would just burn context.
  function questionish(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    return (
      /\?\s*$/.test(t) ||
      /^(what|why|how|who|whom|whose|when|where|which|does|do|did|is|are|was|were|can|could|should|would|will)\b/i.test(t)
    );
  }

  // Attach the spoken question to the data a popup ask will read — only for
  // the explain family ("style"), only when it actually reads as a question,
  // and never when it is just the highlighted text said out loud.
  function attachQuestion(data, kind, question) {
    const spoken = String(question || jcUtterance || "").trim();
    if (kind !== "style" || !questionish(spoken)) return data;
    const sel = String(data.selectedText || "").trim().toLowerCase();
    if (spoken.toLowerCase() === sel) return data;
    data.spokenQuestion = spoken;
    return data;
  }

  // Open the answer surface over a target and run one JustClarify verb on it.
  function runOnTarget(target, kind, key, question) {
    if (!target) return { ok: false, label: "I'm not sure what you mean — highlight something first." };

    if (target.range && adoptTarget(target)) {
      const data = attachQuestion(dataForRange(target.range, target.text), kind, question);
      openPopupAtSelection(jcSelectionAnchorRect(target.range), data);
      // openPopupAtSelection is async and builds the popup before the menu
      // exists, so let it settle rather than racing the DOM it creates.
      setTimeout(() => {
        const popup = document.getElementById("ambient-popup");
        if (popup) jcRunAction(popup, kind, key);
      }, 60);
      return { ok: true };
    }

    // Spoken audio and stale highlights have no live Range — the text is all
    // there is, so work from that directly.
    return runOnText(
      target.text,
      kind,
      key,
      target.kind === "heard" ? "Working from what was just said" : undefined,
      question,
    );
  }

  // A zero-width rect at the cursor, for answers with no DOM range to anchor to.
  function cursorRect() {
    const x = typeof lastMouseX === "number" ? lastMouseX : window.innerWidth / 2;
    const y = typeof lastMouseY === "number" ? lastMouseY : window.innerHeight / 2;
    return { left: x, right: x, top: y, bottom: y, width: 0, height: 0, x, y };
  }

  // Run a verb on bare text — a word the user spoke aloud, or a line the tab's
  // audio just said. Nothing on the page corresponds to it, so the popup is
  // anchored at the cursor and handed the same data shape a highlight produces.
  function runOnText(text, kind, key, label, question) {
    const value = String(text || "").trim();
    if (!value) return { ok: false, label: "I'm not sure what you mean." };

    openPopupAtSelection(cursorRect(), attachQuestion({
      selectedText: value,
      contextWindow: value,
      contextWindowWide: value,
      lineCount: 1,
    }, kind, question));
    setTimeout(() => {
      const popup = document.getElementById("ambient-popup");
      if (popup) jcRunAction(popup, kind, key);
    }, 60);
    return { ok: true, label };
  }

  // ------------------------------------------------------------------- undo

  // Every voice action pushes how to take itself back. Misrecognition is not an
  // edge case in speech — it is the normal failure — so "undo" has to be as
  // cheap to say as the thing it reverses.
  const undoStack = [];
  const UNDO_MAX = 20;

  function pushUndo(label, fn) {
    undoStack.push({ label, fn });
    while (undoStack.length > UNDO_MAX) undoStack.shift();
  }

  function jcVoiceUndo() {
    const last = undoStack.pop();
    if (!last) return { ok: false, label: "There's nothing to undo." };
    try {
      last.fn();
    } catch (_) {
      return { ok: false, label: `Couldn't undo ${last.label}.` };
    }
    return { ok: true, label: `Undid ${last.label}` };
  }

  // -------------------------------------------------------------- speaking

  // Chrome truncates long utterances and its pause/resume is unreliable, so
  // read-aloud is queued sentence by sentence. That also makes "stop" instant:
  // cancel() drops the queue rather than waiting out a paragraph.
  function jcVoiceStopSpeaking() {
    try {
      speechSynthesis.cancel();
    } catch (_) {}
    // "Stop" has to stop BOTH voices, or the hosted one keeps reading a
    // paragraph at someone who has already asked twice for quiet.
    if (hostedAudio) {
      try {
        hostedAudio.pause();
        URL.revokeObjectURL(hostedAudio.src);
      } catch (_) {}
      hostedAudio = null;
    }
  }

  // The browser's own voice is free, instant and offline, so it stays the
  // default. The hosted voice is the upgrade — a system voice reading a
  // paragraph aloud is the difference between a feature people use and one they
  // switch off — but it costs ~2.5s and money, so it is only for deliberate
  // read-aloud in AI mode, never for the one-line command confirmations.
  let hostedAudio = null;

  async function speakHosted(text) {
    try {
      // Same MV3 rule as transcription: the worker owns this fetch, because a
      // content script's would carry the page's origin and be refused.
      const response = await jcSendAsync({ type: "JC_VOICE_SPEAK", text });
      if (!response || !response.ok) return false;
      hostedAudio = new Audio(`data:${response.mimeType};base64,${response.audioBase64}`);
      hostedAudio.play().catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  }

  // Read-aloud is only ever reached by a deliberate "read this to me", so it
  // always gets the real voice — the system voice reading a paragraph is the
  // difference between a feature people use and one they switch off. Free mode
  // still stays local, because that tier's whole promise is no server calls.
  // speechSynthesis remains the fallback for every failure: no network, out of
  // credit, rate-limited. Nothing here can leave the user with silence.
  function speak(text) {
    jcVoiceStopSpeaking();
    const value = String(text);
    // speechSynthesis stays the fallback for every failure — no network, out
    // of credit, rate-limited. Nothing here may leave the user with silence.
    speakHosted(value).then((ok) => {
      if (!ok) speakLocal(value);
    });
  }

  function speakLocal(text) {
    const sentences = String(text)
      .replace(/\s+/g, " ")
      .match(/[^.!?]+[.!?]*/g) || [text];

    for (const sentence of sentences) {
      const chunk = sentence.trim();
      if (!chunk) continue;
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.rate = 1.05; // a touch above default reads as brisk, not rushed
      speechSynthesis.speak(utterance);
    }
  }

  // ------------------------------------------------------------ navigation

  // THE SCROLL BUG: window.scrollBy only moves the page when the PAGE is what
  // scrolls. On a huge share of modern sites it isn't — docs sites, dashboards
  // and app shells put `overflow: auto` on an inner div and leave <body> fixed
  // at viewport height. Every scroll command was being sent to a window that
  // had nowhere to go, so nothing moved and nothing errored.
  //
  // So: find the thing that actually scrolls, every time. It's cheap, and it
  // can change between commands on a single-page app.

  function docScroller() {
    return document.scrollingElement || document.documentElement;
  }

  function isScrollable(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = getComputedStyle(el);
    if (!/(auto|scroll|overlay)/.test(style.overflowY)) return false;
    return el.scrollHeight > el.clientHeight + 4;
  }

  function findScroller() {
    // The ordinary case, and the cheapest to test.
    const doc = docScroller();
    if (doc && doc.scrollHeight > doc.clientHeight + 4) return doc;

    // Otherwise start from whatever the user is looking at and walk outward —
    // the cursor is the best available guess at which pane they mean.
    const x = typeof lastMouseX === "number" ? lastMouseX : window.innerWidth / 2;
    const y = typeof lastMouseY === "number" ? lastMouseY : window.innerHeight / 2;
    let el = document.elementFromPoint(x, y);
    while (el && el !== document.body) {
      if (isScrollable(el)) return el;
      el = el.parentElement;
    }

    // Still nothing: take the largest scrollable box on the page, which on an
    // app shell is reliably the content pane rather than a sidebar.
    let best = null;
    let bestArea = 0;
    for (const candidate of document.querySelectorAll("div, main, section, article, ul")) {
      if (!isScrollable(candidate)) continue;
      const rect = candidate.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = candidate;
      }
    }
    return best || doc;
  }

  function scrollPos(el) {
    return el === docScroller() ? window.scrollY || el.scrollTop : el.scrollTop;
  }

  function viewportOf(el) {
    return el === docScroller() ? window.innerHeight : el.clientHeight;
  }

  // Smooth-scroll libraries (Lenis, Locomotive — this project's own site uses
  // Lenis) intercept scrolling and can swallow a programmatic smooth scroll
  // entirely. So: ask nicely, then check. If nothing moved, set scrollTop
  // directly, which no library can ignore.
  function applyScroll(el, top) {
    const from = scrollPos(el);
    const to = Math.max(0, Math.min(top, el.scrollHeight - viewportOf(el)));
    if (Math.abs(to - from) < 1) return;

    try {
      el.scrollTo({ top: to, behavior: "smooth" });
    } catch (_) {
      el.scrollTop = to;
      return;
    }

    setTimeout(() => {
      if (Math.abs(scrollPos(el) - from) < 2) el.scrollTop = to;
    }, 260);
  }

  function scrollByPage(fraction, label) {
    const el = findScroller();
    const before = scrollPos(el);
    applyScroll(el, before + viewportOf(el) * fraction);
    pushUndo(label, () => applyScroll(el, before));
    return { ok: true, label };
  }

  // Graded movement, because people don't speak in page-heights. "A bit more"
  // is a paragraph; "keep going" is most of a screen.
  function scrollByAmount(size, direction, label) {
    const el = findScroller();
    const step = { nudge: 0.22, normal: 0.85, big: 2.2 }[size] || 0.85;
    const before = scrollPos(el);
    applyScroll(el, before + viewportOf(el) * step * direction);
    pushUndo(label, () => applyScroll(el, before));
    return { ok: true, label };
  }

  function scrollToEdge(where, label) {
    const el = findScroller();
    const before = scrollPos(el);
    applyScroll(el, where === "top" ? 0 : el.scrollHeight);
    pushUndo(label, () => applyScroll(el, before));
    return { ok: true, label };
  }

  // ------------------------------------------------------- continuous scroll
  //
  // "Keep scrolling", "slower", "wait here" are one continuous act of steering,
  // not three commands — the same observation ForesightJS makes about hover:
  // the discrete event arrives after the intent has already been expressed.
  // So auto-scroll is a mode with a speed dial, not a repeated jump.

  const READING_SPEED = 55; // px/sec — unhurried prose speed
  let auto = null; // { raf, speed, el, last }

  function autoScrollStop(reason) {
    if (!auto) return false;
    cancelAnimationFrame(auto.raf);
    window.removeEventListener("wheel", autoScrollInterrupt);
    window.removeEventListener("keydown", autoScrollInterrupt);
    window.removeEventListener("mousedown", autoScrollInterrupt);
    auto = null;
    if (reason) jcVoiceChip("done", reason, null, 1400);
    return true;
  }

  // Any real input wins instantly. Having to *say* "stop" to a page that's
  // moving under your hands would be a terrible way to lose an argument.
  function autoScrollInterrupt() {
    autoScrollStop("Stopped");
  }

  function autoScrollStart(speed, label) {
    autoScrollStop(null);
    const el = findScroller();
    const state = { el, speed, last: performance.now(), raf: 0 };
    auto = state;

    const tick = (now) => {
      if (auto !== state) return;
      const dt = Math.min(now - state.last, 100) / 1000; // clamp a tab-switch gap
      state.last = now;

      const before = scrollPos(el);
      const next = before + state.speed * dt;
      el.scrollTop = next; // per-frame, so never 'smooth' — that would fight itself

      // Hit the end, or something else is holding it still: stop rather than
      // spin a rAF loop forever.
      if (scrollPos(el) <= before + 0.01 && state.speed > 0) {
        autoScrollStop("Reached the end");
        return;
      }
      state.raf = requestAnimationFrame(tick);
    };

    state.raf = requestAnimationFrame(tick);
    window.addEventListener("wheel", autoScrollInterrupt, { passive: true, once: true });
    window.addEventListener("keydown", autoScrollInterrupt, { once: true });
    window.addEventListener("mousedown", autoScrollInterrupt, { once: true });
    pushUndo("auto-scrolling", () => autoScrollStop(null));
    return { ok: true, label };
  }

  function autoScrollRate(multiplier) {
    if (!auto) return { ok: false, label: "I'm not scrolling right now." };
    auto.speed = Math.max(12, Math.min(600, auto.speed * multiplier));
    return { ok: true, label: `${Math.round(auto.speed)} px/s` };
  }

  // ------------------------------------------------------------ place memory

  // "Wait here" does both halves of what it means: stop moving, and treat this
  // as the spot worth coming back to.
  let marked = null;

  function waitHere() {
    const el = findScroller();
    marked = { el, top: scrollPos(el) };
    const wasMoving = autoScrollStop(null);
    return { ok: true, label: wasMoving ? "Holding here" : "Marked this spot" };
  }

  function backToMark() {
    if (!marked) return { ok: false, label: "You haven't marked a spot yet." };
    applyScroll(marked.el, marked.top);
    return { ok: true, label: "Back where you were" };
  }

  // ---------------------------------------------------------- semantic jump

  // Words too common to carry meaning in a "take me to the ___" query.
  //
  // "about" is deliberately NOT here. It is noise in "the part about pricing"
  // and it is the entire meaning of "the about us page" — banning it outright
  // makes the single most common navigation request unmatchable. The query
  // cleaner below strips the noise case by shape instead.
  const STOP = new Set(
    ("the a an of to in on at for and or but is are was were be been it its this that " +
      "as by we do so if my no i you your our " +
      "part bit section where does did talk talks talking mentions mentioned say says " +
      "take go jump find show scroll open").split(" "),
  );

  // Two-letter words carry real weight in navigation labels ("about us", "hr"),
  // so the floor is 2 rather than 3 and STOP does the filtering.
  function tokens(text) {
    return (String(text).toLowerCase().match(/[a-z0-9']+/g) || []).filter(
      (w) => w.length >= 2 && !STOP.has(w),
    );
  }

  // "the part about pricing" -> "pricing", but "the about us page" -> "about us".
  // Only the explicit "<filler> about X" shape loses its "about".
  function cleanQuery(raw) {
    return String(raw)
      .replace(/^(?:the\s+)?(?:part|bit|section|stuff)\s+(?:about|on|for|that says)\s+/i, "")
      .replace(/\b(?:part|bit|section|stuff)\b/gi, "")
      .replace(/\bpages?\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function candidateBlocks() {
    const blocks = [];
    const nodes = document.querySelectorAll(
      "p, li, h1, h2, h3, h4, h5, h6, td, blockquote, dd, article section",
    );
    for (const el of nodes) {
      if (el.closest("#ambient-popup, #jc-ambient-panel, #jc-voice-chip")) continue;
      const text = (el.innerText || "").trim();
      if (text.length < 25) continue;
      // An element whose text is entirely its child's would score twice.
      if (el.children.length && el.children[0].innerText?.trim() === text) continue;
      blocks.push({ el, text });
    }
    return blocks;
  }

  // Lexical overlap, not embeddings: no model, no network, no key — and for
  // "the bit about refunds" the query words are usually literally present.
  // Headings score higher because landing on the heading of the right section
  // beats landing three paragraphs into it.
  function bestBlock(want) {
    let best = null;
    let bestScore = 0;

    for (const block of candidateBlocks()) {
      const have = new Set(tokens(block.text));
      let hits = 0;
      for (const word of want) if (have.has(word)) hits++;
      if (!hits) continue;

      let score = hits / want.length;
      if (/^H[1-6]$/.test(block.el.tagName)) score *= 1.35;
      // Prefer the tightest block that matches — a whole <article> matching
      // every word is less useful than the paragraph that actually says it.
      score *= 1 / (1 + block.text.length / 4000);

      if (score > bestScore) {
        bestScore = score;
        best = block;
      }
    }
    return { block: best, score: bestScore };
  }

  // Links the user could plausibly mean. In-page anchors are excluded on
  // purpose: "#pricing" is a scroll, and the block scorer already owns that.
  function candidateLinks() {
    const links = [];
    for (const el of document.querySelectorAll("a[href]")) {
      if (el.closest("#ambient-popup, #jc-ambient-panel, #jc-voice-chip")) continue;
      const href = el.getAttribute("href") || "";
      if (!href || href.startsWith("#") || /^(?:javascript|mailto|tel):/i.test(href)) continue;
      const label = (el.innerText || el.getAttribute("aria-label") || el.title || "").trim();
      if (!label || label.length > 120) continue;
      links.push({ el, label, href });
    }
    return links;
  }

  function bestLink(want) {
    let best = null;
    let bestScore = 0;

    for (const link of candidateLinks()) {
      const have = new Set(tokens(link.label));
      let hits = 0;
      for (const word of want) if (have.has(word)) hits++;

      // A link can be called "Learn more" and still be the about page — the URL
      // is the other half of its name. Scored lower than a real label match so
      // it only decides when nothing better exists.
      if (!hits) {
        const fromUrl = new Set(tokens(link.href.replace(/[/_.-]+/g, " ")));
        for (const word of want) if (fromUrl.has(word)) hits += 0.7;
      }
      if (!hits) continue;

      let score = hits / want.length;
      // "About" as a whole nav item beats a sentence that merely contains it:
      // penalise labels carrying far more words than the query asked for.
      const labelLength = tokens(link.label).length || 1;
      score *= want.length / Math.max(want.length, labelLength);
      // Site chrome is where "about us" and "contact" actually live.
      if (link.el.closest("nav, header, footer")) score *= 1.3;

      if (score > bestScore) {
        bestScore = score;
        best = link;
      }
    }
    return { link: best, score: bestScore };
  }

  // "Go to the about us page" and "go to the pricing section" are the same
  // sentence with different intent, and no keyword reliably separates them —
  // plenty of sites have an "About" heading AND an "About" link. So score both
  // and let the page decide, nudged by whether the phrasing said "page".
  function goToDestination(raw) {
    const saidPage = /\bpages?\b/i.test(raw);
    const saidSection = /\b(?:section|part|bit|paragraph|heading)\b/i.test(raw);
    const query = cleanQuery(raw);

    // "Homepage", "the main page", "front page" — all one destination, and one
    // that no amount of link scoring reliably finds because the home link is
    // usually an unlabelled logo.
    if (HOME_WORDS.test(query) || HOME_WORDS.test(raw.trim())) return goHome();

    // A bare well-known site name means the site, even when the current page
    // happens to link to it. "Open google" on a page with a "Sign in with
    // Google" button should not press that button.
    const asSite = query.toLowerCase().trim();
    if (KNOWN_SITES[asSite]) return openSite(asSite);

    const want = tokens(query);
    if (!want.length) return { ok: false, label: "Where would you like to go?" };

    // Try the query and every alias for it, keeping whichever scores best. This
    // is what makes "get in touch" click a link labelled "Contact".
    let link = { link: null, score: 0 };
    let block = { block: null, score: 0 };
    for (const variant of queryVariants(query)) {
      const terms = tokens(variant);
      if (!terms.length) continue;
      const l = bestLink(terms);
      if (l.score > link.score) link = l;
      const b = bestBlock(terms);
      if (b.score > block.score) block = b;
    }

    const linkScore = link.score * (saidPage ? 1.6 : 1) * (saidSection ? 0.5 : 1);
    const blockScore = block.score * (saidSection ? 1.6 : 1) * (saidPage ? 0.5 : 1);

    if (link.link && linkScore >= blockScore && linkScore >= 0.4) {
      // .click() rather than assigning location: it respects SPA routers,
      // target="_blank" and whatever handler the site attached.
      pushUndo("that navigation", () => history.back());
      link.link.el.click();
      return { ok: true, label: `Opening "${link.link.label}"` };
    }

    // Below roughly a third of the query's content words, a "match" is noise.
    if (block.block && blockScore >= 0.28) {
      // scrollIntoView finds the right container by itself; undoing it does
      // not, so the restore has to go through the same scroller lookup or it
      // silently does nothing on an app-shell layout.
      const scroller = findScroller();
      const before = scrollPos(scroller);
      block.block.el.scrollIntoView({ behavior: "smooth", block: "center" });
      flash(block.block.el);
      pushUndo("that jump", () => applyScroll(scroller, before));
      return { ok: true, label: `Jumped to "${query}"` };
    }

    // Nothing on this page matches. Before guessing at other domains, use what
    // the site itself offers — its search box first, then its other pages.
    // searchHere() handles the last resort if the site has nothing either.
    if (siteSearchField() || sameOriginLinks().length) return searchHere(query, null);

    // No box, no links to follow — a single-page app or a bare document. Only
    // now is "they must have meant a different site" the best reading left, and
    // even then a bare word has to earn it out of history rather than out of a
    // .com suffix.
    const site = resolveSite(query);
    if (site && !site.bare) return openSite(query);
    if (site) {
      return openSite(query, {
        allowGuess: false,
        onGiveUp: () => jcVoiceChip("unknown", `I can't find "${query}" on this page.`, null, 3000),
      });
    }

    return { ok: false, label: `I can't find "${query}" on this page.` };
  }

  // -------------------------------------------------- destinations off-page

  // "Open google" must work on a page that never mentions Google, so these
  // can't come from scanning links. Kept deliberately short — it's the head of
  // the distribution, not a directory. Anything else is guessed and confirmed.
  const KNOWN_SITES = {
    google: "https://www.google.com",
    youtube: "https://www.youtube.com",
    gmail: "https://mail.google.com",
    github: "https://github.com",
    gitlab: "https://gitlab.com",
    vercel: "https://vercel.com",
    twitter: "https://x.com",
    x: "https://x.com",
    linkedin: "https://www.linkedin.com",
    reddit: "https://www.reddit.com",
    wikipedia: "https://www.wikipedia.org",
    chatgpt: "https://chatgpt.com",
    openai: "https://openai.com",
    claude: "https://claude.ai",
    anthropic: "https://www.anthropic.com",
    notion: "https://www.notion.so",
    figma: "https://www.figma.com",
    spotify: "https://open.spotify.com",
    amazon: "https://www.amazon.com",
    apple: "https://www.apple.com",
    microsoft: "https://www.microsoft.com",
    netflix: "https://www.netflix.com",
    maps: "https://maps.google.com",
    drive: "https://drive.google.com",
    calendar: "https://calendar.google.com",
    stackoverflow: "https://stackoverflow.com",
    "stack overflow": "https://stackoverflow.com",
    npm: "https://www.npmjs.com",
    mdn: "https://developer.mozilla.org",
    "hacker news": "https://news.ycombinator.com",
    instagram: "https://www.instagram.com",
    facebook: "https://www.facebook.com",
    tiktok: "https://www.tiktok.com",
    whatsapp: "https://web.whatsapp.com",
    slack: "https://app.slack.com",
    discord: "https://discord.com",
    twitch: "https://www.twitch.tv",
    ebay: "https://www.ebay.com",
    paypal: "https://www.paypal.com",
    stripe: "https://stripe.com",
    cloudflare: "https://www.cloudflare.com",
    supabase: "https://supabase.com",
    railway: "https://railway.com",
    netlify: "https://www.netlify.com",
  };

  // The suffixes a spoken address is allowed to end in without being treated as
  // a guess. NOT a public-suffix list and never trying to be one — it exists to
  // answer one question: "did they actually name a real address, or did the
  // recogniser hand me a word with a dot in it?"
  const KNOWN_TLDS = new Set([
    "com", "org", "net", "edu", "gov", "int", "mil",
    "io", "ai", "dev", "app", "co", "so", "sh", "gg", "xyz", "me", "tv", "fm",
    "cloud", "tech", "design", "studio", "page", "site", "online", "store",
    "uk", "us", "ca", "au", "de", "fr", "es", "it", "nl", "se", "no", "fi",
    "jp", "cn", "in", "br", "mx", "ru", "ch", "at", "be", "pl", "pt", "ie",
    "ng", "za", "ke", "gh", "eu", "info", "biz", "ly", "to", "cc", "id",
    "co.uk", "co.jp", "com.au", "co.za", "com.br", "com.ng", "co.nz", "co.in",
    "org.uk", "ac.uk", "gov.uk", "com.mx", "co.kr",
  ]);

  // What a recogniser produces when someone SAYS ".com". The last consonant is
  // the first thing to go, which is how "apple dot com" arrives as "apple.co" —
  // a real TLD, a real country, and completely the wrong place to be sent.
  // Only ever consulted for a brand we already know, so "bit.ly" and a genuine
  // ".co" startup are never touched.
  const COM_MISHEARINGS = new Set(["co", "con", "com", "comm", "calm", "cam", "coms", "corn"]);

  // Words that all mean "the front page of the site I'm on".
  const HOME_WORDS = /^(?:the\s+)?(?:home|homepage|home page|main page|front page|start page|index)$/i;

  // The same aliasing problem home has, for every other page a site tends to
  // have. A user says "get in touch"; the link says "Contact". Nothing about
  // lexical overlap connects those two, so the groups do it by hand — each
  // entry is a set of names for ONE destination, and matching any member lets
  // the scorer try all of them.
  const PAGE_ALIASES = [
    ["about", "about us", "who we are", "our story", "company", "team"],
    ["contact", "contact us", "get in touch", "reach us", "support", "help"],
    ["pricing", "plans", "price", "cost", "billing", "subscribe"],
    ["docs", "documentation", "developers", "developer", "api", "sdk", "reference", "guides"],
    ["login", "log in", "sign in", "signin", "account"],
    ["sign up", "signup", "register", "get started", "start free", "create account"],
    ["blog", "news", "articles", "updates", "changelog", "releases"],
    ["careers", "jobs", "hiring", "work with us", "open roles"],
    ["privacy", "privacy policy", "terms", "legal"],
    ["download", "downloads", "install", "get the app"],
  ];

  // Every name for whatever the user asked for, themselves included. Scoring
  // takes the best result across the whole group, so "get in touch" finds a
  // "Contact" link and "sdk" finds a "Documentation" one.
  function queryVariants(query) {
    const needle = query.toLowerCase().trim();
    const variants = [query];
    for (const group of PAGE_ALIASES) {
      if (group.some((name) => name === needle || needle.includes(name))) {
        for (const name of group) if (name !== needle) variants.push(name);
        break; // one destination only — a query is not two pages at once
      }
    }
    return variants;
  }

  // Prefer the site's own home link over a bare origin hop: it keeps SPA
  // routing, locale prefixes and subpath deployments intact. The logo is
  // usually the first link in the header that wraps an image.
  function goHome() {
    const candidates = [
      document.querySelector("header a[href='/'], nav a[href='/']"),
      document.querySelector("header a img, [class*='logo'] a, a[class*='logo']"),
      ...Array.from(document.querySelectorAll("nav a, header a")).filter((a) =>
        /^home$/i.test((a.innerText || "").trim()),
      ),
    ].filter(Boolean);

    const link = candidates.find((el) => el.closest("a") || el.tagName === "A");
    const anchor = link && (link.tagName === "A" ? link : link.closest("a"));

    pushUndo("going home", () => history.back());
    if (anchor && anchor.getAttribute("href")) {
      anchor.click();
      return { ok: true, label: "Going home" };
    }
    // No usable home link — the origin is always correct, just blunter.
    location.href = location.origin;
    return { ok: true, label: "Going to " + location.hostname };
  }

  // Speech writes the separator out as a word about as often as it types one:
  // "apple dot com", "news dot y combinator dot com". Fold both spellings into
  // the same address before anything tries to read it.
  function spokenDomain(raw) {
    return String(raw)
      .toLowerCase()
      .replace(/[^a-z0-9.\- ]+/g, "")
      .replace(/\s+dot\s+/g, ".")
      .replace(/\s*\.\s*/g, ".")
      .replace(/\s+/g, " ")
      .trim();
  }

  // The registrable suffix, longest match first, so "amazon.co.uk" ends in
  // "co.uk" rather than "uk" and keeps its brand.
  function suffixOf(host) {
    const labels = host.split(".");
    if (labels.length >= 3) {
      const pair = labels.slice(-2).join(".");
      if (KNOWN_TLDS.has(pair)) return pair;
    }
    const last = labels[labels.length - 1];
    return KNOWN_TLDS.has(last) ? last : "";
  }

  // A spoken site name -> a URL, plus whether we're sure enough to just go.
  // "open google" is certain; "open yolat" is a guess and has to be confirmed,
  // because navigating away loses whatever the user was reading.
  //
  // The one thing this must never do is treat "<any word>.com" as an answer.
  // Appending .com to whatever it was handed is how "open the pricing section"
  // became a trip to thepricingsection.com — the guess is offered last, never
  // taken, and only ever for something that could plausibly BE a brand.
  function resolveSite(rawName) {
    const name = spokenDomain(rawName);
    if (!name) return null;

    if (KNOWN_SITES[name]) return { url: KNOWN_SITES[name], sure: true };

    // Already said as an address — "open vercel.com", "news.ycombinator.com".
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(name)) {
      const suffix = suffixOf(name);
      const labels = name.split(".");
      const brand = labels.length === 2 ? labels[0] : "";
      const canonical = brand && KNOWN_SITES[brand];

      // A brand we know, wearing a suffix that isn't the one it actually uses.
      // Two ways that happens and both mean the same thing: the recogniser
      // clipped ".com" down to ".co", or the speaker was guessing. Either way
      // the brand is the reliable half of what was said and the suffix is the
      // unreliable half — so the brand decides, and the chip says which address
      // it landed on rather than pretending nothing was corrected.
      if (canonical) {
        const canonicalHost = canonical.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
        const heardHost = name.replace(/^www\./, "");

        // Same address, said the long way. Use the entry we hold rather than
        // rebuilding it, so "apple" and "apple dot com" land identically
        // instead of on two hosts that merely redirect to each other.
        if (canonicalHost === heardHost) return { url: canonical, sure: true };

        const heardSuffix = suffix || labels[labels.length - 1];
        const canonicalSuffix = suffixOf(canonicalHost);
        const misheard = canonicalSuffix === "com" && COM_MISHEARINGS.has(heardSuffix);
        // A suffix that isn't real, or one that is only what ".com" sounds
        // like when the last consonant goes missing. Anything else — google.de,
        // amazon.co.uk — is a real address and is left exactly as spoken.
        if (!suffix || misheard) {
          return { url: canonical, sure: true, corrected: heardHost };
        }
      }

      // A real suffix on a brand we've never heard of is still a real address.
      if (suffix) return { url: `https://${name}`, sure: true };

      // "pricing.section" — a dot does not make an address. Offered, not taken.
      return { url: `https://${name}`, sure: false };
    }

    // A bare word, with nothing after it. There is no address here yet: the
    // history lookup in openSite is what turns it into one, and ".com" is only
    // the fallback it falls back TO. Restricted to a SINGLE plausible brand
    // word on purpose — this is the last resort in goToDestination, so a failed
    // on-page search must not become a domain guess.
    if (/\s/.test(name)) return null;
    if (!/^[a-z0-9-]{2,24}$/.test(name)) return null;
    return { url: `https://${name}.com`, sure: false, bare: true };
  }

  // `allowGuess: false` says "history only" — check whether this is somewhere
  // they actually go, and if it isn't, hand back to `onGiveUp` instead of
  // offering "<word>.com?". That distinction is the whole difference between a
  // failed on-page search ending in a useful question and it ending in a domain
  // nobody has ever visited.
  function openSite(rawName, { allowGuess = true, onGiveUp = null } = {}) {
    const site = resolveSite(rawName);
    if (!site) {
      if (onGiveUp) return onGiveUp();
      return { ok: false, label: `I don't know a site called "${rawName}".` };
    }

    const goTo = (url) => {
      // A different site in a new tab: this is the navigation most likely to
      // throw away something the user still wanted.
      openInNewTab(url, `Opening ${rawName}`);
    };

    // A name we already know needs no research.
    if (site.sure) {
      const host = site.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      goTo(site.url);
      // Say so when the address that was heard is not the address being opened.
      // Silently "fixing" apple.co to apple.com and reporting the corrected one
      // as though it were what they said is how a wrong correction becomes
      // impossible to notice, let alone undo.
      return {
        ok: true,
        label: site.corrected ? `Opening ${host} — not ${site.corrected}` : `Opening ${host}`,
      };
    }

    // Only a guess so far. Before offering "<name>.com", ask whether this is
    // somewhere the user actually goes — "yolat" is a shot in the dark, but
    // yolat.io visited forty times is not. Being there before IS the correction.
    jcVoiceChip("thinking", `Looking up "${rawName}"…`);
    jcSendAsync({ type: "JC_VOICE_SITE_LOOKUP", query: rawName })
      .then((found) => {
        if (found && found.ok && found.host) {
          // A history hit is evidence; a model's sound-alike guess is a
          // hypothesis. Navigating away loses what the user was reading, so
          // only the evidence goes straight through — the guess has to be
          // confirmed, however confident the model sounded.
          if (found.guessed) {
            askConfirm(
              `Did you mean ${found.host}?`,
              () => goTo(`https://${found.host}`),
              `Opening ${found.host}`,
            );
            return;
          }

          // A global-ranking hit sits between the two. Inside the top thousand
          // domains on the internet, "open apple" meaning apple.com is not a
          // guess worth interrupting anyone over. Below that it is still good
          // evidence and still not proof — a real domain that merely shares a
          // spelling with what was said would land here — so it asks.
          if (found.ranked && found.tier > 0) {
            askConfirm(
              `Open ${found.host}?`,
              () => goTo(`https://${found.host}`),
              `Opening ${found.host}`,
            );
            return;
          }
          jcVoiceChip("done", `Opening ${found.host}`, null, 1400);
          goTo(`https://${found.host}`);
          return;
        }
        // Never been there. Whether that becomes an offer or a shrug is the
        // caller's call, because it depends entirely on what was asked: "open
        // yolat" can reasonably end in "open yolat.com?", while a search that
        // found nothing cannot.
        giveUp();
      })
      .catch(giveUp);

    function giveUp() {
      if (!allowGuess) {
        if (onGiveUp) onGiveUp();
        return;
      }
      // The blind .com guess, which has to be confirmed because navigating
      // away loses what they were reading.
      const host = site.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      askConfirm(`Open ${host}?`, () => goTo(site.url), `Opening ${host}`);
    }

    return { ok: true, quiet: true }; // the chip is narrating this itself
  }

  // ------------------------------------------------- searching THIS page first

  // "Search for X" said out loud, on a page, means search the page. It has
  // never meant "abandon what I am reading and go to Google", and treating it
  // that way is what made the agent feel like it wasn't looking at the screen
  // at all: asked about something on a site with a perfectly good search box,
  // it would leave, and answer from somewhere else entirely.
  //
  // So the order is: the page's OWN search box, then the rest of the site, then
  // — only if the user actually asked for the web — the web.

  const SEARCH_HINT = /(?:^|[^a-z])(?:search|find|query|keyword|lookup|look up)(?:[^a-z]|$)/i;

  // Nearly every site puts its search box behind the same handful of tells.
  // Scored rather than matched, because any one of them alone is also true of
  // things that are not search boxes — a login field is in the header too, and
  // a chat composer is a textbox with a placeholder.
  function siteSearchField() {
    let best = null;
    let bestScore = 0;

    for (const el of typableFields()) {
      let score = 0;
      const type = (el.getAttribute("type") || "").toLowerCase();
      const role = (el.getAttribute("role") || "").toLowerCase();
      if (type === "search" || role === "searchbox") score += 3;

      // ?q= is the search parameter on more of the web than every other name
      // put together.
      const name = (el.getAttribute("name") || "").toLowerCase();
      if (/^(?:q|s|query|search|keyword|term|text)$/.test(name)) score += 2;

      const described = [
        el.getAttribute("aria-label"),
        el.getAttribute("placeholder"),
        el.getAttribute("title"),
        el.id,
        typeof el.className === "string" ? el.className : "",
      ].join(" ");
      if (SEARCH_HINT.test(described)) score += 2;

      const form = el.closest("form");
      if (form) {
        if ((form.getAttribute("role") || "").toLowerCase() === "search") score += 2;
        if (SEARCH_HINT.test(form.getAttribute("action") || "")) score += 2;
      }
      if (el.closest("[role='search']")) score += 2;
      if (el.closest("header, nav")) score += 1;

      // A composer is not a search box. Both are textboxes near the top of a
      // page and confusing them means dictating a search into someone's tweet.
      if (el.tagName === "TEXTAREA" || el.isContentEditable) score -= 2;
      if (/pass(?:word|phrase)|email|e-mail|sign ?in|log ?in/i.test(described)) score -= 4;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    // Three is "two independent tells agreed". One tell on its own is a guess,
    // and typing a query into the wrong box is a visible, embarrassing failure.
    return bestScore >= 3 ? best : null;
  }

  // A friendly name for where we are, for the chip to say.
  function siteName() {
    return location.hostname.replace(/^www\./, "");
  }

  // "the SDK of this site" is asking about the SDK, not about a site called
  // "of this site" — and both the grammar and the model hand that trailer
  // through, so it gets stripped once, here.
  function searchQuery(raw) {
    return String(raw || "")
      .replace(/\s+(?:of|on|in|from)\s+(?:this\s+)?(?:site|page|website|docs)$/i, "")
      .replace(/^(?:for|about)\s+/i, "")
      .trim();
  }

  // The entry point every "search" phrasing now goes through. `after` is the
  // follow-up to run once the results are up — an explain request, usually.
  function searchHere(query, after) {
    const cleaned = searchQuery(query);
    if (!cleaned) return { ok: false, label: "What should I search for?" };

    const field = siteSearchField();
    if (!field) return searchSite(cleaned, after);

    jcVoiceChip("thinking", `Searching this page for "${cleaned}"…`);

    const before = field.isContentEditable ? field.innerText : field.value;
    setFieldValue(field, cleaned);
    flash(field);
    pushUndo("that search", () => setFieldValue(field, before || ""));

    // Results usually arrive by navigation, which destroys this script — so a
    // follow-up has to be parked somewhere the next page can find it.
    if (after) rememberPending({ ...after, explain: cleaned });

    submitInField(field);

    // ...but plenty of sites filter in place and never navigate at all. Give
    // the page a moment to leave. If it is still here, the results are already
    // on screen and the follow-up belongs to THIS page, not to a next one that
    // is never coming — which is the difference between an answer and a chip
    // that just stops.
    if (after) {
      setTimeout(() => {
        if (!takePending()) return; // navigation won the race; the next page owns it
        jcVoiceChip("done", `Found it — explaining "${cleaned}"`, null, 2000);
        explainPhrase(cleaned, after.kind || "style", after.key || "default");
      }, 1800);
    }

    return { ok: true, quiet: true }; // the chip is narrating this itself
  }

  // --------------------------------------------------- searching the whole site

  // "Where do they talk about the SDK?" asked from a landing page that never
  // says "SDK". The answer is on another page, so this fetches the site's own
  // pages and reads them.
  //
  // Same-origin only, and that is a hard line, not a limitation to fix later:
  // reading other origins would need blanket host permissions this extension
  // deliberately never asks for. It also needs no API key — fetching and word
  // counting are free, so this works on the offline/keyless tier. Only the
  // explanation waiting at the other end wants a model.
  const CRAWL_MAX = 8; // pages actually fetched
  const CRAWL_TIMEOUT = 4000;

  function sameOriginLinks() {
    const seen = new Map();
    for (const el of document.querySelectorAll("a[href]")) {
      let url;
      try {
        url = new URL(el.getAttribute("href"), location.href);
      } catch (_) {
        continue;
      }
      if (url.origin !== location.origin) continue;
      if (url.pathname === location.pathname) continue;
      if (/\.(?:png|jpe?g|gif|svg|webp|pdf|zip|mp4|webm|css|js|xml|json)$/i.test(url.pathname)) continue;
      url.hash = "";
      if (!seen.has(url.href)) seen.set(url.href, (el.innerText || "").trim().slice(0, 80));
    }
    return Array.from(seen, ([href, label]) => ({ href, label }));
  }

  // Cheap pre-rank so only the most promising pages get fetched. A URL is a
  // surprisingly good summary of its page — /docs/sdk/getting-started says
  // most of what matters before a single byte is downloaded.
  function scoreUrl(candidate, want) {
    const slug = candidate.href.slice(location.origin.length).replace(/[/_.\-]+/g, " ");
    const have = new Set([...tokens(slug), ...tokens(candidate.label)]);
    let hits = 0;
    for (const word of want) if (have.has(word)) hits++;
    return hits / want.length;
  }

  async function fetchPageText(href) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CRAWL_TIMEOUT);
    try {
      const response = await fetch(href, { signal: controller.signal, credentials: "same-origin" });
      if (!response.ok) return null;
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("script, style, noscript, svg, template").forEach((n) => n.remove());
      // textContent, not innerText: a parsed document has no layout attached,
      // so innerText comes back empty.
      return (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
    } catch (_) {
      return null; // aborted, offline, blocked by CSP — all the same to us
    } finally {
      clearTimeout(timer);
    }
  }

  async function findAcrossSite(query) {
    const want = tokens(query);
    if (!want.length) return null;

    const candidates = sameOriginLinks()
      .map((c) => ({ ...c, pre: scoreUrl(c, want) }))
      .sort((a, b) => b.pre - a.pre)
      .slice(0, CRAWL_MAX);
    if (!candidates.length) return null;

    // In parallel: eight small fetches take about as long as the slowest one.
    const pages = await Promise.all(
      candidates.map(async (candidate) => {
        const text = await fetchPageText(candidate.href);
        if (!text) return null;
        const have = new Set(tokens(text));
        let hits = 0;
        for (const word of want) if (have.has(word)) hits++;
        // What the page SAYS decides; the URL hint only breaks ties.
        return { ...candidate, score: hits / want.length + candidate.pre * 0.25 };
      }),
    );

    const best = pages.filter(Boolean).sort((a, b) => b.score - a.score)[0];
    return best && best.score >= 0.5 ? best : null;
  }

  // Navigating destroys this content script, so a follow-up has to survive the
  // trip. sessionStorage is per-origin and per-tab — exactly the scope of
  // "finish what I asked, on the next page".
  const PENDING_KEY = "jcVoicePendingAction";

  function rememberPending(action) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(action));
    } catch (_) {}
  }

  // Read-and-clear: whoever takes it owns it, so an in-page search and the
  // next page's resume can never both answer the same question.
  function takePending() {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(PENDING_KEY);
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  // `after` decides what happens on arrival: null just goes there, an explain
  // request carries the original question across the navigation.
  function searchSite(query, after) {
    const cleaned = searchQuery(query);
    // Not "this page" — this one reads the site's OTHER pages, and saying
    // otherwise while eight fetches are in flight is a small lie the user can
    // see through the moment the URL changes.
    jcVoiceChip("thinking", `Searching ${siteName()} for "${cleaned}"…`);

    findAcrossSite(cleaned)
      .then((hit) => {
        if (hit) {
          if (after) rememberPending({ ...after, explain: cleaned });
          location.href = hit.href;
          return;
        }

        // Nowhere on this site. Two readings left, and which one gets offered
        // depends entirely on whether what they said could BE a site.
        //
        // A name we know, or a real address they spoke in full, is worth
        // offering. A bare word that merely survived the "could be a brand"
        // filter is not: "search this site for onboarding" has to end in "I
        // couldn't find it", never in "open onboarding.com?" — that guess is
        // the thing that made every miss feel like the agent had wandered off
        // the page.
        const site = resolveSite(cleaned);

        // The web is the honest last resort — offered out loud, because leaving
        // the page they were reading is exactly the thing they did not ask for.
        const offerWeb = () =>
          askConfirm(
            `Not on ${siteName()} — search the web for "${cleaned}"?`,
            () => webSearch(cleaned),
            `Searching the web for "${cleaned}"`,
          );

        if (site && !site.bare) {
          const host = site.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
          askConfirm(
            `Not on this site — open ${host}?`,
            () => openInNewTab(site.url, `Opening ${host}`),
            `Opening ${host}`,
          );
          return;
        }

        // A bare word still gets ONE more reading — that it names a site they
        // actually visit. History can answer that; a .com guess cannot, so the
        // guess is switched off and the miss falls through to the web offer.
        if (site && site.bare) {
          openSite(cleaned, { allowGuess: false, onGiveUp: offerWeb });
          return;
        }

        offerWeb();
      })
      .catch(() => {
        jcVoiceChip("error", "I couldn't search this site.", null, 2600);
      });

    return { ok: true, quiet: true }; // the chip is narrating this itself
  }

  function searchSiteAndExplain(query, kind = "style", key = "default") {
    return searchHere(query, { kind, key });
  }

  // Runs on the page we just landed on, picking the request back up.
  function resumePending() {
    const action = takePending();
    if (!action || !action.explain) return;

    // Let the page paint before hunting for text inside it — on a framework
    // site the body is often still empty at this point.
    setTimeout(() => {
      jcVoiceChip("done", `Found it — explaining "${action.explain}"`, null, 2200);
      explainPhrase(action.explain, action.kind || "style", action.key || "default");
    }, 900);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", resumePending, { once: true });
  } else {
    resumePending();
  }

  function webSearch(query) {
    const url = "https://www.google.com/search?q=" + encodeURIComponent(query);
    return openInNewTab(url, `Searching for "${query}"`);
  }

  // ------------------------------------------------------------ confirmation

  // A pending question, answerable by saying yes/no on the next hold or by
  // clicking the chip. Voice misrecognition makes silent navigation hostile —
  // anything that leaves the page the user is reading has to be cheap to refuse.
  let pending = null;
  let pendingTimer = null;

  // An unanswered question has to expire. The confirm chip was shown with no
  // dismissal time, and its dot pulses exactly like the "thinking" one — so an
  // ignored Yes/No looked identical to a hang, and stayed on screen forever.
  const CONFIRM_TTL_MS = 25_000;

  function askConfirm(question, onYes, confirmedLabel) {
    clearTimeout(pendingTimer);
    pending = { onYes, confirmedLabel: confirmedLabel || "Done" };
    jcVoiceChip("confirm", question, [
      { label: "Yes", run: () => resolveConfirm(true) },
      { label: "No", run: () => resolveConfirm(false) },
    ]);
    pendingTimer = setTimeout(() => {
      if (!pending) return;
      pending = null;
      jcVoiceChip("unknown", "Left that one alone.", null, 1600);
    }, CONFIRM_TTL_MS);
    return { ok: true, quiet: true }; // the chip is already saying everything
  }

  function resolveConfirm(yes) {
    clearTimeout(pendingTimer);
    const held = pending;
    pending = null;
    if (!held) return { ok: false, label: "There's nothing to confirm." };
    if (!yes) return { ok: true, label: "Cancelled" };
    held.onYes();
    return { ok: true, label: held.confirmedLabel };
  }

  const YES = /^(?:yes|yeah|yep|yup|sure|ok|okay|do it|go|go ahead|confirm|correct|right|that'?s right)$/;
  const NO = /^(?:no|nope|nah|cancel|stop|don'?t|never mind|nevermind|wrong)$/;

  // ------------------------------------------- finding a spoken phrase on page

  // Speech says "front end engineer at yolat"; the page says "Front-End
  // Engineer at Yolat". Case, hyphens, slashes, curly quotes and runs of
  // whitespace all have to stop mattering before those two can ever meet.
  function normalizeChar(ch) {
    const lower = ch.toLowerCase();
    if (/[‘’]/.test(lower)) return "'";
    if (/[a-z0-9' ]/.test(lower)) return lower;
    return " "; // hyphens, punctuation, newlines — all become separators
  }

  // Optimal string alignment, capped — only ever asked "within a slip or two?".
  function wordDistance(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 99;
    const rows = a.length + 1;
    const cols = b.length + 1;
    const d = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let i = 0; i < rows; i++) d[i][0] = i;
    for (let j = 0; j < cols; j++) d[0][j] = j;
    for (let i = 1; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }

  function wordsClose(a, b) {
    if (a === b) return true;
    if (a.length < 4 || b.length < 4) return false;
    if (a[0] !== b[0]) return false;
    return wordDistance(a, b) <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 4));
  }

  // Walks the page's text nodes once, building a normalized haystack alongside
  // a map back to (node, offset) so a hit can become a real DOM Range — which
  // is what lets the existing highlight pipeline explain it with full context.
  // `root` scopes the walk: passing a block searches inside it only, which is
  // how a paragraph gets narrowed down to the sentence that was actually said.
  function findTextRange(phrase, root) {
    const want = Array.from(String(phrase))
      .map(normalizeChar)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (want.length < 3) return null;

    const scope = root && root.nodeType === Node.ELEMENT_NODE ? root : document.body;
    if (!scope) return null;

    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest("script, style, noscript, #ambient-popup, #jc-ambient-panel, #jc-voice-chip")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let haystack = "";
    const map = []; // map[i] -> where normalized character i came from
    let node;
    while ((node = walker.nextNode())) {
      const raw = node.nodeValue;
      for (let i = 0; i < raw.length; i++) {
        const ch = normalizeChar(raw[i]);
        // Collapse whitespace runs, including across node boundaries, so markup
        // splitting a phrase mid-sentence doesn't hide it.
        if (ch === " " && (!haystack || haystack.endsWith(" "))) continue;
        haystack += ch;
        map.push({ node, offset: i });
      }
      // A block boundary is a word boundary; without this "…Engineer</p><p>At…"
      // would read as "engineerat".
      if (haystack && !haystack.endsWith(" ")) {
        haystack += " ";
        map.push(null);
      }
    }

    let at = haystack.indexOf(want);
    let matchLength = want.length;
    let matchScore = at >= 0 ? 1 : 0;

    // Exact match failed. One misheard word in an otherwise correct phrase is
    // the normal case — "I'm a front end engineer at Yolat" coming back with
    // the company name mangled — and it should still find the sentence rather
    // than fall all the way through to a whole-block guess. So: slide the
    // spoken words along the page's words and take the best-aligned run.
    if (at < 0) {
      // Spoken compounds drift: "front end" ⇄ "frontend". Try the utterance
      // as heard, plus every variant with one adjacent pair merged — cheap
      // (≤ word-count variants) and it catches the common case without a
      // dictionary.
      const heardWords = want.split(" ").filter(Boolean);
      const variants = [heardWords];
      for (let i = 0; i + 1 < heardWords.length; i++) {
        const merged = heardWords.slice();
        merged.splice(i, 2, heardWords[i] + heardWords[i + 1]);
        variants.push(merged);
      }
      const wantWords = heardWords;
      if (wantWords.length >= 3) {
        const pageWords = [];
        const wordRe = /[a-z0-9']+/g;
        let m;
        while ((m = wordRe.exec(haystack))) {
          pageWords.push({ word: m[0], start: m.index, end: m.index + m[0].length });
        }

        let bestScore = 0;
        let best = null;
        for (const attempt of variants) {
          for (let i = 0; i + attempt.length <= pageWords.length; i++) {
            let hits = 0;
            for (let k = 0; k < attempt.length; k++) {
              if (wordsClose(pageWords[i + k].word, attempt[k])) hits++;
            }
            const score = hits / attempt.length;
            if (score > bestScore) {
              bestScore = score;
              best = { from: pageWords[i].start, to: pageWords[i + attempt.length - 1].end };
            }
          }
        }

        // Two thirds of the words landing in order is a sentence, not a
        // coincidence. Below that, let the caller fall through to its own
        // block-level search instead of highlighting something wrong.
        if (best && bestScore >= 0.66) {
          at = best.from;
          matchLength = best.to - best.from;
          matchScore = bestScore;
        }
      }
    }
    if (at < 0) return null;

    const start = map[at];
    // Walk back off any padding entry so the end anchor is a real text node.
    let endIndex = at + matchLength - 1;
    while (endIndex > at && !map[endIndex]) endIndex--;
    const end = map[endIndex];
    if (!start || !end) return null;

    try {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset + 1);
      range.jcScore = matchScore; // ride-along, read by jcGroundOnPage
      return range;
    } catch (_) {
      return null;
    }
  }

  // The grounding half of joint decoding: "how well does this utterance match
  // something actually on screen?" voice.js calls this for every recogniser
  // alternative and lets the best (candidate, place) pair win — the screen is
  // the answer key, not the transcript.
  function jcGroundOnPage(phrase) {
    const cleaned = String(phrase || "").replace(/^["'\u201c\u2018]|["'\u201d\u2019]$/g, "").trim();
    if (cleaned.split(/\s+/).length < 2) return null; // one word grounds everywhere
    const range = findTextRange(cleaned);
    if (!range) return null;
    return { range, score: range.jcScore ?? 0.66, text: range.toString().trim() };
  }

  // "What does he mean by 'front end engineer at yolat'" — the user named the
  // target out loud instead of highlighting it. Find it, select it, and hand it
  // to the ordinary explain path so it arrives with its surrounding context.
  // "What is this site about" is not a phrase to look up — it is a question
  // about the page as a whole, and the only honest source for the answer is
  // the page's own text. Hand the main content to the same explain pipeline a
  // highlight uses; attachQuestion carries the actual spoken words, so the
  // model answers the question rather than summarising blindly.
  function pageOverview(question) {
    const main = document.querySelector("article, main") || document.body;
    const text = (main.innerText || "").replace(/\s+/g, " ").trim().slice(0, 6000);
    if (!text) return { ok: false, label: "There's nothing on this page to go on yet." };
    return runOnText(text, "style", "default", "Reading the page…", question || jcUtterance);
  }

  function explainPhrase(phrase, kind = "style", key = "default", question) {
    const cleaned = String(phrase).replace(/^["'“‘]|["'”’]$/g, "").trim();
    if (!cleaned) return { ok: false, label: "What would you like me to explain?" };

    // "Explain this site", "what does this page mean": the phrase names the
    // page itself, so grounding it as literal text would find nothing — or
    // worse, some stray paragraph containing the word "site".
    if (/^(?:this|the|that) (?:whole )?(?:site|page|website|web ?page|article|app)\b/.test(cleaned.toLowerCase())) {
      return pageOverview(question);
    }

    const range = findTextRange(cleaned);
    if (range) return jcExplainRange(range, range.toString().trim(), kind, key, question);

    // Not literally on the page — it may have been misheard, or paraphrased, or
    // said in the video rather than written. Fall back to the best-matching
    // block so the question still gets a grounded answer.
    const want = tokens(cleaned);
    const block = want.length ? bestBlock(want) : { block: null, score: 0 };
    if (block.block && block.score >= 0.4) {
      // The block is where the answer LIVES; it is not what was said. Selecting
      // a whole paragraph for a six-word phrase is the thing this narrowing
      // exists to stop — take the sentence inside it that best matches, and let
      // dataForRange pull the paragraph back in as context rather than as
      // highlight.
      const tight = narrowToPhrase(block.block.el, want);
      if (tight) return jcExplainRange(tight.range, tight.text, kind, key, question);

      block.block.el.scrollIntoView({ behavior: "smooth", block: "center" });
      flash(block.block.el);
      return runOnTarget(
        { kind: "found", range: rangeOfElement(block.block.el), text: block.block.text },
        kind,
        key,
        question,
      );
    }

    // Nothing on THIS page. It is very likely on another page of the same site
    // — "where do they talk about the SDK", asked from the landing page. Go and
    // read the site rather than answering from nothing.
    if (sameOriginLinks().length) return searchSiteAndExplain(cleaned, kind, key);

    // Nowhere left to look — answer the question on its own terms.
    return runOnText(cleaned, kind, key, `Explaining "${cleaned}"`, question);
  }

  // Select exactly the words that were heard and explain them. The selection is
  // the phrase; the passage around it still reaches the model, because
  // dataForRange climbs to a block for its context window. Highlight and
  // context were the same thing before this split, which is why asking about
  // one sentence lit up the whole paragraph.
  function jcExplainRange(range, text, kind = "style", key = "default", question) {
    if (!range) return { ok: false, label: "I couldn't find that on the page." };
    scrollRangeIntoView(range);
    flashRange(range);
    return runOnTarget(
      { kind: "found", range, text: text || range.toString().trim() },
      kind,
      key,
      question,
    );
  }

  // Inside a block that matched topically, find the SENTENCE that matched. Only
  // used when the utterance wasn't literally on the page, so there is no exact
  // range to fall back on — but a sentence is still far closer to what the
  // person said than the paragraph holding it.
  function narrowToPhrase(el, want) {
    const text = (el.innerText || "").trim();
    if (text.length < 120) return null; // already about as tight as it gets

    const pieces = text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 20);
    if (pieces.length < 2) return null;

    let best = null;
    let bestScore = 0;
    for (const piece of pieces) {
      const have = new Set(tokens(piece));
      let hits = 0;
      for (const word of want) if (have.has(word)) hits++;
      const score = hits / want.length;
      if (score > bestScore) {
        bestScore = score;
        best = piece;
      }
    }
    // Below this the sentence isn't a better answer than the block, and picking
    // one anyway would point confidently at the wrong line.
    if (!best || bestScore < 0.4) return null;

    const range = findTextRange(best, el);
    return range ? { range, text: range.toString().trim() } : null;
  }

  // A brief ring rather than a persistent highlight: it answers "did it move to
  // the right place?" and then gets out of the way.
  function flash(el) {
    el.classList.add("jc-voice-flash");
    setTimeout(() => el.classList.remove("jc-voice-flash"), 1400);
  }

  // Same job as flash(), traced around the WORDS THAT WERE HEARD instead of the
  // block they happen to live in. Ringing a whole paragraph for a six-word
  // phrase reads as "all of this is what you said", which is both wrong and the
  // reason the surrounding context looked like part of the answer.
  //
  // Boxes are placed in DOCUMENT coordinates, so the smooth scroll that usually
  // runs at the same time slides the page underneath them without dragging them
  // out of position.
  function flashRange(range) {
    let rects = [];
    try {
      rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    } catch (_) {}

    if (!rects.length) {
      // A collapsed or detached range has nothing to trace — fall back to the
      // element ring rather than showing no confirmation at all.
      const holder = range.startContainer && range.startContainer.parentElement;
      if (holder) flash(holder);
      return;
    }

    const host = document.body || document.documentElement;
    // An absolutely positioned child resolves against the nearest POSITIONED
    // ancestor. A page that positions its own <body> would otherwise shift
    // every box by that element's offset.
    let hostBox = null;
    try {
      if (getComputedStyle(host).position !== "static") hostBox = host.getBoundingClientRect();
    } catch (_) {}
    const originX = hostBox ? hostBox.left : -window.scrollX;
    const originY = hostBox ? hostBox.top : -window.scrollY;

    const layer = document.createElement("div");
    layer.className = "jc-voice-trace";
    for (const rect of rects) {
      const box = document.createElement("div");
      box.className = "jc-voice-trace-box";
      box.style.left = `${Math.round(rect.left - originX) - 2}px`;
      box.style.top = `${Math.round(rect.top - originY) - 2}px`;
      box.style.width = `${Math.round(rect.width) + 4}px`;
      box.style.height = `${Math.round(rect.height) + 4}px`;
      layer.appendChild(box);
    }
    host.appendChild(layer);
    setTimeout(() => layer.remove(), 1600);
  }

  // -------------------------------------------------- clicking what you see

  // "Follow this person." If it is on screen it is in the DOM, so the extension
  // can reach it — the only real question is WHICH one, because a timeline has
  // forty Follow buttons and they all have the same label.
  //
  // The cursor answers it. Where you are pointing is what "this" means, so
  // proximity is a first-class term in the score rather than a tiebreak.

  // Words that name the target by pointing rather than by label. They must be
  // stripped before matching ("follow this person" has to match a button that
  // just says "Follow") and their presence is what turns the cursor from a
  // hint into the deciding factor.
  const DEICTIC = /\b(this|that|the|these|those|here|there|one|person|guy|user|account|profile|button|link|it|him|her|them|for me)\b/gi;

  function accessibleName(el) {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const referenced = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => (node.innerText || "").trim())
        .join(" ")
        .trim();
      if (referenced) return referenced;
    }

    const text = (el.innerText || "").trim();
    if (text) return text.slice(0, 80);

    const title = (el.getAttribute("title") || "").trim();
    if (title) return title;

    // A field's value is a last-resort name, and for the fields autofill loves
    // most it must not be one at all: an unlabeled card-number input would
    // otherwise introduce itself to the model BY the card number.
    if (typeof el.value === "string" && el.value.trim()) {
      if (isSensitiveField(el)) return "[value redacted]";
      return el.value.trim().slice(0, 60);
    }

    const img = el.querySelector("img[alt]");
    if (img) return (img.getAttribute("alt") || "").trim();

    return "";
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    // Off-screen is not "what you see", and a timeline keeps hundreds of
    // identical buttons mounted above and below the viewport.
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }

  // Everything a person would call clickable. The old list was `button,
  // a[href], [role=button|link|menuitem], input[type=submit|button], summary,
  // [onclick]` — which misses an uncomfortable amount of the modern web:
  //   - `<a>` with no href: how most SPA routers render their links
  //   - tabs, options, checkboxes, switches, radios, tree items
  //   - `<label>`: the standard way to build a styled checkbox
  //   - `[tabindex]`: any custom control built to be keyboard reachable
  //   - React `onClick` on a div — React attaches ONE listener at the root, so
  //     there is no `onclick` attribute to match and `[onclick]` never sees it
  // and it never crossed a shadow boundary, so design systems built on custom
  // elements were invisible in their entirety.
  const CLICKABLE_SELECTOR =
    "button, a, [role='button'], [role='link'], [role='menuitem'], " +
    "[role='menuitemcheckbox'], [role='menuitemradio'], [role='tab'], " +
    "[role='option'], [role='checkbox'], [role='radio'], [role='switch'], " +
    "[role='treeitem'], input[type='submit'], input[type='button'], " +
    "input[type='reset'], input[type='image'], input[type='checkbox'], " +
    "input[type='radio'], summary, label, [onclick], [tabindex]";

  // document.querySelectorAll stops dead at a shadow boundary, so walk into
  // every OPEN root as well. Closed roots stay unreachable by design and there
  // is nothing to be done about those.
  function queryDeep(root, selector, sink, depth) {
    if (depth > 8 || sink.length > 4000) return sink;
    try {
      for (const el of root.querySelectorAll(selector)) sink.push(el);
    } catch (_) {}
    try {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) queryDeep(el.shadowRoot, selector, sink, depth + 1);
      }
    } catch (_) {}
    return sink;
  }

  function clickables() {
    const found = [];
    const seen = new Set();
    for (const el of queryDeep(document, CLICKABLE_SELECTOR, [], 0)) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.closest("#ambient-popup, #jc-ambient-panel, #jc-voice-chip")) continue;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      if (!isVisible(el)) continue;
      // A control the page has switched off is not a target, however it looks.
      if (getComputedStyle(el).pointerEvents === "none") continue;
      const name = accessibleName(el);
      if (!name) continue;
      found.push({ el, name });
    }
    return found;
  }

  // 0 at the cursor, 1 at the far corner of the viewport.
  function cursorDistance(el) {
    const rect = el.getBoundingClientRect();
    const x = typeof lastMouseX === "number" ? lastMouseX : window.innerWidth / 2;
    const y = typeof lastMouseY === "number" ? lastMouseY : window.innerHeight / 2;
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    const diagonal = Math.hypot(window.innerWidth, window.innerHeight);
    return Math.min(1, Math.hypot(dx, dy) / diagonal);
  }

  // Labels where a wrong click costs money, sends something, or ends a
  // session. "Follow" and "like" stay instant — confirming those every time
  // would make voice worse than the mouse — but anything on this list gets a
  // Yes/No first, because a misheard phrase pressing Buy is unrecoverable.
  // Tier one: money, deletion, or the end of a session. Always confirmed, no
  // matter how clearly the phrase was heard — the cost of being wrong here is
  // not proportional to how confident anyone felt.
  const DESTRUCTIVE_LABEL =
    /\b(buy|pay|purchase|order|checkout|check out|place order|delete|remove|transfer|deactivate|unsubscribe|sign out|log ?out)\b/i;

  // Tier two: hard to take back, but also the label on every search box, login
  // form and chat composer on the web. Confirming these unconditionally is what
  // made JustClarify ask "Click Send?" after the user had just SAID "click
  // send" — friction with nothing at stake, and the complaint that followed.
  //
  // The confirmation exists because speech gets misheard, so it is asked only
  // when the match was in fact doubtful. Say it clearly and it just happens;
  // land here on a fuzzy match or a model's guess and it still asks first.
  const SENSITIVE_LABEL = /\b(send|submit|post|publish|confirm)\b/i;
  const CLICK_SURE = 0.75;

  // A real press, not a bare .click(). Frameworks that open on press rather
  // than release — Radix, Headless UI, MUI menus, anything drag-aware — listen
  // for pointerdown/mousedown and never saw the old synthetic click at all.
  // That is why "it just doesn't click" was site-specific rather than random.
  function pressElement(el) {
    const rect = el.getBoundingClientRect();
    const shared = {
      bubbles: true,
      cancelable: true,
      composed: true, // must cross the shadow boundary it may live behind
      view: window,
      button: 0,
      buttons: 1,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    const fire = (Ctor, type, extra) => {
      try { el.dispatchEvent(new Ctor(type, { ...shared, ...extra })); } catch (_) {}
    };

    try { el.focus({ preventScroll: true }); } catch (_) {}
    fire(PointerEvent, "pointerover", { buttons: 0 });
    fire(MouseEvent, "mouseover", { buttons: 0 });
    fire(PointerEvent, "pointerdown");
    fire(MouseEvent, "mousedown");
    fire(PointerEvent, "pointerup", { buttons: 0 });
    fire(MouseEvent, "mouseup", { buttons: 0 });
    // Still send the plain click last: the sequence above does NOT synthesise
    // one, and a plain <a> or <button> needs it to do its default thing.
    try { el.click(); } catch (_) {}
  }

  // The single gate every click goes through — by description or by model ref.
  // Judged on the ELEMENT's label, not the spoken phrase: what the button says
  // is the truth about what clicking it does.
  // `certainty` is how well the spoken phrase matched this element's own label,
  // 0..1. A model-chosen ref passes 0: it never heard the user at all.
  function performClick(el, certainty) {
    const name = accessibleName(el).slice(0, 40);
    const sure = typeof certainty === "number" ? certainty : 0;
    const doIt = () => {
      // `instant`, not `smooth`: the press fires on the very next line, and an
      // animating scroll means it lands while the element is still moving.
      try {
        el.scrollIntoView({ behavior: "instant", block: "center" });
      } catch (_) {
        el.scrollIntoView({ block: "center" });
      }
      flash(el);
      pressElement(el);
    };
    const mustAsk =
      DESTRUCTIVE_LABEL.test(name) || (SENSITIVE_LABEL.test(name) && sure < CLICK_SURE);
    if (mustAsk) {
      return askConfirm(`Click \u201c${name}\u201d?`, doIt, `Clicked \u201c${name}\u201d`);
    }
    doIt();
    return { ok: true, label: `Clicked \u201c${name}\u201d` };
  }

  function clickByDescription(raw) {
    const spoken = String(raw || "").trim();
    // "this"/"here" mean the cursor is the point of the sentence, so weight it
    // far more heavily than when a target is named outright ("click checkout").
    const pointing = /\b(this|that|here|there|it|him|her|them)\b/i.test(spoken);
    const label = spoken.replace(DEICTIC, " ").replace(/\s+/g, " ").trim();
    const want = tokens(label || spoken);
    if (!want.length) return { ok: false, label: "I'm not sure what to click." };

    let best = null;
    let bestScore = 0;

    for (const candidate of clickables()) {
      const haveList = tokens(candidate.name);
      const have = new Set(haveList);
      let hits = 0;
      for (const word of want) {
        if (have.has(word)) hits++;
        // Speech mangles words the page spells correctly, and exact token
        // equality threw those away. wordsClose() already exists for the
        // highlighting path; the click path was simply never given it.
        else if (
          typeof wordsClose === "function" &&
          haveList.some((h) => wordsClose(word, h))
        ) hits += 0.85;
      }
      if (!hits) continue;

      let score = hits / want.length;
      // An exact, short label is the real button; a paragraph that happens to
      // contain the word is a link inside prose. The penalty used to be linear,
      // which was brutal: saying "checkout" at a button reading "Proceed to
      // secure checkout" scored a third of the way down and got rejected even
      // though it was exactly right. sqrt still prefers the tight label without
      // throwing away the correct verbose one.
      const nameTokens = haveList.length || 1;
      score *= Math.sqrt(want.length / Math.max(want.length, nameTokens));
      // A label that IS what they said beats every partial match outright.
      if (nameTokens === want.length && hits >= want.length) score *= 1.15;
      // Proximity. Dominant when they pointed, still a gentle nudge when not.
      const near = 1 - cursorDistance(candidate.el);
      score *= pointing ? 0.25 + 0.75 * near : 0.8 + 0.2 * near;

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (!best || bestScore < 0.3) {
      return { ok: false, label: `I can't find anything to click called "${label || spoken}".` };
    }

    // Clicking can be irreversible in ways scrolling never is: no undo is
    // pushed, and destructive labels confirm first inside performClick.
    return performClick(best.el, bestScore);
  }

  // ------------------------------------------------------------ typing

  // Adapted from what Claude's browser tooling does: typing is its own verb,
  // separate from clicking, because "put my email in there" is a different act
  // from pressing a button and fails in different ways.
  function typableFields() {
    const found = [];
    const selector =
      "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox])" +
      ":not([type=radio]), textarea, [contenteditable='true'], [role='textbox'], [role='searchbox']";
    for (const el of document.querySelectorAll(selector)) {
      if (el.closest("#ambient-popup, #jc-ambient-panel, #jc-voice-chip")) continue;
      if (el.disabled || el.readOnly) continue;
      if (!isVisible(el)) continue;
      found.push(el);
    }
    return found;
  }

  function fieldLabel(el) {
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      (el.labels && el.labels[0] && el.labels[0].innerText) ||
      el.getAttribute("type") ||
      "field"
    ).trim();
  }

  // Frameworks listen for `input`, not for assignment. Setting .value directly
  // updates the DOM and leaves React's state untouched, so the text appears and
  // then vanishes on the next render — hence the native setter plus the event.
  function setFieldValue(el, text) {
    if (el.isContentEditable) {
      el.focus();
      document.execCommand("insertText", false, text);
      return;
    }
    const prototype = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    el.focus();
    if (setter) setter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function typeText(text) {
    const value = String(text || "").trim();
    if (!value) return { ok: false, label: "What would you like me to type?" };

    // Whatever is focused wins — the user put the caret there deliberately.
    const active = document.activeElement;
    let target =
      active && typableFields().includes(active) ? active : null;

    // Otherwise the field nearest the cursor, same rule as clicking: where you
    // are pointing is what "there" means.
    if (!target) {
      const fields = typableFields();
      if (!fields.length) return { ok: false, label: "I can't find a text box on this page." };
      target = fields.sort((a, b) => cursorDistance(a) - cursorDistance(b))[0];
    }

    const before = target.isContentEditable ? target.innerText : target.value;
    setFieldValue(target, value);
    flash(target);
    pushUndo("that typing", () => setFieldValue(target, before || ""));
    return { ok: true, label: `Typed into ${fieldLabel(target)}` };
  }

  // Press Enter in one specific field. Split out from submitField so the page's
  // own search box can be submitted without going back through "find whichever
  // box is nearest the cursor" — searchHere already knows exactly which one.
  function submitInField(field) {
    if (!field) return false;
    field.focus();
    const enter = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
    field.dispatchEvent(new KeyboardEvent("keydown", enter));
    field.dispatchEvent(new KeyboardEvent("keyup", enter));
    if (field.form) {
      try { field.form.requestSubmit(); } catch (_) {}
    }
    return true;
  }

  // Submitting is deliberately separate from typing, so dictating text can
  // never accidentally send it.
  function submitField() {
    const active = document.activeElement;
    const field = active && typableFields().includes(active)
      ? active
      : typableFields().sort((a, b) => cursorDistance(a) - cursorDistance(b))[0];
    if (!field) return { ok: false, label: "I can't find a text box to submit." };
    submitInField(field);
    return { ok: true, label: "Submitted" };
  }

  // ------------------------------------------------------------------ media

  // Voice and video go together: hands are busy, that is the whole point.
  // "Pause" beats hunting for a player's control bar every time.
  function primaryMedia() {
    const all = Array.from(document.querySelectorAll("video, audio")).filter(
      (el) => el.currentSrc || el.src || el.readyState > 0,
    );
    if (!all.length) return null;
    // Something already playing is what "it" means; otherwise the biggest
    // player on the page, which on any video site is the main one.
    const playing = all.find((el) => !el.paused && !el.ended);
    if (playing) return playing;
    return all.sort(
      (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
    )[0];
  }

  function withMedia(run, label) {
    const media = primaryMedia();
    if (!media) return { ok: false, label: "I can't find anything playing here." };
    try {
      run(media);
    } catch (_) {
      return { ok: false, label: "That player wouldn't take the command." };
    }
    return { ok: true, label };
  }

  // --------------------------------------------------------------- clipboard

  async function copyText(text, label) {
    const value = String(text || "").trim();
    if (!value) return { ok: false, label: "There's nothing to copy." };
    try {
      await navigator.clipboard.writeText(value);
      return { ok: true, label };
    } catch (_) {
      // Clipboard API needs focus and permission; the old path usually works
      // where it doesn't.
      try {
        const scratch = document.createElement("textarea");
        scratch.value = value;
        scratch.style.cssText = "position:fixed;opacity:0;pointer-events:none";
        document.body.appendChild(scratch);
        scratch.select();
        document.execCommand("copy");
        scratch.remove();
        return { ok: true, label };
      } catch (_) {
        return { ok: false, label: "This page won't let me use the clipboard." };
      }
    }
  }

  function copySelectionOrTarget() {
    const target = jcResolveTarget();
    const text = target?.text || "";
    copyText(text, "Copied");
    return { ok: true, quiet: true };
  }

  // ------------------------------------------------------------------- tabs

  // Content scripts have no chrome.tabs; background.js owns these.
  // Going somewhere ELSE opens a TAB, it does not overwrite the page you are on.
  // location.href threw away whatever you were reading — a spoken "open GitHub"
  // cost you your place and left Back as the only route home. A new tab beside
  // the current one keeps both, and undo closes it rather than walking history
  // backwards through a navigation that no longer happened here.
  function openInNewTab(url, label) {
    jcSendAsync({ type: "JC_VOICE_TAB", action: "open", url })
      .then((res) => {
        if (res && res.ok && res.tabId != null) {
          pushUndo("that tab", () =>
            jcSendAsync({ type: "JC_VOICE_TAB", action: "closeTabId", tabId: res.tabId }),
          );
        }
      })
      .catch(() => {});
    return { ok: true, label };
  }

  function tabCommand(action, label) {
    try {
      jcSendAsync({ type: "JC_VOICE_TAB", action }).catch(() => {});
    } catch (_) {
      return { ok: false, label: "I couldn't reach the extension." };
    }
    return { ok: true, label };
  }

  // ---------------------------------------------------------------- grammar

  // Ordered — the first pattern that matches wins, so specific phrasings sit
  // above the general ones they'd otherwise be swallowed by.
  const GRAMMAR = [
    // -- meta, first: these must survive even when everything else misfires
    { re: /^(?:undo|undo that|nevermind|never mind|go back on that)$/, run: () => jcVoiceUndo() },
    { re: /^(?:stop|stop reading|stop scrolling|shut up|quiet|be quiet|cancel|enough)$/, run: () => {
        // One word, everything it could plausibly mean: stop talking AND stop
        // moving. Asking which one they meant would be absurd.
        jcVoiceStopSpeaking();
        autoScrollStop(null);
        return { ok: true, label: "Stopped" };
      } },

    // -- reading aloud
    { re: /^(?:read|read it|read this|read that)(?: to me| out loud| aloud)?$/, run: () => {
        const target = jcResolveTarget();
        if (!target?.text) return { ok: false, label: "There's nothing here to read." };
        speak(target.text);
        pushUndo("reading", jcVoiceStopSpeaking);
        return { ok: true, label: "Reading" };
      } },
    { re: /^read (?:the )?(?:page|article|whole thing)$/, run: () => {
        const main = document.querySelector("article, main") || document.body;
        speak((main.innerText || "").slice(0, 20000));
        pushUndo("reading", jcVoiceStopSpeaking);
        return { ok: true, label: "Reading the page" };
      } },

    // -- semantic jump. Sits above plain scrolling so "go to the pricing bit"
    //    isn't read as a scroll. The negative lookahead is what stops the
    //    reverse mistake: "go to the top" shares this rule's opening words but
    //    means the edge of the page, not a search for the word "top".
    // The lookahead has to sit BEFORE the optional "the", not after it: placed
    // after, the engine simply backtracks the article into the capture group
    // and "go to the top" matches anyway as a search for "the top".
    { re: /^(?:take me to|go to|jump to|find|show me|scroll to|open|where (?:does it|do they) (?:talk about|mention|say about))(?!\s+(?:the\s+)?(?:top|bottom|beginning|start|end)$)(?: the)? (.+)$/,
      run: (m) => goToDestination(m[1]) },

    // -- search. The site-scoped forms must precede the generic one, or
    //    "search this site for X" becomes a web search for "this site for X".
    // A spoken "search if they have X" means the site already in front of the
    // reader. Do not turn it into Google just because they didn't say "site".
    { re: /^(?:search|check|see|look) (?:if|whether) (?:(?:this (?:site|page|website))|(?:they|it)) (?:has|have|mentions?|contains?|offers?|says?) (.+)$/,
      run: (m) => searchSiteAndExplain(m[1]) },
    { re: /^(?:do|does) (?:this|the) (?:site|page|website) (?:have|mention|contain|offer|say) (.+)$/,
      run: (m) => searchSiteAndExplain(m[1]) },
    { re: /^(?:search|look through|look in) (?:this|the) (?:site|page|website) (?:for )?(.+)$/,
      run: (m) => searchSiteAndExplain(m[1]) },
    { re: /^where (?:do|does) (?:they|it|this site|the docs) (?:talk about|mention|explain|cover|describe) (.+)$/,
      run: (m) => searchSiteAndExplain(m[1]) },

    // Leaving the page has to be ASKED FOR. These four rules are the only
    // phrasings that mean the web, and they all name it — "google X", "search
    // the web for X", "look X up online". Everything else searches where the
    // user is standing, which is what "search for X" has always meant to the
    // person saying it out loud at a page.
    { re: /^(?:google|bing|duckduckgo) (?:for )?(.+)$/, run: (m) => webSearch(m[1]) },
    { re: /^(?:search|look) (?:on |up on )?(?:the )?(?:web|internet|google)(?: for)? (.+)$/,
      run: (m) => webSearch(m[1]) },
    { re: /^(?:search|look up|find) (?:for )?(.+?) (?:on|in) (?:the )?(?:web|internet|google)$/,
      run: (m) => webSearch(m[1]) },
    { re: /^(?:web|internet) search (?:for )?(.+)$/, run: (m) => webSearch(m[1]) },

    // The default: this page, then this site, then — only if both come up
    // empty — an offer to try the web.
    { re: /^(?:search|look up|search for) (?:for )?(.+)$/, run: (m) => searchHere(m[1], null) },

    // -- scrolling. The lead verb is optional AND covers the jump rule's verbs,
    //    so bare "top" and "go to the top" both land here.
    // -- continuous scrolling. These sit above the one-shot scrolls because
    //    "keep going" and "go down" are not the same request, and the steering
    //    verbs ("faster", "wait") must never be read as movement.
    { re: /^(?:keep (?:scrolling|going|reading)|auto ?scroll|scroll (?:slowly|for me)|start scrolling)$/,
      run: () => autoScrollStart(READING_SPEED, "Scrolling — say wait to stop") },
    { re: /^(?:wait|wait here|hold on|hold it|stop (?:there|here)|pause|freeze)$/, run: () => waitHere() },
    { re: /^(?:faster|speed up|quicker|too slow)$/, run: () => autoScrollRate(1.6) },
    { re: /^(?:slower|slow down|too fast|ease up)$/, run: () => autoScrollRate(0.6) },
    { re: /^(?:back to where i was|where was i|back to the mark|take me back)$/, run: () => backToMark() },

    // -- one-shot scrolling, graded. People say "a bit more", not "85% of a
    //    viewport", so the amount is part of the phrase.
    { re: /^(?:a (?:bit|little)(?: more| further| down)?|nudge down|slightly down|down a (?:bit|little))$/,
      run: () => scrollByAmount("nudge", 1, "a bit down") },
    { re: /^(?:up a (?:bit|little)|a (?:bit|little) up|nudge up|slightly up)$/,
      run: () => scrollByAmount("nudge", -1, "a bit up") },
    { re: /^(?:way down|a lot more|much further|big scroll)$/,
      run: () => scrollByAmount("big", 1, "way down") },
    { re: /^(?:way up|a lot up|back up)$/, run: () => scrollByAmount("big", -1, "way up") },
    { re: /^(?:scroll |go |move )?(?:down|page down|next bit|more)$/, run: () => scrollByPage(0.85, "scroll down") },
    { re: /^(?:scroll |go |move )?(?:up|page up|back a bit)$/, run: () => scrollByPage(-0.85, "scroll up") },
    // Bare "homepage" with no verb attached — common, and rule #4 never sees it
    // because there's nothing for its verb alternation to match.
    { re: /^(?:the )?(?:home|homepage|home page|main page|front page)$/, run: () => goHome() },

    { re: /^(?:(?:scroll|go|jump|take me) (?:to (?:the )?)?)?(?:top|beginning|start|very top)$/,
      run: () => scrollToEdge("top", "jump to top") },
    { re: /^(?:(?:scroll|go|jump|take me|skip) (?:to (?:the )?)?)?(?:bottom|end|very bottom|way down there|all the way down)$/,
      run: () => scrollToEdge("bottom", "jump to bottom") },

    // -- typing. "Search for X" must sit above the web-search rule or every
    //    dictation into a search box becomes a trip to Google.
    { re: /^(?:type|enter|write|put|input) (.+?)(?: in(?:to)?(?: the)?(?: box| field| search)?)?$/,
      run: (m) => typeText(m[1]) },
    { re: /^(?:submit|send it|press enter|hit enter|go)$/, run: () => submitField() },

    // -- clicking. The bare-verb rule exists because nobody says "click the
    //    follow button" — they say "follow this person".
    { re: /^(?:click|press|tap|hit|push|select)(?: on)?(?: the)? (.+)$/,
      run: (m) => clickByDescription(m[1]) },
    { re: /^(follow|unfollow|subscribe|unsubscribe|like|save|bookmark|share|download|install|sign up|sign in|log ?in|log ?out|add to cart|buy|checkout|submit|send|reply|repost|retweet|upvote|star|watch|join|apply|continue|next|accept|dismiss|close)(?:\s+(?:this|that|it|him|her|them|this (?:person|account|user|post|one)))?$/,
      run: (m) => clickByDescription(m[1]) },

    // -- media. Above the scroll rules because "louder"/"faster" mean the
    //    player when one is playing, not the scroll speed.
    { re: /^(?:play|resume|start)(?: (?:the )?(?:video|audio|it))?$/,
      run: () => withMedia((m) => m.play(), "Playing") },
    { re: /^(?:pause|stop)(?: (?:the )?(?:video|audio|it))$/,
      run: () => withMedia((m) => m.pause(), "Paused") },
    { re: /^(?:mute)(?: (?:the )?(?:video|audio|tab|it))?$/,
      run: () => withMedia((m) => { m.muted = true; }, "Muted") },
    { re: /^(?:unmute|sound on)(?: (?:the )?(?:video|audio|tab|it))?$/,
      run: () => withMedia((m) => { m.muted = false; }, "Unmuted") },
    { re: /^(?:louder|volume up|turn it up)$/,
      run: () => withMedia((m) => { m.muted = false; m.volume = Math.min(1, m.volume + 0.2); }, "Louder") },
    { re: /^(?:quieter|volume down|turn it down)$/,
      run: () => withMedia((m) => { m.volume = Math.max(0, m.volume - 0.2); }, "Quieter") },
    { re: /^(?:skip|forward|jump)(?: (?:ahead|forward))?(?: (\d{1,3}) seconds?)?$/,
      run: (m) => withMedia((el) => { el.currentTime += Number(m[1]) || 10; }, `Skipped ahead`) },
    { re: /^(?:rewind|back)(?: (\d{1,3}) seconds?)$/,
      run: (m) => withMedia((el) => { el.currentTime -= Number(m[1]) || 10; }, "Rewound") },
    { re: /^(?:speed (?:it )?up|faster video|double speed)$/,
      run: () => withMedia((m) => { m.playbackRate = Math.min(4, m.playbackRate + 0.25); }, "Faster") },
    { re: /^(?:slow (?:it )?down|slower video|normal speed)$/,
      run: () => withMedia((m) => { m.playbackRate = Math.max(0.25, m.playbackRate - 0.25); }, "Slower") },
    { re: /^(?:full ?screen|go full ?screen)$/,
      run: () => withMedia((m) => m.requestFullscreen?.(), "Fullscreen") },

    // -- clipboard, print, page
    { re: /^copy (?:the )?(?:link|url|address|page address)$/,
      run: () => { copyText(location.href, "Copied the link"); return { ok: true, quiet: true }; } },
    { re: /^copy (?:the )?(?:title|page title)$/,
      run: () => { copyText(document.title, "Copied the title"); return { ok: true, quiet: true }; } },
    { re: /^copy(?: (?:this|that|it|the text))?$/, run: () => copySelectionOrTarget() },
    { re: /^print(?: (?:this|the)? ?page)?$/,
      run: () => { window.print(); return { ok: true, label: "Printing" }; } },
    { re: /^select all$/,
      run: () => { document.execCommand("selectAll"); return { ok: true, label: "Selected everything" }; } },

    // -- zoom (the tab's own zoom, so it survives navigation)
    { re: /^(?:zoom in|bigger|make (?:it|the text|this) bigger|increase (?:the )?(?:text|font) size)$/,
      run: () => tabCommand("zoomIn", "Bigger") },
    { re: /^(?:zoom out|smaller|make (?:it|the text|this) smaller|decrease (?:the )?(?:text|font) size)$/,
      run: () => tabCommand("zoomOut", "Smaller") },
    { re: /^(?:reset (?:the )?zoom|normal size|actual size)$/,
      run: () => tabCommand("zoomReset", "Normal size") },

    // -- history and tabs
    { re: /^(?:go |take me )?back(?: (?:to (?:the )?)?(?:previous|last)(?: page)?)?(?: one page)?$/,
      run: () => { history.back(); return { ok: true, label: "Back" }; } },
    { re: /^(?:go )?(?:forward|next page)(?: one page)?$/,
      run: () => { history.forward(); return { ok: true, label: "Forward" }; } },
    { re: /^(?:previous|last) page$/, run: () => { history.back(); return { ok: true, label: "Back" }; } },
    { re: /^(?:reload|refresh)(?: the page)?$/, run: () => { location.reload(); return { ok: true, label: "Reloading" }; } },
    { re: /^(?:open a |open )?new tab$/, run: () => tabCommand("new", "New tab") },
    { re: /^close (?:this |the )?tab$/, run: () => tabCommand("close", "Closed tab") },
    { re: /^(?:next tab|switch tabs?)$/, run: () => tabCommand("next", "Next tab") },
    { re: /^(?:previous|last) tab$/, run: () => tabCommand("prev", "Previous tab") },
    { re: /^reopen (?:the )?(?:last )?tab$/, run: () => tabCommand("reopen", "Reopened tab") },
    { re: /^duplicate (?:this |the )?tab$/, run: () => tabCommand("duplicate", "Duplicated") },
    { re: /^pin (?:this |the )?tab$/, run: () => tabCommand("pin", "Pinned") },
    { re: /^unpin (?:this |the )?tab$/, run: () => tabCommand("unpin", "Unpinned") },
    { re: /^mute (?:this |the )?tab$/, run: () => tabCommand("muteTab", "Tab muted") },
    { re: /^unmute (?:this |the )?tab$/, run: () => tabCommand("unmuteTab", "Tab unmuted") },
    { re: /^close (?:all )?other tabs$/, run: () => tabCommand("closeOthers", "Closed the others") },
    { re: /^(?:move|pop) (?:this )?tab (?:to |into )?(?:a )?new window$/,
      run: () => tabCommand("detach", "Moved to a new window") },

    // -- JustClarify's own verbs, routed through the same dispatcher the mouse
    //    uses. "this"/"that"/"it" all resolve through jcResolveTarget.
    { re: /^(?:explain|explain (?:this|that|it)|what does (?:this|that|it) mean|what(?:'?s| is) (?:this|that)|i don'?t (?:get|understand) (?:this|that|it))$/,
      run: () => runOnTarget(jcResolveTarget(), "style", "default") },
    { re: /^(?:expand|more detail|tell me more|go deeper)$/,
      run: () => runOnTarget(jcResolveTarget(), "style", "detailed") },
    { re: /^(?:eli5|explain (?:this|that|it) simply|dumb (?:this|that|it) down|simpler)$/,
      run: () => runOnTarget(jcResolveTarget(), "style", "eli5") },
    { re: /^(?:give me an example|for example|example)$/,
      run: () => runOnTarget(jcResolveTarget(), "style", "example") },

    // -- the page itself as the subject. These must sit ABOVE every rule that
    //    treats the words after "what is" as a phrase to look up: "what is
    //    this site about" once fell through to the define catch-all, which
    //    solemnly defined the words "this site about". A question about where
    //    you ARE is answered from the page's own text, not from a dictionary.
    { re: /^(?:what(?:'?s| is) (?:this|the) (?:whole )?(?:site|page|website|web ?page|article|app)(?: (?:about|for|all about|doing|selling|offering))?|what (?:does|do) (?:this|the) (?:site|page|website|app) (?:do|sell|offer|make|actually do)|what(?:'?s| is) (?:happening|going on)(?: here| on this (?:page|site))?|what am i (?:looking at|reading|on)|where am i(?: right now)?|who (?:made|runs|owns|is behind) (?:this|this (?:site|website|page|app))|summari[sz]e(?: (?:this|the) (?:page|site|article|whole thing))?|tl;?dr|give me the (?:gist|rundown|overview)(?: of (?:this|the) (?:page|site|article))?)$/,
      run: () => pageOverview(jcUtterance) },

    // -- named target. Everything above resolves "this"/"that" from context;
    //    these take the target from the sentence itself, which is how people
    //    actually ask about something they can see but haven't highlighted.
    //    They sit below the reference forms so "explain this" never lands here.
    { re: /^what (?:does|did) (?:he|she|they|the (?:author|writer|article|site)) mean by (.+)$/,
      run: (m) => explainPhrase(m[1]) },
    { re: /^what (?:does|do|did) (.+?) mean(?: here| by that)?$/,
      run: (m) => explainPhrase(m[1]) },
    { re: /^(?:what'?s|what is) (?:this|that) (?:bit|part) about (.+)$/,
      run: (m) => explainPhrase(m[1]) },
    { re: /^(?:explain|what about|meaning of|what'?s the meaning of) (.+)$/, run: (m) => explainPhrase(m[1]) },
    // Highlight is pointing, not explaining — it selects and stops.
    { re: /^(?:highlight|select|find the (?:words?|phrase|sentence)) (.+)$/,
      run: (m) => {
        const ground = jcGroundOnPage(m[1]);
        if (ground) return highlightOnly(ground.range);
        return { ok: false, label: `I can't see \u201c${m[1]}\u201d on this page.` };
      } },
    { re: /^(?:fact ?check(?: this| that| it)?|is (?:that|this|it) true|is (?:that|this|it) (?:right|accurate)|verify (?:this|that|it))$/,
      run: () => runOnTarget(jcResolveTarget(), "factcheck", "factcheck") },
    // Bare "define this" resolves a reference; "define <word>" defines the word
    // that was actually spoken. The bare form must be tested first or "this"
    // gets looked up in the dictionary.
    { re: /^define(?: (?:this|that|it))?$/,
      run: () => runOnTarget(jcResolveTarget(), "define", "define") },
    // The dictionary takes WORDS, not sentences. Four words at most, and never
    // a deictic — "what is this site about" is a question about the page, and
    // "what is the difference between stocks and bonds" is a question for a
    // model. Both used to be swallowed here and defined literally; now they
    // fall through: no grammar rule matches, so the agent loop gets them, which
    // is where open questions belong.
    { re: /^(?:define|what'?s|what is) (?:a |an |the )?(?!(?:this|that|it|there|here)\b)(?!(?:.* )?(?:this|that|here|there)$)((?:\S+ ){0,2}\S+)$/,
      run: (m) => runOnText(m[1], "define", "define", `Defining "${m[1]}"`) },
    // Translate opens its own language picker (startTranslate), so a spoken
    // language isn't captured here — it would imply a shortcut that isn't wired.
    { re: /^translate(?: (?:this|that|it))?$/,
      run: () => runOnTarget(jcResolveTarget(), "translate", "translate") },
  ];

  // Spoken text arrives with capitals, trailing punctuation and filler. Strip
  // all of it before matching so "Scroll down." and "um, scroll down" are the
  // same command.
  function normalize(transcript) {
    let phrase = String(transcript || "").toLowerCase().replace(/\s+/g, " ").trim();

    // Filler comes in runs and Chrome punctuates it — "Um, okay, scroll down."
    // arrives as one string with commas the trailing-punctuation strip below
    // will never reach. Peel one lead word at a time until nothing more comes
    // off, allowing a comma as the separator.
    let previous;
    do {
      previous = phrase;
      phrase = phrase.replace(
        /^(?:um+|uh+|er+|hmm+|hey|ok|okay|please|could you|can you|now|so|just)[,\s]+/,
        "",
      );
    } while (phrase !== previous);

    return phrase.replace(/[.,!?;:]+$/g, "").trim();
  }

  // Returns null when nothing matched, so the caller can decide whether to
  // spend a model call on it.
  function jcVoiceExecute(transcript) {
    const phrase = normalize(transcript);
    if (!phrase) return null;
    // Remember the words as said, so an explain that grounds to a shorter
    // phrase can still put the actual question in front of the model.
    jcUtterance = phrase;

    // A question on screen owns the next thing said. Checked before the grammar
    // so "no" cancels the pending navigation instead of stopping speech, and
    // "go" confirms it instead of being read as a movement command.
    if (pending) {
      if (YES.test(phrase)) return resolveConfirm(true);
      if (NO.test(phrase)) return resolveConfirm(false);
      // Anything else abandons the question rather than leaving it armed — a
      // stale confirmation that swallows a later "yes" is worse than no
      // confirmation at all.
      pending = null;
    }

    for (const rule of GRAMMAR) {
      const match = phrase.match(rule.re);
      if (!match) continue;
      try {
        return rule.run(match) || { ok: true };
      } catch (error) {
        return { ok: false, label: `That didn't work — ${String(error.message || error).slice(0, 80)}` };
      }
    }
    return null;
  }

  // ------------------------------------------------- accessibility snapshot

  // Adapted from how Playwright MCP drives a browser for Claude: instead of
  // describing the page and asking the model to describe an element back, hand
  // it a numbered list and let it name a number.
  //
  // The difference is not cosmetic. Name-matching is two lossy steps — the model
  // picks a label from what it was told, then clickByDescription has to find
  // that label again among forty identical buttons. A ref is one exact step:
  // "e12" is a specific node, already resolved, no second guess.
  //
  // It is still not the raw DOM. Only interactive elements and headings, only
  // visible ones, capped — the whole point is to stay small enough to send.

  // Refs are STABLE: an element keeps the ref it was first given for as long
  // as it lives, however many times the snapshot is rebuilt. The agent loop
  // re-looks between steps, and a numbering that reshuffled on every look made
  // step 2 click whatever had inherited step 1's number. WeakRef and WeakMap
  // mean holding a ref never keeps a dead DOM node alive.
  const refByEl = new WeakMap();
  const elByRef = new Map(); // ref -> WeakRef(element)
  let refCounter = 0;

  // What leaves the page for the model gets two washes, both learned from how
  // pages attack agents rather than users:
  //
  //   1. Invisible Unicode. Zero-width characters, bidi overrides and filler
  //      glyphs can spell out an instruction no human reader will ever see.
  //      They become visible replacement characters, so a hidden payload turns
  //      into obvious junk instead of prose the model might follow.
  //   2. Envelope forgery. Text shaped like our own harness tags could pose as
  //      instructions from us rather than data from the page.
  //
  // The replacement is deliberately not deletion: deleting zero-widths would
  // quietly splice the hidden text into the legitimate text around it.
  // Written as escapes on purpose: the characters themselves are invisible,
  // which is exactly the property that would make a literal-character regex
  // unreviewable in this file.
  const INVISIBLE_RE = new RegExp(
    "[" +
      "\\u034F" + // combining grapheme joiner
      "\\u00AD" + // soft hyphen
      "\\u061C" + // arabic letter mark
      "\\u115F\\u1160" + // hangul fillers
      "\\u180E" + // mongolian vowel separator
      "\\u200B-\\u200F" + // zero-widths and the LRM/RLM pair
      "\\u202A-\\u202E" + // bidi embeddings and overrides
      "\\u2060-\\u2064" + // word joiner, invisible operators
      "\\u2066-\\u2069" + // bidi isolates
      "\\u3164" + // hangul filler
      "\\uFEFF" + // byte-order mark / zero-width no-break
      "\\uFFA0" + // halfwidth hangul filler
    "]",
    "g",
  );

  function sanitizeForModel(text) {
    return String(text || "")
      .replace(/<\/?\s*system[-_ ]?reminder[^>]*>/gi, " ")
      .replace(INVISIBLE_RE, "�");
  }

  // Fields whose value must never ride along to a model, whatever else fails
  // to name them: passwords, one-time codes, card details. Matched on type and
  // autocomplete because that is what password managers and autofill key on,
  // so it is what reliably marks the fields they filled.
  function isSensitiveField(el) {
    if (!el || !el.getAttribute) return false;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password" || type === "hidden") return true;
    const auto = (el.getAttribute("autocomplete") || "").toLowerCase();
    return /\b(?:current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp(?:-month|-year)?)\b/.test(
      auto,
    );
  }

  function roleOf(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "submit" || type === "button") return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    return "generic";
  }

  const SNAPSHOT_MAX = 60;

  function buildSnapshot() {
    // Sweep refs whose elements have been collected, so the map cannot grow
    // without bound on a long-lived single-page app.
    for (const [ref, weak] of elByRef) {
      if (!weak.deref()) elByRef.delete(ref);
    }

    const selector =
      "button, a[href], [role='button'], [role='link'], [role='menuitem'], " +
      "input:not([type=hidden]), textarea, select, summary, [contenteditable='true'], " +
      "[role='textbox'], [role='searchbox'], h1, h2, h3";

    const rows = [];
    for (const el of document.querySelectorAll(selector)) {
      if (el.closest("#ambient-popup, #jc-ambient-panel, #jc-voice-chip")) continue;
      if (el.disabled || !isVisible(el)) continue;
      const name = accessibleName(el) || (roleOf(el) === "textbox" ? fieldLabel(el) : "");
      if (!name) continue;
      rows.push({
        el,
        role: roleOf(el),
        name: sanitizeForModel(name).replace(/\s+/g, " ").slice(0, 60),
      });
    }

    // Nearest the cursor first, because when the list has to be truncated the
    // things beside the pointer are the things being talked about.
    rows.sort((a, b) => cursorDistance(a.el) - cursorDistance(b.el));

    const lines = [];
    rows.slice(0, SNAPSHOT_MAX).forEach((row) => {
      // Reuse the element's existing ref; mint one only on first sight.
      let ref = refByEl.get(row.el);
      if (!ref) {
        ref = `e${++refCounter}`;
        refByEl.set(row.el, ref);
      }
      elByRef.set(ref, new WeakRef(row.el));
      // The "near cursor" flag is how deixis survives the trip: "this one"
      // means something specific and the model can see which.
      const near = cursorDistance(row.el) < 0.12 ? " [near cursor]" : "";
      lines.push(`${ref} ${row.role} "${row.name}"${near}`);
    });

    // A capped list that does not say it is capped reads as the whole page,
    // and "I can't find the export button" on a page that has one is the
    // model believing exactly that. Say what was left out and how to reach it.
    if (rows.length > SNAPSHOT_MAX) {
      lines.push(
        `[showing ${SNAPSHOT_MAX} of ${rows.length} elements, nearest the cursor first — ` +
          "what you want may be off this list; scroll toward it or move the cursor near it, then look again]",
      );
    }

    return lines.join("\n");
  }

  function elementByRef(ref) {
    const weak = elByRef.get(String(ref || "").trim());
    const el = weak && weak.deref();
    // A ref from a stale snapshot can point at a node the page has since
    // replaced — clicking a detached element does nothing and looks like a bug.
    if (!el || !el.isConnected) return null;
    return el;
  }

  function clickRef(ref) {
    const el = elementByRef(ref);
    if (!el) return null;
    // Same gate as spoken descriptions — a model-chosen ref must not be a way
    // around the destructive-label confirmation.
    return performClick(el);
  }

  function typeIntoRef(ref, text) {
    const el = elementByRef(ref);
    if (!el) return null;
    const before = el.isContentEditable ? el.innerText : el.value;
    setFieldValue(el, String(text || ""));
    flash(el);
    pushUndo("that typing", () => setFieldValue(el, before || ""));
    return { ok: true, label: `Typed into ${fieldLabel(el)}` };
  }

  // ------------------------------------------------------------ model tier

  // What the model is allowed to see when the grammar misses.
  //
  // Deliberately NOT the page's prose. A classifier that reads body text is a
  // prompt-injection target: every instruction-shaped sentence on the page
  // becomes a candidate instruction, and the thing being classified is what to
  // DO in the browser. Link labels and headings are short, structural, and
  // already enough to resolve "the about us page" or "the bit about refunds".
  // Content questions don't need this either — "explain X" carries its own
  // argument and is answered by the existing pipeline, which reads the page but
  // holds no tools.
  function jcVoiceContext() {
    // The title is page-authored text like everything else here, and it is the
    // one string that rides along even when the snapshot is empty.
    return {
      snapshot: buildSnapshot(),
      host: location.hostname,
      title: sanitizeForModel(document.title).slice(0, 120),
    };
  }

  // The model picks a verb from this table and supplies a string argument.
  // It never returns anything that runs — everything below is ordinary code,
  // which is what stops a page's text from becoming a browser action.
  const INTENT_VERBS = {
    navigate: (arg) => goToDestination(arg),
    home: () => goHome(),
    // Leaving for a different website is the one verb where a model acting on
    // its own initiative and a model obeying the user look identical from the
    // outside. The tell is the sentence: a site the user actually asked for
    // appears in their own words. One they never said gets the same treatment
    // as a destructive click — a question first, cheap to refuse.
    site: (arg) => {
      const name = String(arg || "").toLowerCase().split(/[./\s]/)[0];
      const said = String(jcUtterance || "").toLowerCase();
      if (!name || said.includes(name)) return openSite(arg);
      return askConfirm(
        `Head to ${arg}? You didn't name it — say yes or no.`,
        () => openSite(arg),
        `Opening ${arg}`,
      );
    },
    explain: (arg) =>
      arg ? explainPhrase(arg) : runOnTarget(jcResolveTarget(), "style", "default"),
    // The whole page as the subject. The grammar catches the common phrasings
    // of "what is this site" itself; this verb exists so the model can reach
    // the same answer for every phrasing the grammar does not anticipate.
    pageOverview: () => pageOverview(jcUtterance),
    expand: () => runOnTarget(jcResolveTarget(), "style", "detailed"),
    simplify: () => runOnTarget(jcResolveTarget(), "style", "eli5"),
    example: () => runOnTarget(jcResolveTarget(), "style", "example"),
    factcheck: (arg) =>
      arg
        ? explainPhrase(arg, "factcheck", "factcheck")
        : runOnTarget(jcResolveTarget(), "factcheck", "factcheck"),
    define: (arg) =>
      arg
        ? runOnText(arg, "define", "define", `Defining "${arg}"`)
        : runOnTarget(jcResolveTarget(), "define", "define"),
    translate: () => runOnTarget(jcResolveTarget(), "translate", "translate"),
    read: () => {
      const target = jcResolveTarget();
      if (!target?.text) return { ok: false, label: "There's nothing here to read." };
      speak(target.text);
      pushUndo("reading", jcVoiceStopSpeaking);
      return { ok: true, label: "Reading" };
    },
    scrollDown: () => scrollByPage(0.85, "scroll down"),
    scrollUp: () => scrollByPage(-0.85, "scroll up"),
    scrollABit: () => scrollByAmount("nudge", 1, "a bit down"),
    scrollALot: () => scrollByAmount("big", 1, "way down"),
    keepScrolling: () => autoScrollStart(READING_SPEED, "Scrolling — say wait to stop"),
    faster: () => autoScrollRate(1.6),
    slower: () => autoScrollRate(0.6),
    waitHere: () => waitHere(),
    backToMark: () => backToMark(),
    top: () => scrollToEdge("top", "jump to top"),
    bottom: () => scrollToEdge("bottom", "jump to bottom"),
    back: () => (history.back(), { ok: true, label: "Back" }),
    forward: () => (history.forward(), { ok: true, label: "Forward" }),
    reload: () => (location.reload(), { ok: true, label: "Reloading" }),
    newTab: () => tabCommand("new", "New tab"),
    closeTab: () => tabCommand("close", "Closed tab"),
    nextTab: () => tabCommand("next", "Next tab"),
    prevTab: () => tabCommand("prev", "Previous tab"),
    // Two searches, deliberately named for WHERE they look, because the model
    // picks by name and "search" on its own was being read as "go to Google".
    // searchPage is the one it should almost always want: this page's own
    // search box, then this site's other pages.
    searchPage: (arg) => searchHere(arg, null),
    searchSite: (arg) => searchSiteAndExplain(arg),
    webSearch: (arg) => webSearch(arg),
    click: (arg) => clickByDescription(arg),
    play: () => withMedia((m) => m.play(), "Playing"),
    pause: () => withMedia((m) => m.pause(), "Paused"),
    louder: () => withMedia((m) => { m.muted = false; m.volume = Math.min(1, m.volume + 0.2); }, "Louder"),
    quieter: () => withMedia((m) => { m.volume = Math.max(0, m.volume - 0.2); }, "Quieter"),
    zoomIn: () => tabCommand("zoomIn", "Bigger"),
    zoomOut: () => tabCommand("zoomOut", "Smaller"),
    copyLink: () => { copyText(location.href, "Copied the link"); return { ok: true, quiet: true }; },
    print: () => { window.print(); return { ok: true, label: "Printing" }; },
    type: (arg) => typeText(arg),
    submit: () => submitField(),
    undo: () => jcVoiceUndo(),
    stop: () => (jcVoiceStopSpeaking(), autoScrollStop(null), { ok: true, label: "Stopped" }),
  };

  // One source of truth for the enum the model is offered, so the prompt can
  // never drift from what's actually executable.
  function jcVoiceVerbs() {
    return Object.keys(INTENT_VERBS);
  }

  function jcVoiceRunIntent(intent, utterance) {
    const verb = intent && String(intent.verb || "").trim();
    // The agent's step carries a verb and an argument; the GOAL — the user's
    // sentence — rides in separately so explain-family verbs can quote it.
    if (utterance) jcUtterance = String(utterance);

    // A ref is already resolved to a node, so it skips every name-matching
    // heuristic below. Falls through to those only if the node has gone AND
    // there is an argument to match by name.
    const ref = intent && intent.ref ? String(intent.ref).trim() : "";
    if (ref) {
      if (verb === "click") {
        const done = clickRef(ref);
        if (done) return done;
      }
      if (verb === "type") {
        const done = typeIntoRef(ref, intent.arg);
        if (done) return done;
      }
      // This label is not for the user — it goes into the step history that
      // the model reads before its next move. "That didn't work" teaches
      // nothing; naming the staleness and the cure turns a wasted step into a
      // recovery. (With an argument present, the name-matching below is still
      // the better cure, so the message only fires when there is no fallback.)
      if ((verb === "click" || verb === "type") && !String((intent && intent.arg) || "").trim()) {
        return {
          ok: false,
          label: `${ref} is gone — the page has changed since that look. Check the fresh element list and pick from it.`,
        };
      }
    }

    const run = INTENT_VERBS[verb];
    if (!run) return null;
    try {
      return run(String((intent && intent.arg) || "").trim()) || { ok: true };
    } catch (error) {
      return { ok: false, label: `That didn't work — ${String(error.message || error).slice(0, 80)}` };
    }
  }

  Object.assign(globalThis, {
    jcVoiceExecute,
    jcResolveTarget,
    jcVoiceUndo,
    jcVoiceStopSpeaking,
    jcVoiceContext,
    jcGroundOnPage,
    jcHighlightOnly: highlightOnly,
    jcExplainRange,
    jcVoiceRunIntent,
    jcVoiceVerbs,
  });
})();
