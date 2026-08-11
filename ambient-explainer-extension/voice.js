// voice.js — hold Shift, say what you want, let go.
//
// The gesture is deliberately the sibling of the one that already exists:
// content.js opens the ask box on a double-tap of Shift, so a HOLD of the same
// key means "talk instead of type". Tap-tap to write, hold to speak — one key,
// two moods, nothing new to learn. content.js checks jcVoiceHoldActive() on
// keyup so a hold never counts as one half of a double-tap.
//
// Why push-to-talk rather than a wake word or an open mic:
//   - Releasing the key IS the end-of-turn signal. Voice agents spend their
//     hardest engineering on deciding when a person has stopped talking; a key
//     answers it exactly, for free, with no false triggers.
//   - Nothing is captured unless a key is physically held, which is a privacy
//     story that fits in one sentence.
//
// Recognition runs in the page via the Web Speech API — free and keyless, but
// NOT promised local: Chrome's speech service processes audio on Google's
// servers on many platforms (on-device recognition is rolling out per platform
// and language). UI copy must never claim speech stays on the machine.
// TWO MICROPHONES, and which one runs is the whole story of this file.
//
// A content script inherits the PAGE's microphone permission, so Web Speech here
// is subject to every site's own policy: plenty of sites switch the mic off
// outright, and the rest ask separately, one prompt per site, forever.
//
// The extension's own chrome-extension:// origin can hold ONE grant that no
// website can veto. mic.html collects it (an invisible offscreen document has no
// way to show a permission prompt, so a real tab has to ask), and from then on
// offscreen.js records instead.
//
// The routing rule, and the reason it is what it is: offer that one-time setup
// at the FIRST microphone request, before any site has prompted. Offering it
// only after a site had already blocked the mic meant the common path was a
// prompt on every new site and never seeing the setup at all — while the setup
// page sat there promising it would prevent exactly that. Once granted, the page
// lane is still used on sites that have already allowed the mic, because Web
// Speech is faster and free; everywhere else goes to the extension lane and
// nothing asks again.

(function () {
  const SpeechRecognitionCtor =
    globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

  // How long Shift must be down before it means "talk" instead of "tap". Long
  // enough that a real double-tap never trips it, short enough that it doesn't
  // feel like waiting.
  const HOLD_MS = 350;

  let holdTimer = null;
  let holding = false; // a push-to-talk hold is live right now
  let recognition = null;
  let finalText = "";
  // Kept separately because Chrome routinely ends a SHORT utterance without
  // ever flagging a result final — for "scroll down" the last interim is the
  // only transcript that ever arrives. Ignoring it loses every one-word command.
  let interimText = "";
  let awaitingResult = false;
  let settleTimer = null;
  // Ranked runners-up from the recogniser, and how sure it was of the winner.
  let alternatives = [];
  let topConfidence = null;

  // A parallel recording of the same hold, kept ONLY so a phrase the browser's
  // recogniser mangled can be re-read by a better model. Uploaded only when the
  // grammar AND the model have both already failed on the local transcript —
  // never for a command that matched.
  let recorder = null;
  let recordedChunks = [];
  let micStream = null;
  // Resolves when the recorder has finished handing over the audio for the
  // hold that just ended. settle() awaits it before giving up on a transcript.
  let recordingFlush = null;

  // Voice is an agent acting in the browser, and that capability belongs to
  // the API engine (subscription or BYOK) — the popup says so too. Cached here
  // because keydown handlers can't await storage.
  let engineCache = "api";
  try {
    chrome.storage.local.get(["jcEngine"], (res) => {
      if (res && (res.jcEngine === "device" || res.jcEngine === "llm")) engineCache = res.jcEngine;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.jcEngine) {
        const v = changes.jcEngine.newValue;
        engineCache = v === "device" || v === "llm" ? v : "api";
      }
    });
  } catch (_) {}

  // Which microphone this hold is using.
  //   "page"      — Web Speech in this content script, on the PAGE's origin.
  //                 Fast and free, but any site can switch it off.
  //   "extension" — recorded in the offscreen document on the extension's own
  //                 origin, transcribed by the hosted model. Slower by roughly
  //                 a second, and no site can veto it.
  // Hosts that refused the page mic are remembered so the second hold on a
  // blocked site goes straight to the lane that works.
  const blockedHosts = new Set();
  // Which lane the CURRENT hold is on, so endHold knows how to finish it.
  let lane = "page";

  // Does the EXTENSION hold its own microphone grant? That grant outranks every
  // site, so once it exists no website is ever asked again.
  //
  // This used to be discovered only after a site had already blocked the mic,
  // which meant the usual path was: get a per-site prompt on every new site,
  // and never even see the one-time setup that exists to prevent exactly that.
  // The setup page promises "grant it here instead"; the code has to offer it
  // BEFORE the first site prompt for that promise to be true.
  let micGranted = false;
  // The page's own mic state for THIS site: "granted" | "prompt" | "denied".
  // Known up front so beginHold can pick a lane without triggering a prompt to
  // find out.
  let pageMicState = "prompt";
  // Asked about setup already in this page's lifetime — never nag twice.
  let micSetupOffered = false;
  // They chose "just this site" over the one-time setup. Their call: use the
  // ordinary page microphone and let the site do the asking.
  let preferPageLane = false;

  try {
    chrome.storage.local.get(["jcMicGranted"], (res) => {
      if (res && res.jcMicGranted) micGranted = true;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.jcMicGranted) {
        micGranted = !!changes.jcMicGranted.newValue;
      }
    });
  } catch (_) {}

  // Verify against the extension origin rather than trusting the flag alone —
  // the user can revoke it in Chrome's settings and storage would never know.
  (async () => {
    try {
      const res = await jcSendAsync({ type: "JC_VOICE_MIC_STATUS" });
      if (res && res.state) micGranted = res.state === "granted";
    } catch (_) {}
  })();

  // Reading permission state does NOT prompt, which is what makes it safe to
  // check before deciding anything.
  (async () => {
    try {
      const status = await navigator.permissions.query({ name: "microphone" });
      pageMicState = status.state;
      status.onchange = () => {
        pageMicState = status.state;
      };
    } catch (_) {
      // Older Chrome, or a page whose policy hides it. "prompt" is the safe
      // assumption: it routes away from the page lane rather than into a prompt.
    }
  })();

  // NOTHING that waits on the worker may wait forever. Every "it just keeps
  // loading" report traced back to an await with no ceiling: a hung fetch in
  // the worker left the pulsing chip on screen with no path to any other
  // state. A timeout turns a hang into an ordinary, dismissible failure.
  function withTimeout(promise, ms, fallback) {
    return Promise.race([
      Promise.resolve(promise).catch(() => fallback),
      new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
  }

  // content.js reads this on Shift keyup to know the press was speech.
  function jcVoiceHoldActive() {
    return holding;
  }

  // ------------------------------------------------------------ caption chip

  // Voice without an echo is unusable: the user has no idea what was heard
  // until something already happened. The chip shows the words as they arrive,
  // then what the command resolved to, then gets out of the way.
  // The chip lives in a SHADOW ROOT, and is re-attached whenever the page has
  // dropped it. Two separate failures made it vanish mid-session:
  //
  //   1. `if (!chip)` created it once and never checked it was still in the
  //      DOM. Any site that re-renders document.body — React/Next hydration, a
  //      router swap, body.innerHTML = … — detaches it, leaving a non-null
  //      reference to a node that is no longer on the page. Everything kept
  //      "working" and nothing was ever visible again.
  //   2. styles.css is injected into the PAGE's cascade, so a site with an
  //      aggressive reset or an !important on a generic selector could hide it.
  //
  // A shadow root fixes (2) outright — page CSS cannot reach inside it — and
  // isConnected fixes (1). CSS custom properties still inherit through the
  // shadow boundary, so the shared --accent from brand.js keeps working.
  let chip = null;
  let chipRoot = null;
  let chipTimer = null;

  const CHIP_CSS = `/* ── Voice: caption chip + jump flash ──────────────────────────────────────
   The chip is the only feedback a spoken command gets before it acts, so it
   sits above everything (including the popup) and never waits on an animation
   to become readable. States: listening / hearing / done / unknown / error. */

:host {
  position: fixed;
  /* left/top are written by placeChip() in voice.js — the chip tracks the
     cursor rather than sitting in a fixed bar, so it is beside whatever the
     user is pointing at and talking about. */
  left: 0;
  top: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 9px;
  max-width: min(440px, 76vw);
  /* Asymmetric on purpose, and the reason is the pill. At border-radius:999px
     the left edge is a semicircle, so a round 8px dot padded the same 16px as
     flat text sits INSIDE the arc and reads as crowded, while the text's flat
     right edge reads as loose — the chip looked shoved left even though the
     box model was symmetric. Two extra pixels on the left and two fewer on the
     right put the two ends in optical balance. */
  padding: 9px 15px 9px 17px;
  border: 1px solid rgba(0,0,0,.08);
  border-radius: 999px;
  /* Translucent over blur rather than flat white: the chip hovers over
     arbitrary pages, and letting a hint of the page through is what makes it
     read as a light overlay instead of a sticker. */
  background: rgba(255,255,255,.92);
  backdrop-filter: blur(16px) saturate(1.35);
  -webkit-backdrop-filter: blur(16px) saturate(1.35);
  /* Two stops, both faint: a hairline contact shadow so the chip sits ON the
     page rather than floating above it, and a wide soft one for depth. The
     single 24px/16% blur this replaces read as a drop shadow from another
     decade and was the loudest thing about a surface meant to be quiet. */
  box-shadow:
    0 1px 2px rgba(0,0,0,.05),
    0 6px 16px rgba(0,0,0,.07);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
  font-size: 14px;
  line-height: 1.35;
  color: #14110f;
  /* Parked off-state: translate rather than display:none so the chip can
     animate in without a layout pass on the host page. */
  transform: translateY(8px);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.16s ease-out,
    transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

:host(.is-in) {
  transform: translateY(0);
  opacity: 1;
}

:host .jc-voice-text {
  /* The transcript is the product here — every word the user says shows, so
     it WRAPS instead of ellipsising to one clipped line. The old nowrap +
     ellipsis meant a spoken sentence was legible for about four words and
     then turned into "what does he mea…", which read as broken. */
  white-space: normal;
  overflow-wrap: anywhere;
  min-width: 0;
  font-weight: 500;
  letter-spacing: -0.01em;
}

/* Two or more lines of transcript stop being a pill: a stadium shape around a
   paragraph reads as a mistake. showChip measures the line boxes and flips
   this class, which squares the corners off and tops-aligns the dot against
   the first line instead of centring it against the block. */
:host(.is-multi) {
  align-items: flex-start;
  border-radius: 16px;
  padding: 11px 15px 11px 15px;
}
:host(.is-multi) .jc-voice-dot {
  margin-top: 5px;
}

:host .jc-voice-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent, oklch(0.60 0.08 275));
  /* Optical, not geometric. align-items:center puts the dot at the middle of
     the LINE BOX, which sits below the middle of the letters themselves —
     descender space is counted and there are no descenders in most of these
     captions. One pixel up and the dot lines up with the text you can see. */
  margin-top: -1px;
}

/* Only the two live states pulse. A finished command that kept breathing
   would read as "still listening", which is exactly the wrong signal. */
:host([data-state="listening"]) .jc-voice-dot,
:host([data-state="hearing"]) .jc-voice-dot,
:host([data-state="thinking"]) .jc-voice-dot,
:host([data-state="confirm"]) .jc-voice-dot {
  animation: jc-voice-pulse 1.1s ease-in-out infinite;
}

/* Live microphone level (extension lane, before any words arrive): the dot
   abandons its metronome pulse and moves with the voice itself — visible
   proof of hearing that needs no transcript. --jc-level is 0..1, written per
   reading by the JC_VOICE_LEVEL handler. */
:host([data-live="1"][data-state="listening"]) .jc-voice-dot {
  animation: none;
  transform: scale(calc(0.9 + var(--jc-level, 0) * 1.5));
  transition: transform 0.09s linear;
}

:host([data-state="done"]) .jc-voice-dot {
  background: oklch(0.62 0.14 150);
}

:host([data-state="error"]) .jc-voice-dot,
:host([data-state="unknown"]) .jc-voice-dot {
  background: oklch(0.62 0.16 25);
}

:host([data-state="unknown"]) .jc-voice-text {
  color: #6b625c;
}

/* The live transcript is the user's own words coming back at them — full ink,
   not the coaching grey it used to share with "unknown". */
:host([data-state="hearing"]) .jc-voice-text {
  color: #14110f;
}

@keyframes jc-voice-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.8); }
}

/* A chip asking a question has to be clickable; every other state stays
   click-through so it can never swallow a click meant for the page. */
:host(.has-actions) {
  pointer-events: auto;
}

:host .jc-voice-actions {
  display: inline-flex;
  gap: 5px;
  margin-left: 4px;
}

/* More than a yes/no needs a second row. Crammed onto one line the question
   ellipsised down to "Where do you rea…" and the last button wrapped its own
   label onto two lines, leaving buttons of different heights in a pill that
   was no longer pill-shaped. So past two choices the chip becomes a small
   card: question on its own line, buttons wrapping underneath, and a corner
   radius that a two-row box can actually wear. */
:host(.has-many) {
  flex-wrap: wrap;
  align-items: flex-start;
  max-width: min(360px, 76vw);
  padding: 12px 14px;
  border-radius: 16px;
  row-gap: 11px;
}

/* flex: 1 1 0 with min-width:0, not 1 1 auto. A wrapping paragraph's
   min-content width is its longest WORD plus, here, an unbreakable email
   address — enough to overflow the row and push the whole text block onto a
   second line, which left the status dot stranded alone above it. Allowed to
   shrink, the dot and the first line share a row the way they do everywhere
   else. */
:host(.has-many) .jc-voice-text {
  flex: 1 1 0;
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  overflow: visible;
}

/* Top-aligned now, so centre it against the FIRST line rather than the block. */
:host(.has-many) .jc-voice-dot {
  margin-top: 5px;
}

:host(.has-many) .jc-voice-actions {
  flex: 1 0 100%;
  flex-wrap: wrap;
  margin-left: 0;
}

:host .jc-voice-btn {
  padding: 4px 12px;
  border: 1px solid rgba(0,0,0,.10);
  border-radius: 999px;
  background: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  /* A button label that wraps is a button that no longer matches its
     neighbours' height. There is room to wrap the ROW instead. */
  white-space: nowrap;
  color: #14110f;
  cursor: pointer;
  transition: background 0.12s ease-out, border-color 0.12s ease-out;
}

:host .jc-voice-btn:hover {
  background: color-mix(in oklch, var(--accent, oklch(0.60 0.08 275)) 12%, #ffffff);
  border-color: var(--accent, oklch(0.60 0.08 275));
}

/* The first button is the affirmative one and should read as the default. */
:host .jc-voice-btn:first-child {
  background: var(--accent, oklch(0.60 0.08 275));
  border-color: var(--accent, oklch(0.60 0.08 275));
  color: #fff;
}

:host .jc-voice-btn:first-child:hover {
  filter: brightness(1.08);
}

/* A pending question must not time out on screen — it stays until answered. */
:host([data-state="confirm"]) .jc-voice-text {
  color: #14110f;
}

/* Motion here is confirmation, not decoration — but the pulse is a loop next to
   text, which is exactly what vestibular triggers look like. */
@media (prefers-reduced-motion: reduce) {
  :host { transition: opacity 0.16s ease-out; transform: none; }
  :host .jc-voice-dot { animation: none !important; }
  :host .jc-voice-btn { transition: none; }
}`;

  function ensureChip() {
    if (chip && chip.isConnected) return;
    // Rebuild from scratch: a detached host's shadow root is not worth reusing,
    // and this runs at most once per page re-render.
    chip = document.createElement("div");
    chip.id = "jc-voice-chip";
    chipRoot = chip.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CHIP_CSS;
    chipRoot.appendChild(style);
    // :host has famously low specificity, so a page rule targeting
    // #jc-voice-chip would still outrank it. The handful of properties that
    // must never be overridable are set inline, where nothing can reach them.
    //
    // NOT opacity. It used to be pinned here at 1 !important, and inline
    // !important beats the shadow stylesheet's own :host rules — the very
    // rules that fade the chip out. Every hide "ran" and changed nothing:
    // the chip stayed at full opacity forever, which is the reported "the
    // audio pop up does not go away after I use it". Opacity is now written
    // inline by showChip/dismissChip themselves, so it is still beyond the
    // page's reach — but ours.
    chip.style.setProperty("position", "fixed", "important");
    chip.style.setProperty("z-index", "2147483647", "important");
    chip.style.setProperty("display", "flex", "important");
    chip.style.setProperty("margin", "0", "important");
    chip.style.setProperty("visibility", "visible", "important");

    // Mounted on <html>, NOT <body>. A `transform`, `filter`, `backdrop-filter`
    // or `will-change: transform` anywhere on an ancestor makes that element the
    // containing block for position:fixed — and page-transition libraries put
    // exactly those on <body> constantly. The chip then resolves against body's
    // box instead of the viewport and lands above the fold on a scrolled page:
    // present, "visible", and completely unseeable. !important does not help,
    // because containment is not a cascade problem. <html> has no ancestor to
    // be contained by, which is the only real fix available here.
    (document.documentElement || document.body).appendChild(chip);
  }

  // The chip sits by the cursor and follows it, because that is where the user
  // is already looking and what every command is aimed at ("this", "here", the
  // button under the pointer). A bar pinned to the bottom of the page makes you
  // look away from the thing you are talking about.
  //
  // It stops following the moment it grows buttons: a confirmation you have to
  // chase with the mouse is worse than one that stays put.
  const CHIP_OFFSET_X = 16;
  const CHIP_OFFSET_Y = 20;
  let chipFollows = false;

  function placeChip() {
    if (!chip) return;
    const x = typeof lastMouseX === "number" ? lastMouseX : window.innerWidth / 2;
    const y = typeof lastMouseY === "number" ? lastMouseY : window.innerHeight / 2;
    const box = chip.getBoundingClientRect();
    const width = box.width || 220;
    const height = box.height || 40;

    // Flip to the other side of the cursor rather than run off the edge.
    let left = x + CHIP_OFFSET_X;
    if (left + width > window.innerWidth - 8) left = Math.max(8, x - CHIP_OFFSET_X - width);
    let top = y + CHIP_OFFSET_Y;
    if (top + height > window.innerHeight - 8) top = Math.max(8, y - CHIP_OFFSET_Y - height);

    chip.style.left = `${Math.round(left)}px`;
    chip.style.top = `${Math.round(top)}px`;
  }

  // Passive and cheap: one style write per move, only while the chip is up and
  // still following.
  document.addEventListener(
    "mousemove",
    () => {
      if (chipFollows && chip && chip.classList.contains("is-in")) placeChip();
    },
    { passive: true },
  );

  function showChip(state, text, actions) {
    clearTimeout(chipTimer);
    ensureChip();

    chip.dataset.state = state;
    // Any state change retires the level meter; a fresh "listening" earns it
    // back reading by reading.
    delete chip.dataset.live;

    // Rebuild the contents, leaving the <style> node in place.
    for (const node of Array.from(chipRoot.children)) {
      if (node.tagName !== "STYLE") node.remove();
    }

    const dot = document.createElement("span");
    dot.className = "jc-voice-dot";
    const label = document.createElement("span");
    label.className = "jc-voice-text";
    // textContent, not innerHTML: a transcript is untrusted text.
    label.textContent = text;
    chipRoot.append(dot, label);

    // A chip with buttons has to accept clicks; every other state stays
    // click-through so it can never block the page underneath.
    const interactive = !!(actions && actions.length);
    chipFollows = !interactive;
    chip.classList.toggle("has-actions", interactive);
    // Past a yes/no, the chip lays out as a small card instead of a pill.
    chip.classList.toggle("has-many", interactive && actions.length > 2);

    if (interactive) {
      const row = document.createElement("span");
      row.className = "jc-voice-actions";
      for (const action of actions) {
        const button = document.createElement("button");
        button.className = "jc-voice-btn";
        button.textContent = action.label;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const result = action.run();
          if (result) {
            showChip(result.ok ? "done" : "error", result.label || "");
            hideChip(1500);
          }
        });
        row.appendChild(button);
      }
      chipRoot.appendChild(row);
    }

    // Pill for one line of text, card for a wrapping transcript. Measured off
    // the live line boxes (one rect per line), re-run on every call so the
    // shape adapts as a spoken sentence grows word by word.
    chip.classList.toggle("is-multi", label.getClientRects().length > 1);

    // Positioned before the reveal so it never animates in from the old spot.
    placeChip();
    // Inline and !important for the same reason as the pins in ensureChip —
    // a page rule must not be able to hide a live chip. dismissChip writes
    // the 0 the same way, so hiding actually works.
    chip.style.setProperty("opacity", "1", "important");
    chip.classList.add("is-in");
  }

  // commands.js narrates its own long-running work through this rather than
  // owning any DOM. `hideAfter` is optional on purpose: a chip that is waiting
  // on an answer, or on a site crawl, must stay put until it has one.
  function jcVoiceChip(state, text, actions, hideAfter) {
    showChip(state, text, actions);
    if (hideAfter) hideChip(hideAfter);
  }

  // Fade now, then take the element out of the DOM entirely. Removal is the
  // backstop that makes "stuck chip" structurally impossible: whatever state
  // the styles end up in, a node that isn't there can't be on screen. The next
  // showChip rebuilds from scratch via ensureChip.
  function dismissChip() {
    clearTimeout(chipTimer);
    if (!chip || !chip.isConnected) return;
    const el = chip;
    el.classList.remove("is-in");
    el.style.setProperty("opacity", "0", "important");
    setTimeout(() => {
      if (!el.classList.contains("is-in")) el.remove();
    }, 300);
  }

  function hideChip(afterMs) {
    clearTimeout(chipTimer);
    chipTimer = setTimeout(dismissChip, afterMs);
  }

  // A chip is dismissible by hand, always: Escape or a click anywhere that
  // isn't the chip takes it off the screen. Interactive chips included — an
  // unanswered question dismissed this way resolves nothing, exactly like its
  // own timeout. Capture phase, so a page that stops propagation can't strand
  // the chip.
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!chip || !chip.isConnected || !chip.classList.contains("is-in")) return;
      // Mid-hold the chip IS the feedback — clicking the page while speaking
      // ("click the highlighted phrase…") must not knock the transcript out.
      if (holding) return;
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (path.includes(chip)) return;
      dismissChip();
    },
    { capture: true, passive: true },
  );

  // --------------------------------------------------------- when it goes wrong
  //
  // "I didn't hear anything." is a true sentence that has never once helped
  // anybody. It names the symptom and none of the three things a first-time
  // user actually gets wrong: letting go of Shift before speaking, tapping
  // instead of holding, and talking before the key has been down long enough.
  // So for the first few holds a failure teaches the gesture instead of
  // reporting on it, and the raw error is held back until it is the answer —
  // which, by then, means something is genuinely broken rather than new.
  //
  // Three in a row is the line. At that point coaching has demonstrably not
  // worked, the user deserves to see exactly what the browser said, and they
  // deserve somewhere to send it.
  const LEARNING_HOLDS = 5; // how long "the first few times" lasts
  const TROUBLE_BEFORE_HELP = 3; // consecutive failures before the error itself

  // Both counters are PERSISTED. A content script is rebuilt from scratch on
  // every navigation, so anything kept only in a module variable resets the
  // moment the user clicks a link — and "the first few times" would silently
  // mean "the first few times on this page", which is not the promise.
  let holdCount = 0;
  let troubleStreak = 0;
  try {
    chrome.storage.local.get(["jcVoiceHolds", "jcVoiceTrouble"], (res) => {
      if (!res) return;
      if (typeof res.jcVoiceHolds === "number") holdCount = res.jcVoiceHolds;
      if (typeof res.jcVoiceTrouble === "number") troubleStreak = res.jcVoiceTrouble;
    });
  } catch (_) {}

  function remember(key, value) {
    try {
      chrome.storage.local.set({ [key]: value });
    } catch (_) {}
  }

  // What goes wrong, in roughly the order it goes wrong.
  const COACH_GESTURE = [
    "Hold Shift down while you talk, then let go when you're finished.",
    "Keep Shift held for the whole sentence — releasing it is what sends it.",
    "Did you hold Shift and talk? Press and hold, say it in one go, then let go.",
  ];
  // A transcript arrived and nothing matched: the gesture is fine, the words
  // aren't. Different problem, different coaching.
  const COACH_WORDS = [
    'Try something like "scroll down", "go back", or "search this site for pricing".',
    "You can also point at anything on the page and just say what you want to know about it.",
    'Short and literal works best — "open settings", "read this to me", "go to the top".',
  ];

  // A command actually ran. Whatever was going wrong isn't any more.
  function voiceWorked() {
    if (!troubleStreak) return;
    troubleStreak = 0;
    remember("jcVoiceTrouble", 0);
  }

  // THE single funnel for every "that didn't work" chip.
  //   message — what actually failed, in the browser's own terms.
  //   coach   — the lines to teach with instead, or null when nothing the user
  //             can do would help (no microphone hardware, no Web Speech at
  //             all). Those still count toward the streak, because three of
  //             them in a row is exactly when somebody needs to reach a human.
  function voiceTrouble(message, coach) {
    troubleStreak += 1;
    remember("jcVoiceTrouble", troubleStreak);
    // Logged as well as shown: the chip is gone in three seconds and a bug
    // report is written later.
    console.debug(
      `[JustClarify voice] trouble ${troubleStreak}/${TROUBLE_BEFORE_HELP}:`,
      message,
    );

    if (troubleStreak >= TROUBLE_BEFORE_HELP) {
      console.debug("[JustClarify voice] three in a row — offering the report page");
      showChip("error", message, [
        {
          label: "Tell us about this error",
          run: () => {
            openPage(tellmePageUrl(message));
            // The streak has been heard. Reset it so a fixed problem doesn't
            // greet them with the same offer on the very next hold.
            voiceWorked();
            return { ok: true, label: "Opening the report page, not an email." };
          },
        },
      ]);
      hideChip(14_000);
      return;
    }

    if (coach && holdCount <= LEARNING_HOLDS) {
      const line = coach[Math.min(troubleStreak, coach.length) - 1];
      console.debug("[JustClarify voice]", line);
      showChip("unknown", line);
      hideChip(4200);
      return;
    }

    showChip("error", message);
    hideChip(2800);
  }

  // The report goes to justclarify.xyz/tellme — a page where they can see
  // other people's reports and watch their own turn green — with everything a
  // reply would otherwise have to ask for attached. Deliberately the SITE and
  // not the full URL: the host is what makes a microphone fail, and a pasted
  // query string is somebody's private business.
  function tellmePageUrl(message) {
    let version = "";
    try {
      version = chrome.runtime.getManifest().version;
    } catch (_) {}
    const ctx = [
      `[extension v${version}] hold-to-talk trouble`,
      `What it says: ${String(message || "").slice(0, 300)}`,
      `Site: ${location.host}`,
      `Microphone: ${lane} lane · extension grant ${micGranted ? "yes" : "no"} · site permission ${pageMicState}`,
    ].join("\n");
    return `https://justclarify.xyz/tellme?src=extension&ctx=${encodeURIComponent(ctx)}`;
  }

  // An anchor click rather than window.open or a location assignment: a popup
  // blocker will refuse window.open on some sites even inside a gesture, but a
  // real anchor with target=_blank rides the user's click.
  function openPage(url) {
    try {
      const link = document.createElement("a");
      link.href = url;
      if (/^https?:/i.test(url)) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      link.style.setProperty("display", "none");
      (document.body || document.documentElement).appendChild(link);
      link.click();
      link.remove();
    } catch (_) {}
  }

  // ------------------------------------------------------------- recognition

  function startEngine() {
    if (!SpeechRecognitionCtor) {
      // No coaching: holding Shift more carefully cannot install Web Speech.
      voiceTrouble("This browser can't do speech recognition, sorry.", null);
      return false;
    }

    try {
      recognition = new SpeechRecognitionCtor();
    } catch (_) {
      voiceTrouble("Speech recognition wouldn't start — reload the page and try again.", null);
      return false;
    }

    recognition.lang = navigator.language || "en-US";
    // Interim results are the whole trick: the transcript is built WHILE the
    // user speaks, so by the time they release Shift there is nothing left to
    // wait for. This is why a command can land in ~50ms rather than ~500ms.
    recognition.interimResults = true;
    recognition.continuous = false;
    // The single biggest free win available here. The recogniser ranks its
    // guesses and we were reading only the top one — so "ayotomcs" heard as
    // "are your toms" was a miss, even when the right words sat at rank 3.
    // Now every alternative is tried against the grammar and the first that
    // matches a real command wins. Costs nothing: no extra latency, no network.
    recognition.maxAlternatives = 5;

    finalText = "";
    interimText = "";
    alternatives = [];
    topConfidence = null;

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
          if (typeof result[0].confidence === "number") topConfidence = result[0].confidence;
          // Keep the ranked runners-up for the grammar to try.
          for (let a = 0; a < result.length; a++) {
            const text = (result[a].transcript || "").trim();
            if (text && !alternatives.includes(text)) alternatives.push(text);
          }
        } else {
          interim += result[0].transcript;
        }
      }
      interimText = interim;
      const shown = (finalText + interim).trim();
      if (shown) showChip("hearing", shown);
    };

    // The engine itself says when it's done. Waiting for this rather than a
    // fixed delay is the difference between catching a one-word command and
    // reading an empty string 180ms after stop().
    recognition.onend = () => settle();

    recognition.onerror = (event) => {
      // "aborted" is what a deliberate stop() looks like — not a failure.
      if (event.error === "aborted") return;
      // A real error is the final word on this hold. Without this, the onend
      // that follows would settle an empty transcript and replace "Microphone
      // blocked" with "Didn't catch that" — hiding the only actionable message.
      awaitingResult = false;
      clearTimeout(settleTimer);

      // The site refused, not the user. `not-allowed` is a page-level block or
      // a remembered Block click; `service-not-allowed` is Chrome refusing the
      // speech service to this origin outright, which is what an http:// page
      // and a Permissions-Policy header both look like. Neither is fixable
      // from inside this page — so retry the same hold on the extension's own
      // microphone instead of telling the user to go change site settings.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        blockedHosts.add(location.host);
        stopEngine();
        stopRecording();
        if (holding) {
          beginExtensionHold();
        } else {
          offerExtensionMic();
        }
        return;
      }

      const message =
        event.error === "no-speech"
          ? "I didn't hear anything."
          : event.error === "audio-capture"
            ? "No microphone found — check it's plugged in and selected."
            : event.error === "network"
              ? "Speech recognition couldn't reach the network."
              : `Voice error: ${event.error}`;
      // Clear the hold. Without this, every error except the two handled above
      // left `holding` true, and the NEXT press of Shift returned instantly at
      // `if (holding) return` with no chip and no microphone -- one of the
      // "sometimes it just does nothing" reports. Web Speech fires `no-speech`
      // on its own after a few seconds of quiet, so this is reachable in the
      // middle of an ordinary hold, not just on exotic failures.
      holding = false;
      stopEngine();
      stopRecording();
      // no-speech is THE beginner failure — the key was let go too early, or
      // tapped rather than held. Missing hardware and a dead network are not
      // things the gesture can fix, so those get no coaching.
      voiceTrouble(
        message,
        event.error === "audio-capture" || event.error === "network" ? null : COACH_GESTURE,
      );
    };

    try {
      recognition.start();
    } catch (_) {
      // start() throws if a previous session hasn't finished tearing down.
      showChip("error", "Still finishing the last one — try again in a second.");
      hideChip(2200);
      return false;
    }
    return true;
  }

  function stopEngine() {
    if (!recognition) return;
    try {
      recognition.stop(); // stop(), not abort() — keeps the last final result
    } catch (_) {}
    recognition = null;
  }

  // ------------------------------------------------------------- recording

  async function startRecording() {
    try {
      // Same microphone permission Web Speech just asked for, so this adds no
      // extra prompt — but it is acquired per hold and released immediately
      // after, so the browser's recording indicator never lingers.
      micStream = await navigator.mediaDevices.getUserMedia({
        // Speech, not music: suppress room noise and echo, and let gain control
        // even out a quiet speaker. Meaningfully better input for the
        // re-transcription that only runs when the local guess already failed.
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      if (!holding) {
        // Released while we were waiting for the mic. Don't leave it open.
        stopRecording();
        return;
      }
      recordedChunks = [];
      recorder = new MediaRecorder(micStream);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) recordedChunks.push(e.data);
      };
      recorder.start();
    } catch (_) {
      // No mic, denied, or unsupported — Web Speech is still the main path.
      stopRecording();
    }
  }

  // Resolves once the recorder has actually handed over its audio. THE BUG this
  // exists for: the old version called recorder.stop() and killed the MediaStream
  // tracks in the SAME TICK. MediaRecorder emits its final `dataavailable`
  // asynchronously, and with no timeslice that is the ONLY chunk there ever is --
  // so recordedChunks was reliably empty by the time accurateTranscript() looked,
  // it bailed at `if (!recordedChunks.length)`, and the re-transcription fallback
  // silently never worked. That is the missing transcript.
  //
  // The correct shape already existed in offscreen.js: await the stop event, with
  // a ceiling so a recorder that never fires it cannot wedge the hold.
  function stopRecording() {
    const live = recorder;
    const stream = micStream;
    recorder = null;
    micStream = null;

    const dropStream = () => {
      if (!stream) return;
      stream.getTracks().forEach((t) => {
        try { t.stop(); } catch (_) {}
      });
    };

    if (!live || live.state === "inactive") {
      dropStream();
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        dropStream();
        resolve();
      };
      live.addEventListener("stop", finish, { once: true });
      // A recorder that never fires `stop` must not hold the mic open forever.
      setTimeout(finish, 1200);
      try { live.stop(); } catch (_) { finish(); }
    });
  }

  // The vocabulary the user is staring at is the vocabulary they are about to
  // say. Headings and link labels are already collected for the classifier;
  // reusing them to bias the transcriber costs nothing.
  function pageVocabularyHint() {
    try {
      if (typeof jcVoiceContext !== "function") return "";
      const ctx = jcVoiceContext();
      const words = String(ctx.snapshot || "")
        .split("\n")
        .map((line) => (line.match(/"([^"]+)"/) || [])[1])
        .filter(Boolean)
        .slice(0, 25);
      if (ctx.host) words.unshift(ctx.host.replace(/^www\./, "").split(".")[0]);
      return words.length ? `Words that may appear: ${words.join(", ")}.` : "";
    } catch (_) {
      return "";
    }
  }

  // Ask the hosted model what was actually said. Only ever called after the
  // local transcript has already failed to match anything, so the cost and the
  // ~850ms are spent on the rare miss rather than on every command.
  async function accurateTranscript() {
    if (!recordedChunks.length) return null;
    const blob = new Blob(recordedChunks, { type: recordedChunks[0].type || "audio/webm" });
    recordedChunks = [];
    // 800 bytes was roughly a quarter-second once the WebM container header is
    // subtracted, which threw away exactly the short utterances people use
    // most — "stop", "go back", "what's this". Reported as: it hears a long
    // sentence but a little one is never transcribed. 220 still rejects an
    // accidental key-brush without rejecting a word.
    if (blob.size < 220) return null;

    try {
      // Through the worker, NOT fetched here: an MV3 content script inherits the
      // page's CORS policy, so this request would arrive carrying the page's
      // origin and be refused. Base64 because messaging can't carry a Blob.
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      const response = await withTimeout(
        jcSendAsync({
          type: "JC_VOICE_TRANSCRIBE",
          audioBase64: btoa(binary),
          mimeType: blob.type,
          context: pageVocabularyHint(),
        }),
        15_000,
        null,
      );
      if (!response || !response.ok) {
        console.debug("[JustClarify voice] transcribe failed:", response && response.error);
        return null;
      }
      return response.text || null;
    } catch (error) {
      console.debug("[JustClarify voice] transcribe error:", error);
      return null;
    }
  }

  // --------------------------------------------------------------- the hold

  function beginHold() {
    if (holding) return;

    // THE LLM ENGINE GATE. An engine gate lived here once, was removed for
    // firing on every non-api engine ("it says my API is not connected \u2014 it
    // is connected"), and is now back BY DECISION for exactly one engine:
    // "Your LLM". Voice on that engine half-works \u2014 the local grammar runs,
    // but every ask that needs a model would ride a driven chat tab that the
    // voice agent can't use \u2014 and half-working reads as broken. So the hold
    // never opens a microphone; it says the true thing instead, with the
    // switch one click away. Voice is an API-engine capability, and the popup
    // has said so all along.
    if (engineCache === "llm") {
      showChip(
        "unknown",
        "Voice needs the API engine \u2014 spoken commands can't run through Your LLM.",
        [
          {
            label: "Switch to API",
            run: () => {
              try { chrome.storage.local.set({ jcEngine: "api" }); } catch (_) {}
              return { ok: true, label: "Switched \u2014 hold Shift and talk." };
            },
          },
        ],
      );
      hideChip(9000);
      return;
    }

    // BEFORE any microphone is touched: if JustClarify has no grant of its own
    // and this site would have to ask, offer the one-time setup instead. Getting
    // the extension's own permission once beats being asked by every site
    // forever, which is exactly what the setup page says — so it has to be
    // offered at the first mic request, not as a consolation prize after a site
    // has already blocked you.
    if (!micGranted && pageMicState !== "granted" && !preferPageLane && !micSetupOffered) {
      micSetupOffered = true;
      offerMicSetup();
      return;
    }

    holding = true;
    // Counted here rather than on success, because "the first few times" means
    // the first few ATTEMPTS — a beginner whose holds all fail is exactly who
    // the coaching is for, and counting successes would leave them on line one
    // forever.
    holdCount += 1;
    remember("jcVoiceHolds", holdCount);
    showChip("listening", "Listening…");

    // Once JustClarify holds its own grant, prefer it wherever the page would
    // otherwise prompt or is blocked. No site is ever asked again. The page lane
    // stays for sites already allowed, because Web Speech is faster and free.
    if (
      blockedHosts.has(location.host) ||
      (micGranted && pageMicState !== "granted" && !preferPageLane)
    ) {
      beginExtensionHold();
      return;
    }

    lane = "page";
    if (!startEngine()) {
      holding = false;
      // startEngine explains every failure it can now, but the "Listening…"
      // chip must never be what survives a failure — that pulsing dot is
      // indistinguishable from a hang.
      return;
    }
    startRecording();
  }

  // The one-time offer, shown at the first mic request rather than after a
  // failure. Declining is respected: the next hold uses the ordinary page mic
  // and the site asks, which is the old behaviour and still works fine on sites
  // that allow it.
  function offerMicSetup() {
    showChip(
      "unknown",
      "JustClarify needs a microphone once, and then hold to talk works on every site.",
      [
        {
          label: "Set it up",
          run: () => {
            jcSendAsync({ type: "JC_VOICE_MIC_GRANT" });
            return { ok: true, label: "Opening microphone setup…" };
          },
        },
        {
          label: "Just this site",
          run: () => {
            // They would rather grant per site. Honour it: the very next hold
            // takes the page lane and this site does the asking.
            preferPageLane = true;
            return { ok: true, label: "Hold Shift again to talk." };
          },
        },
      ],
    );
    hideChip(14_000);
  }

  // The extension-origin lane: record in the offscreen document, transcribe on
  // release. No Web Speech here, so there is no interim text to echo — the chip
  // says what it is doing rather than going quiet.
  async function beginExtensionHold() {
    lane = "extension";
    // Same reset startEngine() does for the page lane. Without it this lane
    // inherited the PREVIOUS hold's ranked alternatives and confidence score —
    // so a fresh utterance could execute a runner-up from a completely
    // different sentence, and the re-transcribe branch read a stale number.
    finalText = "";
    interimText = "";
    alternatives = [];
    topConfidence = null;
    showChip("listening", "Listening…");

    const started = await withTimeout(
      jcSendAsync({ type: "JC_VOICE_MIC_START" }),
      6000,
      { ok: false, error: "The microphone didn't respond." },
    );

    if (!holding) {
      // Released while the mic was still coming up. Don't leave it open.
      jcSendAsync({ type: "JC_VOICE_MIC_STOP" });
      return;
    }
    if (started && started.ok) return;

    holding = false;
    if (started && started.needsGrant) {
      offerExtensionMic();
      return;
    }
    voiceTrouble((started && started.error) || "The microphone didn't start.", COACH_GESTURE);
  }

  // Offered when a site blocks the page mic and the extension holds no grant of
  // its own yet. One tab, one click, and every site works from then on.
  function offerExtensionMic() {
    showChip(
      "unknown",
      "This site blocks the microphone. JustClarify can use its own instead, on every site.",
      [
        {
          label: "Set it up",
          run: () => {
            jcSendAsync({ type: "JC_VOICE_MIC_GRANT" });
            return { ok: true, label: "Opening microphone setup…" };
          },
        },
        { label: "Not now", run: () => ({ ok: false, label: "No problem." }) },
      ],
    );
    // Even an ignored offer has to clear itself. A chip with no expiry is the
    // "keeps loading" bug wearing a different hat.
    hideChip(12_000);
  }

  async function endExtensionHold() {
    showChip("thinking", "One second…");
    const result = await withTimeout(
      jcSendAsync({ type: "JC_VOICE_MIC_STOP", context: pageVocabularyHint() }),
      15_000,
      null,
    );

    if (result && result.ok && result.text && result.text.trim()) {
      // `retried` is true: this transcript already came from the good model, so
      // there is no better one left to fall back to.
      handle(result.text.trim(), true);
      return;
    }
    voiceTrouble((result && result.error) || "I didn't catch that — try again.", COACH_GESTURE);
  }

  function endHold() {
    if (!holding) return;
    holding = false;

    if (lane === "extension") {
      endExtensionHold();
      return;
    }

    awaitingResult = true;
    stopEngine();
    // Held rather than fired-and-forgotten: settle() has to wait for the
    // recorder to hand over its audio before it can honestly say there is none.
    recordingFlush = stopRecording();
    // onend settles this in practice; the timer is only a backstop for an
    // engine that stops without firing it.
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 900);
  }

  // Runs exactly once per hold, from whichever of onend / the backstop wins.
  function settle() {
    if (!awaitingResult) return;
    awaitingResult = false;
    clearTimeout(settleTimer);

    const phrase = (finalText || interimText).trim();
    if (!phrase) {
      // The browser's recogniser heard nothing, but there is still a recording
      // of the same hold worth asking about before giving up. WAIT for the
      // recorder to flush first: its final chunk arrives asynchronously, and
      // looking before it lands is what made this fallback a no-op.
      showChip("thinking", "One second, listening again…");
      Promise.resolve(recordingFlush)
        .then(() => accurateTranscript())
        .then((better) => {
          if (better) handle(better, true);
          else voiceTrouble("I didn't catch that — try again.", COACH_GESTURE);
        });
      return;
    }
    handle(phrase);
  }

  async function handle(phrase, retried) {
    // One line per command so a phrase that didn't match can be read out of the
    // console rather than guessed at.
    console.debug("[JustClarify voice] heard:", JSON.stringify(phrase), retried ? "(re-transcribed)" : "");

    if (typeof jcVoiceExecute !== "function") {
      // Distinguishing this from a grammar miss matters: identical symptom,
      // completely different fix. No coaching — nothing the user says will
      // load a file that didn't.
      voiceTrouble("Something didn't load properly — reload the extension and try again.", null);
      return;
    }

    // Try the recogniser's ranked guesses in order. The first one that IS a
    // command wins — which rescues exactly the case where the top guess was
    // ordinary English and the real command was ranked below it.
    const candidates = [phrase, ...alternatives.filter((a) => a !== phrase)];
    for (const candidate of candidates) {
      const hit = jcVoiceExecute(candidate);
      if (hit !== null) {
        if (candidate !== phrase) {
          console.debug("[JustClarify voice] matched alternative:", JSON.stringify(candidate));
        }
        render(hit, candidate);
        return;
      }
    }

    // Nothing in the grammar matched. Only AI mode may go further; free mode
    // says so rather than silently sending a recording off the machine.
    // Nothing in the grammar matched, so this was ordinary language rather
    // than a command. The grammar running first is what keeps the common case
    // local: "scroll down" is matched here and never leaves the machine.
    // No command matched any alternative. Before asking a model, ask the
    // SCREEN: if one of the recogniser's guesses closely matches text that is
    // actually visible, the user was pointing at it with their voice — saying
    // a phrase you can see IS the intent to ask about it. Trying all
    // alternatives here is the joint-decoding half: the transcript that best
    // explains the page wins, even when it wasn't the recogniser's top pick.
    //
    // What lands is a HIGHLIGHT OF EXACTLY THE HEARD WORDS, explained. Both
    // halves were wrong before: it selected the surrounding block rather than
    // the phrase, and it stopped at the selection, so the common case — say a
    // line, get it explained — ended in a highlight and silence, waiting on a
    // follow-up nobody knew to say.
    if (typeof jcGroundOnPage === "function") {
      let bestGround = null;
      let bestFrom = phrase;
      for (const candidate of candidates) {
        const ground = jcGroundOnPage(candidate);
        if (ground && (!bestGround || ground.score > bestGround.score)) {
          bestGround = ground;
          bestFrom = candidate;
        }
      }
      if (bestGround && bestGround.score >= 0.66 && typeof jcExplainRange === "function") {
        if (bestFrom !== phrase) {
          console.debug("[JustClarify voice] grounded via alternative:", JSON.stringify(bestFrom));
        }
        // The chip echoes the PAGE's wording rather than the transcript's, so
        // it reads as "this is what I highlighted" instead of repeating a
        // guess the recogniser may have spelled its own way. The FULL phrase
        // rides along as the question: "what does he mean by X" grounds to X,
        // but the model must answer what was asked, not define the words.
        render(
          jcExplainRange(bestGround.range, bestGround.text, "style", "default", phrase),
          bestGround.text || bestFrom,
        );
        return;
      }
    }

    // A recogniser that says it is unsure usually is. Re-read the audio before
    // spending a model call on a phrase that was probably misheard.
    if (!retried && topConfidence != null && topConfidence < 0.6) {
      showChip("thinking", "One second, listening again…");
      const better = await accurateTranscript();
      if (better && better.toLowerCase() !== phrase.toLowerCase()) {
        return handle(better, true);
      }
    }

    if (await runAgent(phrase)) return;

    // Grammar missed AND the model missed. The likeliest remaining explanation
    // is that Web Speech simply misheard — it is fast and local, and it mangles
    // proper nouns. Spend the ~850ms and the fraction of a cent now, once, on a
    // model that gets "Yolat" right, then run the whole pipeline again.
    if (!retried) {
      showChip("thinking", "One second, listening again…");
      const better = await accurateTranscript();
      if (better && better.toLowerCase() !== phrase.toLowerCase()) {
        return handle(better, true);
      }
    }

    // The microphone worked perfectly and the words didn't land. Coaching here
    // is about WHAT to say, not how to hold a key — the gesture lines would be
    // actively wrong advice.
    voiceTrouble(`I don't understand what you mean by "${phrase}".`, COACH_WORDS);
  }

  // A `quiet` result means the action already put something on screen that has
  // to stay there (a confirmation waiting on an answer), so the chip is left
  // exactly as the action left it.
  function render(result, phrase) {
    // Something ran. Whatever streak was building is over.
    if (result && result.ok) voiceWorked();
    if (!result || result.quiet) return;
    showChip(result.ok ? "done" : "error", result.label || phrase || "");
    hideChip(result.ok ? 1500 : 2600);
  }

  // ------------------------------------------------------------ acting

  // A request is not always one action. "Find their refund policy and read me
  // the shipping bit" is three, and the second one cannot be chosen until the
  // first has run — the page after a search is not the page before it.
  //
  // So the model is asked for ONE step, that step runs, and it is asked again
  // with the new page in front of it. Two things keep that from being
  // expensive or runaway:
  //
  //   - the model says whether another step is needed. Most requests are one
  //     action and end after a single call, exactly as before;
  //   - the loop counts steps itself and stops. A model that keeps saying
  //     "more" is a model that has lost the thread, not one making progress.
  const AGENT_KEY = "jcVoiceAgent";
  const AGENT_MAX_STEPS = 5;
  // Long enough to survive a page load, short enough that an abandoned run
  // can't wake up and start acting during something unrelated.
  const AGENT_TTL_MS = 30_000;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Verbs whose whole job is to end this page. A click can navigate too, and
  // that case is covered by saving before the step rather than by this list —
  // these are the ones we know in advance, so the loop can hand over cleanly
  // instead of firing another model call at a document that is already gone.
  const LEAVES_PAGE = new Set([
    "navigate", "site", "home", "back", "forward", "reload",
    "searchPage", "searchSite", "webSearch",
  ]);

  // Any step can navigate — a click is a link as often as it is a button — and
  // navigation destroys this content script mid-action. sessionStorage is
  // per-tab and per-origin, which is exactly the scope of "finish what I asked,
  // on whatever page that click just opened".
  function saveAgent(state) {
    try {
      sessionStorage.setItem(AGENT_KEY, JSON.stringify({ ...state, at: Date.now() }));
    } catch (_) {}
  }

  function clearAgent() {
    try {
      sessionStorage.removeItem(AGENT_KEY);
    } catch (_) {}
  }

  function loadAgent() {
    try {
      const raw = sessionStorage.getItem(AGENT_KEY);
      if (!raw) return null;
      const state = JSON.parse(raw);
      if (!state || !state.goal || !(state.steps < AGENT_MAX_STEPS)) {
        clearAgent();
        return null;
      }
      if (Date.now() - (state.at || 0) > AGENT_TTL_MS) {
        clearAgent();
        return null;
      }
      return state;
    } catch (_) {
      return null;
    }
  }

  async function runAgent(goal, resumed) {
    const state = resumed || { goal, done: [], steps: 0 };
    if (!resumed) showChip("thinking", "Let me work that out…");

    while (state.steps < AGENT_MAX_STEPS) {
      // Capped: a hung fetch in the worker used to leave "Let me work that
      // out…" pulsing on screen with no path to any other state, forever.
      const response = await withTimeout(
        jcSendAsync({
          type: "JC_VOICE_STEP",
          goal: state.goal,
          // Rebuilt every pass on purpose. A snapshot from before the last
          // click describes a page that no longer exists, and its refs point at
          // nodes that have been replaced.
          context: typeof jcVoiceContext === "function" ? jcVoiceContext() : null,
          verbs: typeof jcVoiceVerbs === "function" ? jcVoiceVerbs() : [],
          done: state.done,
        }),
        20_000,
        null,
      );

      if (!response || !response.ok || !response.step) {
        clearAgent();
        // Some failures are worth stopping on and showing: the user has to act,
        // or waiting is the only cure. Everything else falls through so handle()
        // can re-transcribe and try again.
        //
        // The old test was /key|configured|allowance/, which matched the bare
        // SUBSTRING "key" — so "monkey", "keyboard" or "turnkey" anywhere in a
        // message would abort the retry and show a config error for what was
        // really just a misheard word. It also fired on every transient failure,
        // because the worker reported all of them as "add an API key".
        const stop =
          response &&
          response.error &&
          /\bAPI key\b|\bearly[- ]access\b|free asks|rate limit|questions at once|connection|having a moment/i.test(
            response.error,
          );
        if (stop) {
          showChip("unknown", response.error);
          hideChip(3600);
          return true;
        }
        // Mid-run, there is nothing left to re-transcribe — the words were
        // understood, the follow-up call just failed. Say so rather than
        // handing back to the "I didn't catch that" path.
        if (state.steps > 0) {
          showChip("error", "I lost track of that one.");
          hideChip(2600);
          return true;
        }
        return false;
      }

      const step = response.step;
      state.steps += 1;

      if (step.verb === "done") {
        clearAgent();
        // "Done" before anything has been done is not a result, it is the
        // model declining to act — and the honest response to that is the same
        // as to any other miss: re-transcribe, then coach. Reporting it as a
        // success would swallow every misheard sentence into a cheerful chip.
        if (state.steps <= 1) return false;
        showChip("done", step.say || "Done");
        hideChip(2200);
        voiceWorked();
        return true;
      }

      // Narrate BEFORE acting. "Searching this page for refunds" while the
      // search is happening is the difference between an agent that is working
      // and one that has frozen — and it is the only way the user can see that
      // it stayed on the page rather than wandering off to a search engine.
      if (step.say) showChip("thinking", step.say);

      // Written before the step runs, not after: if this click navigates, this
      // script is gone before any line after it executes, and the record it
      // left behind is the only thing that knows what we were doing.
      if (step.more) saveAgent(state);
      else clearAgent();

      const result = typeof jcVoiceRunIntent === "function" ? jcVoiceRunIntent(step, state.goal) : null;

      // The model answered with a verb that isn't in the table — treat it as a
      // miss rather than guessing at what it meant.
      if (!result) {
        clearAgent();
        return state.steps > 1;
      }

      state.done.push(
        `${step.verb}${step.arg ? ` "${step.arg}"` : ""} → ${
          result.ok ? result.label || "done" : result.label || "failed"
        }`,
      );

      if (!step.more) {
        clearAgent();
        render(result, goal);
        return true;
      }

      // Now that the outcome is known, write it down. If the step navigated,
      // this line never runs — which is exactly why the save above it happens
      // first. Between them, a resumed run knows either what it was about to
      // do or what it just did, and never repeats a step blindly.
      saveAgent(state);

      // Either the page is on its way out, or something on screen owns the
      // next move — a confirmation waiting on a yes, a search narrating its
      // own progress. Both mean the same thing: stop acting here. If a new
      // page arrives, the saved record picks the run up on the far side; if
      // one doesn't, the record expires. What the loop must not do is keep
      // issuing steps against a page it is in the middle of leaving.
      if (result.quiet || LEAVES_PAGE.has(step.verb)) return true;

      // Let the page react to what just happened before looking at it again.
      await pause(450);
    }

    // Out of steps. Stopping and saying so beats a loop that keeps spending
    // calls on a goal it is not converging on.
    clearAgent();
    showChip("done", "That's as far as I got.");
    hideChip(2600);
    voiceWorked();
    return true;
  }

  // The other half of the navigation split: a step that opened a new page left
  // its record behind, and this is the page that has to pick it up. Delayed so
  // a framework site has actually rendered something to snapshot.
  function resumeAgent() {
    const state = loadAgent();
    if (!state) return;
    setTimeout(() => {
      // Re-read rather than trusting the copy taken before the wait: a hold in
      // the meantime may have started something else entirely.
      if (!loadAgent()) return;
      showChip("thinking", "Picking up where I left off…");
      runAgent(state.goal, state);
    }, 900);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", resumeAgent, { once: true });
  } else {
    resumeAgent();
  }

  // ------------------------------------------------------------------ keys

  // Capture phase so a page that swallows key events can't block the gesture.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Shift" || e.repeat) return;
      // Shift+click, Shift+arrow and every other modifier combo must still work
      // — a hold only counts when Shift is genuinely alone.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Typing a capital letter should never open a microphone.
      const el = document.activeElement;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;

      clearTimeout(holdTimer);
      holdTimer = setTimeout(beginHold, HOLD_MS);
    },
    true,
  );

  document.addEventListener(
    "keyup",
    (e) => {
      if (e.key !== "Shift") return;
      clearTimeout(holdTimer);
      endHold();
    },
    true,
  );

  // Escape during a hold abandons it — mic closed, audio discarded, nothing
  // transcribed and nothing spent. Releasing Shift SENDS; this is the way to
  // take it back. Outside a hold, Escape just clears whatever chip is up.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      if (holding) {
        cancelHold();
        return;
      }
      if (chip && chip.isConnected && chip.classList.contains("is-in")) dismissChip();
    },
    true,
  );

  // Everything endHold does EXCEPT act on the words. The recogniser is
  // aborted rather than stopped (abort discards its pending final result), the
  // recording is dropped on the floor, and the extension lane's stop rides a
  // `discard` flag so the worker releases the mic without paying to
  // transcribe audio nobody wants.
  function cancelHold() {
    if (!holding) return;
    holding = false;
    clearTimeout(holdTimer);
    awaitingResult = false;
    clearTimeout(settleTimer);

    if (lane === "extension") {
      jcSendAsync({ type: "JC_VOICE_MIC_STOP", discard: true });
    } else {
      if (recognition) {
        try { recognition.abort(); } catch (_) {}
        recognition = null;
      }
      stopRecording();
    }
    finalText = "";
    interimText = "";
    showChip("done", "Cancelled");
    hideChip(900);
  }

  // The same gesture, relayed from an IFRAME. A keydown is dispatched in the
  // document owning the focused element, so with focus inside a frame the
  // listeners above never fire and holding Shift did nothing whatsoever — no
  // chip, no microphone, nothing to report. voice-frame.js runs in every frame
  // and forwards the press through the worker (not postMessage, which a page
  // could forge to open the microphone unprompted).
  //
  // The frame has already applied the editable-element and modifier checks, in
  // the only document that can see its own focus — from up here activeElement is
  // just `IFRAME`, which tells us nothing about what is focused inside it.
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;

      if (msg.type === "JC_VOICE_FRAME_KEY") {
        if (msg.down) {
          clearTimeout(holdTimer);
          holdTimer = setTimeout(beginHold, HOLD_MS);
        } else {
          clearTimeout(holdTimer);
          endHold();
        }
        return;
      }

      // The extension lane's live echo, relayed from the offscreen recogniser.
      // Gated on the lane as well as the hold: the page lane runs its own
      // recogniser locally and its interim text must never be overwritten by a
      // slower one that has been through two message hops to get here.
      if (msg.type === "JC_VOICE_PARTIAL") {
        if (!holding || lane !== "extension") return;
        const text = String(msg.text || "").trim();
        if (text) showChip("hearing", text);
      }

      // The microphone's live level, for the stretch before any words arrive
      // (and for the machines where the offscreen recogniser never produces
      // them). The dot moves with the voice, so "Listening…" is demonstrably
      // listening rather than a hopeful caption. Words outrank the meter: once
      // the chip is in the "hearing" state this leaves it alone.
      if (msg.type === "JC_VOICE_LEVEL") {
        if (!holding || lane !== "extension") return;
        if (!chip || !chip.isConnected || chip.dataset.state !== "listening") return;
        chip.dataset.live = "1";
        const level = Math.max(0, Math.min(1, Number(msg.level) || 0));
        chip.style.setProperty("--jc-level", String(level));
      }
    });
  } catch (_) {}

  // A hold that loses the window would otherwise stay open with a live mic.
  window.addEventListener("blur", () => {
    clearTimeout(holdTimer);
    endHold();
  });

  Object.assign(globalThis, { jcVoiceHoldActive, jcVoiceChip });
})();
