// onboarding.js — the walk through, on the page the person is already reading.
//
// It runs once, on install, and it teaches by making them do the real thing on
// their own page rather than by describing it. Every step waits for the actual
// event it asked for: a real selection, a real click on the real diamond, a
// real spoken sentence. Nothing here simulates the extension.
//
// Three rules the whole file obeys:
//
//   1. NOTHING IS FAKED. The spotlight points at the extension's own elements
//      (#ambient-blob, #ambient-popup, .jc-bar-btn) and advances only when
//      those elements do what was asked. A walk through that mimes the product
//      teaches a product that does not exist.
//
//   2. IT CANNOT TRAP ANYONE. Escape and the corner X end it at any moment,
//      and ending it is remembered. A first-run overlay that is hard to leave
//      is the single fastest way to lose someone in the first minute.
//
//   3. THE BROWSER'S OWN CHROME IS OFF LIMITS. Chrome will not let an
//      extension open its toolbar popup, and nothing on the page may draw over
//      it. So the steps that live in the popup are ASKED FOR here (spotlight
//      the corner, say what to click) and NARRATED inside the popup itself by
//      popup.js. This file and popup.js pass the baton through
//      chrome.storage.local, which both can see.
//
// State lives in chrome.storage.local under jcOnboard, so it survives the
// popup opening, a background LLM tab stealing focus, and the page navigating.

(function () {
  if (window.__jcOnboardLoaded) return;
  window.__jcOnboardLoaded = true;

  const KEY = "jcOnboard";
  const DIM = "rgba(8, 7, 6, 0.55)";
  // Long enough to read a sentence and act, short enough that a walked-away
  // browser is not left holding a stage forever.
  const STAGE_TTL_MS = 5 * 60 * 1000;

  let box = null; // shadow host
  let root = null; // shadow root
  let stage = null; // current stage object
  let cleanup = null; // teardown for the current stage's listeners
  let target = null; // the element being spotlighted, if any
  let track = 0; // rAF id for following a moving target

  // ---------------------------------------------------------------- storage

  function read() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(KEY, (all) => resolve(all?.[KEY] || null));
      } catch (_) {
        resolve(null);
      }
    });
  }

  function write(patch) {
    return read().then((current) => {
      const next = { ...(current || {}), ...patch, at: Date.now() };
      try {
        chrome.storage.local.set({ [KEY]: next });
      } catch (_) {}
      return next;
    });
  }

  // ------------------------------------------------------------------ chrome

  // The shell: one dim layer with a hole in it, and a card that talks. Shadow
  // DOM because this draws over arbitrary pages, and a page's own !important
  // rules would otherwise be able to hide the thing explaining the product.
  function mount() {
    if (box) return;
    box = document.createElement("div");
    box.id = "jc-onboard";
    box.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483646;";
    root = box.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .veil { position: fixed; inset: 0; background: ${DIM}; opacity: 0;
          transition: opacity 260ms cubic-bezier(0.215,0.61,0.355,1); }
        .veil.in { opacity: 1; }
        /* The hole. An enormous spread shadow paints everything EXCEPT this
           rectangle, so one element does both the dimming and the cut-out and
           the two can never disagree about where the hole is. */
        .hole { position: fixed; border-radius: 10px; pointer-events: none;
          box-shadow: 0 0 0 9999px ${DIM}, 0 0 0 2px var(--jc-ring, #fff) inset;
          transition: top 200ms ease, left 200ms ease, width 200ms ease, height 200ms ease; }
        .hole.pulse { animation: jc-pulse 1.6s ease-in-out infinite; }
        @keyframes jc-pulse {
          0%, 100% { box-shadow: 0 0 0 9999px ${DIM}, 0 0 0 2px #fff inset, 0 0 0 0 rgba(255,255,255,.45); }
          50% { box-shadow: 0 0 0 9999px ${DIM}, 0 0 0 2px #fff inset, 0 0 0 10px rgba(255,255,255,0); }
        }
        .card { position: fixed; max-width: 340px; padding: 16px 18px; border-radius: 14px;
          background: #FAF9F7; color: #14110f; box-shadow: 0 18px 50px rgba(0,0,0,.35);
          font-size: 14px; line-height: 1.5; opacity: 0; transform: translateY(6px);
          transition: opacity 220ms ease, transform 220ms ease; }
        .card.in { opacity: 1; transform: none; }
        .card h4 { margin: 0 0 6px; font-size: 15px; font-weight: 700; }
        .card p { margin: 0; }
        .hint { margin-top: 8px; padding: 8px 10px; border-radius: 8px;
          background: #14110f0d; font-size: 12.5px; }
        .say { font-weight: 600; }
        .row { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
        button { font: inherit; font-size: 13px; padding: 8px 15px; border: 0; border-radius: 999px;
          cursor: pointer; }
        .go { background: #14110f; color: #fff; }
        .go:hover { background: #000; }
        .ghost { background: transparent; color: #14110f99; box-shadow: inset 0 0 0 1px #14110f26; }
        .ghost:hover { color: #14110f; }
        .x { position: fixed; top: 14px; right: 16px; width: 30px; height: 30px; border-radius: 999px;
          background: #ffffff1f; color: #fff; font-size: 17px; line-height: 1; }
        .x:hover { background: #ffffff33; }
        .step { margin-top: 10px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
          color: #14110f66; }
        .caret { display: inline-block; width: 2px; height: 1em; background: currentColor;
          vertical-align: -2px; animation: jc-blink 1s step-end infinite; }
        @keyframes jc-blink { 50% { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .veil, .card, .hole { transition: none; }
          .hole.pulse { animation: none; }
          .caret { animation: none; }
        }
      </style>
      <div class="veil"></div>
      <div class="hole" hidden></div>
      <div class="card" role="dialog" aria-live="polite"></div>
      <button class="x" title="Stop the walk through" aria-label="Stop the walk through">×</button>
    `;
    document.documentElement.appendChild(box);

    root.querySelector(".x").addEventListener("click", () => finish("quit"));
    requestAnimationFrame(() => root.querySelector(".veil").classList.add("in"));
    document.addEventListener("keydown", onKey, true);
  }

  function onKey(event) {
    if (event.key === "Escape" && box) {
      event.stopPropagation();
      finish("quit");
    }
  }

  function unmount() {
    document.removeEventListener("keydown", onKey, true);
    cancelAnimationFrame(track);
    if (cleanup) cleanup();
    cleanup = null;
    if (box) box.remove();
    box = null;
    root = null;
    target = null;
  }

  // The veil is either a plain sheet (no target) or a sheet with a hole in it.
  // Following a moving target every frame is what keeps the hole honest when
  // the page scrolls or the extension repositions its own popup.
  function spotlight(el, { pulse = false, pad = 8 } = {}) {
    const hole = root.querySelector(".hole");
    const veil = root.querySelector(".veil");
    target = el || null;
    cancelAnimationFrame(track);

    if (!el) {
      hole.hidden = true;
      veil.style.opacity = "";
      return;
    }

    hole.hidden = false;
    hole.classList.toggle("pulse", pulse);
    // The veil's own dimming would double up over the shadow's, so the sheet
    // steps aside and the hole's shadow becomes the only dim on screen.
    veil.style.opacity = "0";

    const follow = () => {
      const rect = el.getBoundingClientRect();
      hole.style.left = `${rect.left - pad}px`;
      hole.style.top = `${rect.top - pad}px`;
      hole.style.width = `${rect.width + pad * 2}px`;
      hole.style.height = `${rect.height + pad * 2}px`;
      track = requestAnimationFrame(follow);
    };
    follow();
  }

  // Somewhere the card does not cover the thing it is pointing at. Below the
  // hole when there is room, above it when there is not, centred when there is
  // no hole at all.
  function place(el) {
    const card = root.querySelector(".card");
    const rect = card.getBoundingClientRect();
    const w = rect.width || 340;
    const h = rect.height || 140;

    if (!el) {
      card.style.left = `${Math.max(16, (window.innerWidth - w) / 2)}px`;
      card.style.top = `${Math.max(16, (window.innerHeight - h) / 2)}px`;
      return;
    }
    const t = el.getBoundingClientRect();
    const below = t.bottom + 16;
    const top = below + h < window.innerHeight - 16 ? below : Math.max(16, t.top - h - 16);
    const left = Math.min(Math.max(16, t.left + t.width / 2 - w / 2), window.innerWidth - w - 16);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  // One screen of the walk through. Buttons are optional; most steps advance
  // because the person did the thing, not because they pressed Next.
  function say({ title, body, hint, buttons = [], el = null, pulse = false, step = "" }) {
    mount();
    const card = root.querySelector(".card");
    card.classList.remove("in");
    card.innerHTML = `
      ${title ? `<h4></h4>` : ""}
      <p></p>
      ${hint ? `<div class="hint"></div>` : ""}
      ${step ? `<div class="step"></div>` : ""}
      <div class="row"></div>
    `;
    // textContent everywhere: some of this copy quotes the page's own words,
    // and the page's words are never markup here.
    if (title) card.querySelector("h4").textContent = title;
    card.querySelector("p").textContent = body;
    if (hint) card.querySelector(".hint").textContent = hint;
    if (step) card.querySelector(".step").textContent = step;

    const row = card.querySelector(".row");
    buttons.forEach((b) => {
      const button = document.createElement("button");
      button.className = b.primary ? "go" : "ghost";
      button.textContent = b.label;
      button.addEventListener("click", b.run);
      row.appendChild(button);
    });

    spotlight(el, { pulse });
    requestAnimationFrame(() => {
      place(el);
      card.classList.add("in");
    });
  }

  // Types a sentence out, then rubs it out again. Used once, where the copy
  // is genuinely temporary: the note about which LLM is answering is true for
  // three seconds and then in the way.
  async function typeThenErase(text, holdMs = 3000) {
    const card = root && root.querySelector(".card p");
    if (!card) return;
    card.textContent = "";
    const caret = document.createElement("span");
    caret.className = "caret";
    card.appendChild(caret);
    for (let i = 0; i < text.length; i++) {
      caret.insertAdjacentText("beforebegin", text[i]);
      await wait(16 + Math.random() * 22);
    }
    await wait(holdMs);
    while (card.firstChild !== caret) {
      card.firstChild.remove();
      await wait(8);
    }
    caret.remove();
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------- picking a target
  //
  // The walk through asks them to highlight something REAL on the page they
  // brought, which means finding a phrase worth explaining. A proper noun in
  // a paragraph is the best candidate: it is short, it is visible, and it is
  // the kind of thing someone actually highlights.

  function visible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 30 || rect.height < 10) return false;
    if (rect.top < 0 || rect.bottom > window.innerHeight) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }

  function pickPhrase() {
    const blocks = [...document.querySelectorAll("p, li, h2, h3, blockquote")]
      .filter((el) => !el.closest("#jc-onboard, #ambient-popup, #jc-ambient-panel, nav, footer"))
      .filter(visible)
      .slice(0, 40);

    for (const el of blocks) {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length < 60) continue;
      // Two or three capitalised words in a row, not at the start of a
      // sentence: as close to "a name worth asking about" as a regex gets.
      const match = text.match(/[a-z,;:]\s+((?:[A-Z][\w'’-]+\s+){1,2}[A-Z][\w'’-]+)/);
      if (match) return { el, phrase: match[1] };
    }
    // Nothing proper-noun shaped: the longest sentence in the longest block is
    // still a fair thing to explain.
    for (const el of blocks) {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length > 120) return { el, phrase: text.split(/(?<=[.!?])\s/)[0].slice(0, 90) };
    }
    return null;
  }

  // Enough of a page to teach on. A new tab, an app shell or a login screen
  // has nothing to highlight, and asking anyway is how a walk through breaks
  // in its first ten seconds.
  function pageIsReadable() {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    return text.length > 600 && !!pickPhrase();
  }

  // ------------------------------------------------------------- observing
  //
  // Every advance is an observation of the extension's own DOM, so the walk
  // through cannot get out of step with what actually happened.

  function whenAppears(selector, done) {
    const found = document.querySelector(selector);
    if (found) {
      done(found);
      return () => {};
    }
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        done(el);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  }

  function whenGone(selector, done) {
    const observer = new MutationObserver(() => {
      if (!document.querySelector(selector)) {
        observer.disconnect();
        done();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  }

  function whenStorage(key, test, done) {
    const listener = (changes, area) => {
      if (area !== "local" || !changes[key]) return;
      if (test(changes[key].newValue)) {
        chrome.storage.onChanged.removeListener(listener);
        done(changes[key].newValue);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  // --------------------------------------------------------------- stages

  let chosen = null; // { el, phrase } once picked

  const STAGES = {
    // Not a stage of the walk through: the question that starts it.
    invite() {
      say({
        title: "Want a quick walk through?",
        body:
          "JustClarify is installed. Two minutes, on this page, using your own words and your own reading. You can stop at any point.",
        buttons: [
          { label: "Yes, show me", primary: true, run: () => go("toolbar") },
          { label: "Remind me later", run: () => finish("later") },
        ],
      });
    },

    // Chrome forbids opening the toolbar popup from here, so this step asks
    // rather than performs, and points at the corner it lives in.
    toolbar() {
      const corner = cornerAnchor();
      say({
        title: "Open JustClarify",
        body: "Top right of your browser, in the extensions area. Click the JustClarify diamond.",
        hint: "Pinned it? It sits in the toolbar. Otherwise it is behind the puzzle-piece icon.",
        step: "Step 1 of 6",
        el: corner,
        pulse: true,
      });
      // popup.js writes this the moment it opens, which is the only signal a
      // page can get that browser chrome did something.
      cleanup = whenStorage(KEY, (v) => v && v.popupOpen, () => go("engine"));
    },

    // The popup is open. Its own script is showing the line about Your LLM;
    // this side just waits for the engine to change and stays out of the way.
    engine() {
      say({
        title: "Pick Your LLM",
        body:
          "Look in the menu you just opened. Choose Your LLM, which answers using the ChatGPT you already pay for, so it costs you nothing extra.",
        step: "Step 2 of 6",
      });
      cleanup = whenStorage("jcEngine", (v) => v === "llm", () => go("highlight"));
    },

    // The first real thing they do. A phrase from their own page, outlined and
    // waiting, because "highlight something" is a harder instruction to follow
    // than it sounds.
    highlight() {
      chosen = chosen || pickPhrase();
      if (!chosen) return go("voiceIntro");

      say({
        title: "Now highlight this",
        body: `Select the words "${chosen.phrase}" below, the way you would to copy them.`,
        step: "Step 3 of 6",
        el: chosen.el,
        pulse: true,
      });

      const onUp = () => {
        const selected = String(window.getSelection() || "").trim();
        if (selected.length < 3) return;
        // Any overlap counts. Insisting on the exact phrase would fail people
        // who dragged one word wide, which is not a mistake worth punishing.
        const want = chosen.phrase.toLowerCase();
        const got = selected.toLowerCase();
        if (want.includes(got) || got.includes(want.split(" ")[0])) go("diamond");
      };
      document.addEventListener("mouseup", onUp, true);
      cleanup = () => document.removeEventListener("mouseup", onUp, true);
    },

    // The diamond is already on screen and already counting down to its own
    // dismissal, so this step says so rather than letting it vanish mid-lesson.
    diamond() {
      const stop = whenAppears("#ambient-blob", (el) => {
        say({
          title: "There it is",
          body: "The diamond follows what you highlighted. Click it.",
          hint: "It waits about six seconds, then gets out of your way. Highlight again to bring it back.",
          step: "Step 4 of 6",
          el,
          pulse: true,
        });
      });
      const stop2 = whenAppears("#ambient-popup", () => go("action"));
      cleanup = () => {
        stop();
        stop2();
      };
    },

    // The action row. Wandering into the second page of actions is the one
    // wrong turn worth catching, because those actions do not open an LLM and
    // the next step is about the LLM.
    action() {
      const row = document.querySelector("#ambient-popup");
      say({
        title: "Explain, or Expand",
        body: "Explain puts it plainly. Expand goes deeper. Pick either one.",
        step: "Step 5 of 6",
        el: row,
      });

      const onClick = (event) => {
        const button = event.target.closest?.(".jc-bar-btn");
        if (!button) return;
        const key = button.getAttribute("data-jc-key");
        if (key === "default" || key === "detailed") {
          go("thinking");
          return;
        }
        // The arrow and the far actions: allowed, just not yet.
        const card = root && root.querySelector(".card p");
        if (card) {
          card.textContent =
            "Not that one yet. Fact-check, Define and the rest come later. Explain or Expand for now.";
        }
      };
      document.addEventListener("click", onClick, true);
      cleanup = () => document.removeEventListener("click", onClick, true);
    },

    // Where the LLM engine shows its hand: a real ChatGPT tab opens in the
    // background and answers. The note about which model is answering is true
    // while it works and pointless once it has, so it types itself out and
    // then rubs itself out.
    async thinking() {
      say({
        title: "It went to your ChatGPT",
        body: "",
        step: "Step 5 of 6",
        el: document.querySelector("#ambient-popup"),
      });
      await typeThenErase(
        "You are on ChatGPT right now. Any LLM you already pay for can take its place, in the menu.",
        3000,
      );
      const card = root && root.querySelector(".card p");
      if (card) card.textContent = "It opened in the background and is working. The answer lands here.";

      // The answer replaces the loading state, which is the honest signal that
      // it arrived.
      const check = setInterval(() => {
        const popup = document.querySelector("#ambient-popup");
        if (popup && !popup.classList.contains("is-loading")) {
          clearInterval(check);
          go("dismiss");
        }
      }, 400);
      cleanup = () => clearInterval(check);
    },

    dismiss() {
      say({
        title: "That is the whole loop",
        body: "Highlight, click, read, carry on. Click anywhere outside the answer to close it.",
        step: "Step 5 of 6",
        el: document.querySelector("#ambient-popup"),
      });
      cleanup = whenGone("#ambient-popup", () => go("voiceIntro"));
    },

    // Second visit to the menu, for the engine that carries voice.
    voiceIntro() {
      say({
        title: "One more thing, and it is the big one",
        body:
          "Open the menu again, top right, and choose Early access. It is free while it lasts, and it is what powers voice.",
        step: "Step 6 of 6",
        el: cornerAnchor(),
        pulse: true,
      });
      cleanup = whenStorage("jcEngine", (v) => v === "device" || v === "api", () => go("voice"));
    },

    // The first spoken command. A suggestion, never a requirement: anything
    // they say is fine, and the extension answers it.
    voice() {
      const phrase = (chosen && chosen.phrase) || "this page";
      say({
        title: "Hold Shift and talk",
        body: `Hold the Shift key down, say "what do they mean by ${phrase}", and let go. Holding is what listens; letting go is what sends it.`,
        hint: "Say anything else you like, it will still answer. Nothing is recorded unless the key is held.",
        step: "Step 6 of 6",
      });
      cleanup = whenAppears("#jc-voice-chip", () => go("voiceMore"));
    },

    // Two more things it can do, then an honest fork: more, or done.
    voiceMore() {
      say({
        title: "It does more than read",
        body:
          "\"Take me to the pricing bit\" jumps to it. \"Click the sign up button\" clicks it. It can search this page, work through several steps, and undo what it just did.",
        buttons: [
          { label: "Show me more voice", primary: true, run: () => go("voiceDeep") },
          { label: "I am good", run: () => finish("done") },
        ],
      });
    },

    voiceDeep() {
      say({
        title: "Ask it for a sequence",
        body:
          "Hold Shift and try \"find their contact page and read me the address\". It takes one step, looks at what changed, then decides the next one.",
        hint: "Say \"stop\" at any time and it stops, mid-sentence if need be.",
        buttons: [{ label: "Finish", primary: true, run: () => finish("done") }],
      });
    },
  };

  // The toolbar lives outside the page, so the closest honest thing to point
  // at is the top-right corner of the viewport.
  function cornerAnchor() {
    let anchor = document.getElementById("jc-onboard-corner");
    if (!anchor) {
      anchor = document.createElement("div");
      anchor.id = "jc-onboard-corner";
      anchor.style.cssText =
        "position: fixed; top: 0; right: 8px; width: 180px; height: 40px; pointer-events: none;";
      document.documentElement.appendChild(anchor);
    }
    return anchor;
  }

  function go(name) {
    if (cleanup) cleanup();
    cleanup = null;
    stage = name;
    write({ status: "running", stage: name });
    const run = STAGES[name];
    if (run) run();
  }

  function finish(how) {
    if (cleanup) cleanup();
    cleanup = null;
    document.getElementById("jc-onboard-corner")?.remove();
    unmount();

    if (how === "later") {
      read().then((state) => {
        const deferrals = (state?.deferrals || 0) + 1;
        // Asked twice, declined twice: it stops asking and waits in the menu.
        write({
          status: deferrals >= 2 ? "done" : "later",
          deferrals,
          dueAt: Date.now() + 24 * 60 * 60 * 1000,
          popupOpen: false,
        });
      });
      return;
    }
    write({ status: "done", stage: null, popupOpen: false });
  }

  // ----------------------------------------------------------------- start

  async function start() {
    // Never on our own surfaces, and never in an iframe: the walk through is
    // about the page the person is reading, once.
    if (window.top !== window) return;
    if (/^(chrome|about|edge|chrome-extension):/.test(location.protocol)) return;

    const state = await read();
    if (!state) return;

    if (state.status === "running") {
      // A stage older than the timeout belonged to a session that was walked
      // away from. Resuming it on some unrelated page later would be baffling.
      if (Date.now() - (state.at || 0) > STAGE_TTL_MS) {
        write({ status: "done" });
        return;
      }
      // Resume where it left off, but only for the stages that make sense on a
      // fresh page. Anything mid-highlight starts that step again.
      const resumable = ["toolbar", "engine", "voiceIntro", "voice", "voiceMore", "voiceDeep"];
      go(resumable.includes(state.stage) ? state.stage : "highlight");
      return;
    }

    if (state.status === "pending" || (state.status === "later" && Date.now() > (state.dueAt || 0))) {
      // A page with nothing to read cannot teach highlighting, so the invite
      // waits for one that can rather than opening on a blank tab.
      if (!pageIsReadable()) return;
      STAGES.invite();
    }
  }

  // document_idle already, but a framework page often has no text yet at that
  // moment, and pageIsReadable would then wrongly call it unteachable.
  if (document.readyState === "complete") setTimeout(start, 1200);
  else window.addEventListener("load", () => setTimeout(start, 1200), { once: true });
})();
