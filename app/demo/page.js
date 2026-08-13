"use client";

// The /demo page: a narrative page wrapped around a guided, no-AI demo.
//
// Structure (top → bottom): hook/manifesto hero → interactive demo →
// "why free / private / open" story → technical deep-dive → CTA.
//
// Demo mechanics: the target phrase stands out (the rest of the article is
// dimmed). Click it → it "selects" (accent sweep) → the extension diamond pops
// up under it → click the diamond → the action row opens → pick an action →
// 1.2s loader → a pre-written answer. Every answer is canned; nothing calls a
// model. Auto-play drives the whole thing with a fake cursor and stops the
// moment you touch it.

import { useEffect, useRef, useState } from "react";

// The extension mints a fresh muted OKLCH accent every browser start
// (brand.js). The site does the same on every reload, from the same ranges, so
// the two surfaces read as one product. Server-rendered with the fixed value
// and re-minted after mount — a random colour during SSR would mismatch on
// hydration.
// Fallback accent if the layout's brand script hasn't set --accent (SSR/no-JS).
const ACCENT = "oklch(0.56 0.10 28)";
const STORE_URL = "https://chromewebstore.google.com/detail/justclarify/ggeikfbifbojgkgcehebpelplhajfffj";
const GITHUB_URL = "https://github.com/tomiwadoesux/JustClarify-Extension";

const DUO = {
  explain: '<circle cx="11" cy="11" r="7"/>',
  expand: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/>',
  define: '<path d="M12 6.5A3 3 0 0 0 9 4.5H3.5v13H9a3 3 0 0 1 3 2z"/>',
  eli5: '<circle cx="12" cy="9" r="5"/>',
  example: '<circle cx="12" cy="9" r="5"/>',
  factcheck: '<circle cx="12" cy="12" r="9"/>',
  textarea: '<rect x="3" y="4" width="18" height="16" rx="4"/>',
};
const FG = {
  explain: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4-4"/>',
  expand: '<path d="M14 5h5v5M19 5l-6 6M10 19H5v-5M5 19l6-6"/>',
  define:
    '<path d="M12 6.5V20M12 6.5A3 3 0 0 0 9 4.5H3.5v13H9a3 3 0 0 1 3 2M12 6.5A3 3 0 0 1 15 4.5h5.5v13H15a3 3 0 0 0-3 2"/>',
  eli5: '<path d="M9 18h6M10 21h4"/><path d="M8 14a5 5 0 1 1 8 0c-.8.7-1.5 1.4-1.7 2.5H9.7C9.5 15.4 8.8 14.7 8 14Z"/>',
  example:
    '<path d="M9 18h6M10 21h4"/><path d="M9 14a5 5 0 1 1 6 0c-.7.6-1.3 1.3-1.5 2.5h-3C10.3 15.3 9.7 14.6 9 14Z"/>',
  factcheck: '<circle cx="12" cy="12" r="9"/><path d="m8.4 12.2 2.4 2.4 4.8-5.2"/>',
  textarea: '<rect x="3" y="4" width="18" height="16" rx="4"/><path d="M7 9.5h10M7 13h10M7 16.5h6"/>',
};
function Icon({ name }) {
  const html =
    (DUO[name] ? `<g fill="currentColor" stroke="none" opacity="0.2">${DUO[name]}</g>` : "") +
    `<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${FG[name] || FG.explain}</g>`;
  return <svg viewBox="0 0 24 24" className="jcd-ico" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}

// Glyphs for the prose below the demo. Separate set from the action Icons
// above, because these stand for concepts (a key, a server, a dictionary), not
// for buttons the extension actually has. Nothing here should read as clickable.
const GLYPH = {
  cursor: '<path d="M5.5 3.5 18 11l-5.2 1.4 2.9 5.1-2.6 1.5-2.9-5.1L6.4 17z"/>',
  scroll: '<path d="M12 3.5v17M12 3.5 8.5 7M12 3.5 15.5 7M12 20.5 8.5 17M12 20.5 15.5 17"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2"/><path d="M12 1.8v3.2M12 19v3.2M1.8 12H5M19 12h3.2"/>',
  mic: '<rect x="9" y="2.8" width="6" height="10" rx="3"/><path d="M5.5 10.8a6.5 6.5 0 0 0 13 0M12 17.3v3.9"/><circle cx="19.2" cy="4.6" r="2.4"/>',
  cloud: '<path d="M17.4 19a4.5 4.5 0 0 0 .3-9 6 6 0 0 0-11.6 1.6A3.7 3.7 0 0 0 7 19z"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="2.2"/><path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3"/>',
  chat: '<path d="M20.5 14.5a3 3 0 0 1-3 3H8.6L4 20.8V6.5a3 3 0 0 1 3-3h10.5a3 3 0 0 1 3 3z"/>',
  key: '<circle cx="7.6" cy="12" r="3.9"/><path d="M11.5 12H21M18 12v3.4M14.8 12v2.6"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2.2"/><rect x="3" y="13" width="18" height="7" rx="2.2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  book: '<path d="M4 4.6A1.6 1.6 0 0 1 5.6 3H19.5v14.6H5.6A1.6 1.6 0 0 0 4 19.2z"/><path d="M4 19.2a1.6 1.6 0 0 1 1.6-1.6H19.5V21H5.6A1.6 1.6 0 0 1 4 19.4z"/>',
  brackets: '<path d="M8.5 3.6H5.4a1.4 1.4 0 0 0-1.4 1.4v14a1.4 1.4 0 0 0 1.4 1.4h3.1M15.5 3.6h3.1A1.4 1.4 0 0 1 20 5v14a1.4 1.4 0 0 1-1.4 1.4h-3.1"/><path d="M8.8 12h6.4"/>',
  layers: '<path d="m12 3 8.6 4.6L12 12.2 3.4 7.6z"/><path d="m4.4 12.6 7.6 4.1 7.6-4.1"/>',
  toggle: '<rect x="2.6" y="7" width="18.8" height="10" rx="5"/><circle cx="16.4" cy="12" r="2.9"/>',
  shield: '<path d="m12 3 7.4 2.9v5.4c0 4.5-3 8.1-7.4 9.4-4.4-1.3-7.4-4.9-7.4-9.4V5.9z"/><path d="m8.9 11.9 2.2 2.2 4-4.2"/>',
  badge: '<path d="m12 2.8 2.2 1.7 2.8-.3 1 2.6 2.4 1.6-1 2.6 1 2.6-2.4 1.6-1 2.6-2.8-.3L12 21.2l-2.2-1.7-2.8.3-1-2.6-2.4-1.6 1-2.6-1-2.6 2.4-1.6 1-2.6 2.8.3z"/><path d="m9.4 12.1 1.9 1.9 3.4-3.6"/>',
  lock: '<rect x="3.8" y="10" width="16.4" height="10.2" rx="2.6"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  code: '<path d="m8.8 7.5-5 4.5 5 4.5M15.2 7.5l5 4.5-5 4.5"/>',
  tag: '<path d="M12.4 3H21v8.6l-9.2 9.2a1.9 1.9 0 0 1-2.6 0l-6-6a1.9 1.9 0 0 1 0-2.6z"/><path d="M16.8 7.2h.01"/>',
  translate: '<path d="M3.4 5.8h9.2M8 3.6v2.2M10.6 5.8c0 4.2-3 7.9-7.2 9M6 9.4c1.1 2.5 3.2 4.4 5.8 5.2"/><path d="m12.6 20.4 4-9 4 9M14 17.4h5.2"/>',
  speaker: '<path d="M4 9.4h3.2L12 5.3v13.4L7.2 14.6H4z"/><path d="M15.4 9.6a4 4 0 0 1 0 4.8M18 7.2a7.4 7.4 0 0 1 0 9.6"/>',
  tabs: '<rect x="3" y="5" width="18" height="14" rx="2.4"/><path d="M3 9.6h7V5"/>',
  undo: '<path d="M4.2 9h9.3a5.6 5.6 0 0 1 0 11.2H8.4"/><path d="m8.2 4.8-4 4.2 4 4.2"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.6"/><path d="m20 20-4.6-4.6"/>',
};
function Glyph({ name }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="jcd-glyph"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: GLYPH[name] || GLYPH.target }}
    />
  );
}

// A real key cap. When the copy says "hold Shift", the Shift key should be on
// the page. Reading the word is slower than recognising the thing.
function Kbd({ children, sym }) {
  return (
    <kbd className="jcd-kbd">
      {sym && <span className="jcd-kbd-sym" aria-hidden="true">{sym}</span>}
      {children}
    </kbd>
  );
}

// A spoken phrase or a capability, as a pill you can take in without reading a
// sentence. `icon` picks from the demo's action set, `glyph` from the set above.
function Chip({ icon, glyph, children }) {
  return (
    <span className="jcd-chip">
      {icon ? <Icon name={icon} /> : <Glyph name={glyph} />}
      <span>{children}</span>
    </span>
  );
}

// The bar is paged exactly like the real extension: page one is Explain +
// Expand (Define joins when a single word is highlighted), the › arrow reveals
// Fact-check + Text area, then Example.
const ACTIONS = [
  { key: "explain", label: "Explain", icon: "explain", tag: "Explanation" },
  { key: "detailed", label: "Expand", icon: "expand", tag: "Expanded" },
  { key: "factcheck", label: "Fact-check", icon: "factcheck", tag: "Fact-check" },
  { key: "textarea", label: "Text area", icon: "textarea", tag: "Text area" },
  { key: "example", label: "Example", icon: "example", tag: "Example" },
];
const BAR_PAGES = [
  ["explain", "detailed"],
  ["factcheck", "textarea"],
  ["example"],
];

const ANSWERS = {
  explain: {
    paras: [
      "Here, “technical debt” means the hidden cost of the shortcuts the team took earlier in the code: quick fixes that made shipping faster then, but now make every new change slower and riskier.",
    ],
    key: "It isn't a real loan. It's a metaphor for work you'll have to pay back later, with interest.",
  },
  detailed: {
    paras: [
      "“Technical debt” describes what accumulates when a team repeatedly chooses the fast, expedient solution over the cleaner one. Each shortcut is small, but they compound: the code gets harder to read and every change ripples in unexpected ways.",
      "The team here is arguing the balance has grown so large it's now the main thing slowing feature work, which is why they refactor before piling on more.",
    ],
    key: "Left unpaid, technical debt turns a day's work into a week's, until progress crawls.",
  },
  example: {
    paras: [
      "Like paying only the minimum on a credit card: you get what you want now, but the balance keeps growing, interest and all, until it crowds out everything else.",
    ],
  },
  factcheck: {
    paras: [
      "Accurate as a description of a well-known engineering concept. “Technical debt” was coined by Ward Cunningham in 1992 and is widely used for the compounding cost of expedient code.",
    ],
    sources: [{ host: "wikipedia.org", title: "Technical debt: origin & definition" }],
    verdict: "True",
  },
};

// The Text area scratchpad. Every tool returns a genuinely different rewrite of
// the same rough paragraph, so clicking through them shows what each one is for.
const TA_ORIGINAL =
  "the team decided to refactor cuz the code was honestly a mess and it was slowing everything down so much, like every tiny change took forever";

const TA_TOOLS = [
  {
    key: "humanize",
    label: "Humanize",
    note: "Humanized. Same meaning, written like a person wrote it.",
    paras: [
      "The team chose to refactor: the codebase had become difficult to work in, and even small changes were taking far longer than they should.",
    ],
  },
  {
    key: "shorten",
    label: "Shorten",
    note: "Shortened. 24 words down to 11.",
    paras: ["The team refactored because the messy codebase was slowing every change down."],
  },
  {
    key: "expand",
    label: "Expand",
    note: "Expanded. The reasoning spelled out.",
    paras: [
      "The team decided to refactor because the codebase had grown genuinely messy over time. Shortcuts taken during earlier sprints had accumulated, and the structure no longer matched what the product actually needed.",
      "The cost showed up in velocity: even trivial changes required touching several places at once, so work that should have taken an hour stretched across a day. Refactoring first was the faster path to everything that came after.",
    ],
  },
  {
    key: "summarize",
    label: "Summarize",
    note: "Summarized. The points, nothing else.",
    bullets: [
      "The codebase had become messy.",
      "Every small change was taking far too long.",
      "The team refactored to fix it.",
    ],
  },
];

// The top stack: the tellme strip sitting on top of the sticky header, the two
// of them moving as one piece.
//
// The strip slides down rather than appearing, because a bar that is simply
// THERE on first paint reads as page furniture and gets skipped; one that
// arrives is read once. It arrives after a beat so it lands in an eye already
// on the page, rather than competing with the hero for the first frame.
//
// Then it behaves the way a phone toolbar does: scrolling DOWN is reading, so
// the strip gets out of the way and leaves the header pinned; scrolling UP is
// looking for something, so it comes back. That is why it is not simply left at
// the top of the document to scroll away once and never return: someone who
// scrolls back up after hitting a problem is exactly the person the strip is
// addressed to, and they should not have to reach the very top to find it.
//
// Mechanically it is one transform on one element. The stack is sticky at the
// top; hiding the strip means translating the whole stack up by exactly the
// strip's height, which parks the header at y=0 and the strip just above the
// viewport. No layout is animated, and the header never moves relative to the
// screen while collapsed.
//
// Dismissal is remembered forever. This is an announcement, not a cookie
// notice, and a bar that returns on every visit is a bar people learn to hate.
function DemoTopBar({ children }) {
  const [state, setState] = useState("hidden"); // hidden -> in -> out
  const [wantsCollapse, setWantsCollapse] = useState(false);
  const [measuredH, setMeasuredH] = useState(0);
  const stripRef = useRef(null);

  // Both derived rather than stored, so leaving or dismissing the strip cannot
  // leave a stale height or a collapsed stack with nothing in it to collapse.
  const stripH = state === "in" ? measuredH : 0;
  const collapsed = wantsCollapse && state === "in";

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("jcTellmeBannerDismissed") === "1";
    } catch (_) {}
    if (dismissed) return undefined;
    const timer = setTimeout(() => setState("in"), 650);
    return () => clearTimeout(timer);
  }, []);

  // Measured rather than assumed: the strip wraps to two lines on a narrow
  // screen, and a collapse distance that is off by a line either leaves a sliver
  // of colour under the header or eats into it. The observer fires once on
  // observe(), so the first measurement comes from it too.
  useEffect(() => {
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setMeasuredH(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [state]);

  // Direction, not position. The threshold keeps a trackpad's noise and the
  // rubber-band at the top of the page from flickering the strip in and out.
  useEffect(() => {
    if (state !== "in") return undefined;
    let last = window.scrollY;
    let frame = 0;
    const read = () => {
      frame = 0;
      const y = window.scrollY;
      // Above the fold the strip is where it belongs in the document anyway,
      // so it is always open there and there is nothing to slide.
      if (y <= stripH) setWantsCollapse(false);
      else if (y > last + 6) setWantsCollapse(true);
      else if (y < last - 6) setWantsCollapse(false);
      last = y;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [state, stripH]);

  function dismiss() {
    setState("out");
    try {
      localStorage.setItem("jcTellmeBannerDismissed", "1");
    } catch (_) {}
  }

  return (
    <div
      className={`jcd-stack${collapsed ? " is-collapsed" : ""}`}
      style={{ "--strip-h": `${stripH}px` }}
    >
      {state !== "hidden" && (
        <div
          ref={stripRef}
          className={`jcd-banner${state === "out" ? " is-out" : ""}`}
          role="status"
          // Unmounted once it has left, so the space it held goes back to the
          // page instead of sitting there as an invisible strip.
          onAnimationEnd={() => state === "out" && setState("hidden")}
        >
          <p className="jcd-banner-text">
            <strong>Something break?</strong> Tell us in your own words, and our agent writes the
            fix with you watching.
          </p>
          <a className="jcd-banner-link" href="/tellme">
            See the board
          </a>
          <button
            type="button"
            className="jcd-banner-x"
            onClick={dismiss}
            aria-label="Dismiss this message"
          >
            ×
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

export default function DemoPage() {
  // phase: idle → selected → open → loading → answer, plus 'textarea'
  const [phase, setPhase] = useState("idle");
  const [sel, setSel] = useState(null);
  const [auto, setAuto] = useState(false);
  const [mode, setMode] = useState("highlight");
  const [cursor, setCursor] = useState({ x: 0, y: 0, on: false, click: false });
  const [taTool, setTaTool] = useState(null); // which Text area tool has been applied
  const [taBusy, setTaBusy] = useState(false);
  const [barPage, setBarPage] = useState(0); // which page of the action bar is showing
  // Accent comes from the site-wide random OKLCH set on :root by the layout's
  // brand script (shared with the favicon + Safari status bar), via var(--accent).
  const [anchor, setAnchor] = useState(null); // {left, top} of the phrase's bottom, in stage coords
  const [stageMinH, setStageMinH] = useState(460); // stage grows to fit the floating popup so nothing clips
  const popRef = useRef(null);

  const runId = useRef(0);
  const stageRef = useRef(null);
  const phraseRef = useRef(null);
  const blobRef = useRef(null);
  const btnRefs = useRef({});
  const nextArrRef = useRef(null);
  const taBtnRefs = useRef({});
  const taTimer = useRef(null);

  // ---- cursor helpers (coords relative to the stage) ----
  function pointAt(el) {
    const stage = stageRef.current;
    if (!stage || !el) return;
    const s = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setCursor((c) => ({ ...c, x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2, on: true }));
  }
  // Park the cursor at one edge of an element — used to drag-select the phrase
  // from its start to its end rather than teleporting to the middle of it.
  function pointAtEdge(el, edge) {
    const stage = stageRef.current;
    if (!stage || !el) return;
    const s = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setCursor((c) => ({
      ...c,
      x: (edge === "start" ? r.left : r.right) - s.left,
      y: r.top - s.top + r.height / 2,
      on: true,
    }));
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Anchor the popup to the bottom-left of the highlighted phrase, the way the
  // extension anchors to the selection rect — but clamped so the popup (which
  // is also pinned to the stage's right edge in CSS) always fits. Re-measured
  // on select + resize.
  function measureAnchor() {
    const stage = stageRef.current;
    const ph = phraseRef.current;
    if (!stage || !ph) return;
    const s = stage.getBoundingClientRect();
    const r = ph.getBoundingClientRect();
    const pad = 12;
    const panelW = Math.min(380, s.width - pad * 2); // the popup never exceeds the stage
    const maxLeft = Math.max(pad, s.width - pad - panelW);
    setAnchor({
      left: Math.max(pad, Math.min(Math.round(r.left - s.left), maxLeft)),
      top: Math.round(r.bottom - s.top + 7),
    });
  }
  useEffect(() => {
    const onResize = () => measureAnchor();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The popup floats (absolute), so grow the "browser window" to contain it —
  // otherwise a tall answer (Expand) gets clipped by the stage's overflow.
  useEffect(() => {
    if (phase === "idle") return setStageMinH(440);
    if (phase === "textarea") return setStageMinH(480);
    const id = requestAnimationFrame(() => {
      const stage = stageRef.current;
      const pop = popRef.current;
      if (!stage || !pop) return;
      const s = stage.getBoundingClientRect();
      const p = pop.getBoundingClientRect();
      setStageMinH(Math.max(440, Math.round(p.bottom - s.top + 28)));
    });
    return () => cancelAnimationFrame(id);
  }, [phase, sel, anchor, taTool, taBusy, mode]);

  function resetAll() {
    setPhase("idle");
    setSel(null);
    setBarPage(0);
    setTaTool(null);
    setTaBusy(false);
    clearTimeout(taTimer.current);
    setCursor((c) => ({ ...c, on: false, click: false }));
  }

  // ---- Text area: every tool rewrites the same original ----
  function runTool(key) {
    clearTimeout(taTimer.current);
    setTaBusy(true);
    taTimer.current = setTimeout(() => {
      setTaTool(key);
      setTaBusy(false);
    }, 750);
  }
  function onTool(key) {
    if (auto) stopAuto();
    if (key === taTool) return;
    runTool(key);
  }
  function onToolReset() {
    if (auto) stopAuto();
    clearTimeout(taTimer.current);
    setTaBusy(false);
    setTaTool(null);
  }

  // ---- manual interactions (any touch cancels auto-play) ----
  function stopAuto() {
    runId.current += 1;
    setAuto(false);
    setCursor((c) => ({ ...c, on: false }));
  }
  function onPhrase() {
    if (auto) stopAuto();
    if (phase === "idle") {
      measureAnchor();
      setPhase("selected");
    }
  }
  function onBlob() {
    if (auto) stopAuto();
    if (phase === "selected") {
      setBarPage(0);
      setPhase("open");
    }
  }
  function pick(key) {
    if (!auto && phase === "loading") return;
    if (key === "textarea") {
      // Text area takes over the whole surface, like the real extension.
      clearTimeout(taTimer.current);
      setSel(null);
      setTaTool(null);
      setTaBusy(false);
      setPhase("textarea");
      return;
    }
    setSel(key);
    setPhase("loading");
    const myTick = ++runId.current;
    setTimeout(() => {
      if (runId.current === myTick) setPhase("answer");
    }, 1200);
  }
  function onPick(key) {
    if (auto) stopAuto();
    pick(key);
  }
  function onBarPage(delta) {
    if (auto) stopAuto();
    setBarPage((p) => Math.min(BAR_PAGES.length - 1, Math.max(0, p + delta)));
  }

  // ---- auto-play: drives the whole flow on a loop ----
  async function runAuto() {
    const my = ++runId.current;
    const alive = () => runId.current === my;
    setAuto(true);
    resetAll();
    await wait(600);
    if (!alive()) return;

    // Drag-select the phrase: land the cursor at its start, press, sweep to the
    // end. The highlight wipe is timed to travel with the cursor, so it reads
    // as the cursor doing the highlighting rather than a hover.
    pointAtEdge(phraseRef.current, "start");
    await wait(520);
    if (!alive()) return;
    setCursor((c) => ({ ...c, click: true }));
    await wait(140);
    if (!alive()) return;
    setPhase("selecting");
    measureAnchor();
    pointAtEdge(phraseRef.current, "end");
    await wait(560);
    if (!alive()) return;
    setCursor((c) => ({ ...c, click: false }));
    await wait(180);
    if (!alive()) return;

    setPhase("selected"); // diamond drops in
    await wait(180);
    pointAt(blobRef.current);
    await wait(750);
    if (!alive()) return;

    clickPulse();
    await wait(320);
    if (!alive()) return;
    setBarPage(0);
    setPhase("open");
    setSel(null);
    await wait(750);
    if (!alive()) return;

    // Walk the bar the way a person would: Explain on page one, then the ›
    // arrow to page two for Fact-check — and Text area sits right beside it,
    // which is where the tour goes next.
    for (const [pageIdx, key] of [[0, "explain"], [1, "factcheck"]]) {
      if (!alive()) return;
      if (pageIdx > 0) {
        pointAt(nextArrRef.current);
        await wait(550);
        if (!alive()) return;
        clickPulse();
        await wait(200);
        setBarPage(pageIdx);
        await wait(450);
        if (!alive()) return;
      }
      pointAt(btnRefs.current[key]);
      await wait(600);
      if (!alive()) return;
      clickPulse();
      await wait(200);
      setSel(key);
      setPhase("loading");
      await wait(1200);
      if (!alive()) return;
      setPhase("answer");
      await wait(2200);
      if (!alive()) return;
    }

    // Text area is the neighbour of Fact-check on page two — click it there.
    pointAt(btnRefs.current.textarea);
    await wait(650);
    if (!alive()) return;
    clickPulse();
    await wait(250);

    // The Text area — a second thing JustClarify does. Walk three of the four
    // tools so the differences between them are visible.
    setPhase("textarea");
    setTaTool(null);
    setTaBusy(false);
    setCursor((c) => ({ ...c, on: false }));
    await wait(800);
    if (!alive()) return;

    for (const key of ["humanize", "summarize", "shorten"]) {
      if (!alive()) return;
      pointAt(taBtnRefs.current[key]);
      await wait(650);
      if (!alive()) return;
      clickPulse();
      await wait(220);
      setTaBusy(true);
      await wait(750);
      if (!alive()) return;
      setTaTool(key);
      setTaBusy(false);
      await wait(2400);
      if (!alive()) return;
    }

    if (alive()) runAuto(); // loop
  }
  function clickPulse() {
    setCursor((c) => ({ ...c, click: true }));
    setTimeout(() => setCursor((c) => ({ ...c, click: false })), 260);
  }
  function toggleAuto() {
    if (auto) {
      stopAuto();
      resetAll();
    } else {
      runAuto();
    }
  }

  function chooseMode(nextMode) {
    if (auto) stopAuto();
    resetAll();
    setMode(nextMode);
  }

  const answer = sel ? ANSWERS[sel] : null;
  const action = sel ? ACTIONS.find((a) => a.key === sel) : null;
  const showRow = phase === "open" || phase === "loading" || phase === "answer";
  const showBlob = phase === "selecting" || phase === "selected";

  const caption =
    phase === "idle"
      ? "Click the highlighted phrase to select it, like you would while reading."
      : phase === "selecting" || phase === "selected"
        ? "Selected. The JustClarify diamond appears. Click it to open."
        : phase === "open"
          ? "Explain and Expand come first. The › arrow holds Fact-check, the Text area, and Example."
          : phase === "loading"
            ? "Reading the sentence around your highlight…"
            : phase === "textarea"
              ? "The Text area: paste anything and reshape it. Humanize, shorten, expand, summarize."
              : "You never left the page. In the real extension this is generated on-device in ~1 second.";

  return (
    <main className="jcd-root" style={{ "--a": `var(--accent, ${ACCENT})` }}>
      <style>{CSS.replace(/__ACCENT__/g, ACCENT)}</style>

      <DemoTopBar>
        <header className="jcd-top">
          <a href="/" className="jcd-brand">
            <span className="jcd-mark" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="5" width="14" height="14" rx="3.5" transform="rotate(45 12 12)" fill="currentColor" />
                <rect x="9" y="9" width="6" height="6" rx="1.6" transform="rotate(45 12 12)" fill="#fff" />
              </svg>
            </span>
            <span className="jcd-brand-name">JustClarify</span>
          </a>
          <div className="jcd-top-right">
            <a className="jcd-top-gh" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              Source
            </a>
            <a className="jcd-top-cta" href={STORE_URL} target="_blank" rel="noopener noreferrer">
              Add to Chrome · Free
            </a>
          </div>
        </header>
      </DemoTopBar>

      {/* ── 1 · The hook ─────────────────────────────────────────────── */}
      <section className="jcd-hero">
        <p className="jcd-eyebrow">Free · On-device · Open source</p>
        <h1>
          You should never have to pay
          <br className="jcd-br" /> to understand something.
        </h1>
        <div className="jcd-hero-copy">
          <p>
            Every day you read things you only half-understand: a term, a claim, a paragraph that
            quietly assumes you know more than you do. The web has one fix for this, and it&apos;s a
            detour: open a tab, paste into a chatbot, lose your place. Or pay $10 a month for a
            sidebar that does the pasting for you.
          </p>
          <p>
            JustClarify&apos;s on-device engine and <b>Your LLM</b> option are free. Want a cloud
            model? Bring your own API key (BYOK), or choose the optional hosted engine: 30 asks
            free, then $3.99 a month. It never switches you there without you choosing it.
          </p>
          <p className="jcd-hero-kicker">
            Here&apos;s the alternative. Highlight a phrase, or speak about anything in the article.
          </p>
        </div>
      </section>

      {/* ── 2 · The demo ─────────────────────────────────────────────── */}
      <section className="jcd-demo" id="demo">
        <div className="jcd-demo-head">
          <div className="jcd-mode-switch" role="tablist" aria-label="Choose a demo mode">
            <button type="button" role="tab" aria-selected={mode === "highlight"} className={"jcd-mode" + (mode === "highlight" ? " is-on" : "")} onClick={() => chooseMode("highlight")}>
              Highlight
            </button>
            <button type="button" role="tab" aria-selected={mode === "voice"} className={"jcd-mode" + (mode === "voice" ? " is-on" : "")} onClick={() => chooseMode("voice")}>
              Voice control
            </button>
          </div>
          {mode === "highlight" && <button type="button" className={"jcd-auto" + (auto ? " on" : "")} onClick={toggleAuto}>
            {auto ? "■ Stop" : "▶ Watch it drive itself"}
          </button>}
        </div>

        <div className="jcd-stage" ref={stageRef} style={{ minHeight: stageMinH }} role="figure" aria-label="A webpage with JustClarify">
          <div className="jcd-fakebar">
            <i /><i /><i />
            <span>a-long-article-you&apos;re-reading.com</span>
          </div>

          {mode === "voice" ? <VoiceDemo /> : phase === "textarea" ? (
            <TextArea
              tool={taTool}
              busy={taBusy}
              onTool={onTool}
              onReset={onToolReset}
              taBtnRefs={taBtnRefs}
            />
          ) : (
            <>
              <article className="jcd-article">
                <h2>Why the team hit pause before the release</h2>
                <p>
                  Late in the sprint, the engineers made an unusual call. Rather than cram in one more
                  feature, they chose to refactor the legacy module first, arguing that the{" "}
                  <mark
                    ref={phraseRef}
                    className={
                      "jcd-hl" +
                      (phase === "selecting" || phase === "selected" || showRow ? " is-sel" : "") +
                      (phase === "idle" ? " is-live" : "")
                    }
                    onClick={onPhrase}
                    role="button"
                    tabIndex={0}
                  >
                    technical debt
                  </mark>{" "}
                  had grown untenable, and was quietly slowing every new change to a crawl.
                </p>
                <p className="jcd-dim">
                  Nobody outside the team could see it, but each shortcut taken months earlier was now
                  taxing everything built on top of it.
                </p>
              </article>

              <div
                ref={popRef}
                className="jcd-pop"
                style={anchor ? { left: anchor.left, top: anchor.top } : { left: 28, top: 190 }}
              >
                {showBlob && (
                  <button ref={blobRef} className="jcd-blob" type="button" onClick={onBlob} aria-label="Open JustClarify">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                      <rect x="5" y="5" width="14" height="14" rx="3.5" transform="rotate(45 12 12)" fill="currentColor" />
                      <rect x="9" y="9" width="6" height="6" rx="1.6" transform="rotate(45 12 12)" fill="#fff" />
                    </svg>
                    {phase === "selected" && !auto && <span className="jcd-blob-hint">Click me</span>}
                  </button>
                )}

                {showRow && (
                  <>
                    <div className="jcd-row">
                      <button
                        className="jcd-row-arr"
                        type="button"
                        disabled={barPage === 0}
                        onClick={() => onBarPage(-1)}
                        aria-label="Previous actions"
                      >
                        <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
                      </button>
                      {BAR_PAGES[barPage].map((k) => {
                        const a = ACTIONS.find((x) => x.key === k);
                        return (
                          <button
                            key={a.key}
                            ref={(el) => (btnRefs.current[a.key] = el)}
                            className={"jcd-btn" + (sel === a.key ? " is-sel" : "")}
                            onClick={() => onPick(a.key)}
                            type="button"
                          >
                            <span className="jcd-btn-ico">
                              <Icon name={a.icon} />
                            </span>
                            <span className="jcd-btn-label">{a.label}</span>
                            <span className="jcd-diamond" aria-hidden="true" />
                          </button>
                        );
                      })}
                      <button
                        ref={nextArrRef}
                        className="jcd-row-arr"
                        type="button"
                        disabled={barPage === BAR_PAGES.length - 1}
                        onClick={() => onBarPage(1)}
                        aria-label="More actions"
                      >
                        <svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
                      </button>
                    </div>

                    {sel && (
                      <div className="jcd-panel">
                        <div className="jcd-panel-head">“technical debt”</div>
                        <div className="jcd-rule" />
                        {phase === "loading" ? (
                          <div className="jcd-skel" aria-label="loading">
                            <span style={{ width: "97%" }} />
                            <span style={{ width: "100%" }} />
                            <span style={{ width: "72%" }} />
                          </div>
                        ) : (
                          <>
                            <span className="jcd-tag" style={{ color: "var(--a)" }}>
                              <Icon name={action.icon} />
                              <span>{action.tag}</span>
                              {answer.verdict && <em className="jcd-verdict">· {answer.verdict}</em>}
                            </span>
                            <div className="jcd-answer">
                              {answer.paras.map((p, i) => (
                                <p key={i} className="jcd-para">{p}</p>
                              ))}
                              {answer.key && <div className="jcd-key">{answer.key}</div>}
                              {answer.sources && (
                                <ol className="jcd-srcs">
                                  {answer.sources.map((s, i) => (
                                    <li key={i}>
                                      <span className="jcd-src-host">{s.host}</span>
                                      <span className="jcd-src-title">{s.title}</span>
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {/* fake cursor for auto-play */}
          <span
            className={"jcd-cursor" + (cursor.on ? " on" : "") + (cursor.click ? " click" : "")}
            style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
            aria-hidden="true"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M5 3l14 8-6 1.6L9.5 19 5 3z" fill="#141414" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </span>
        </div>

        <p className="jcd-caption">{mode === "voice" ? "Voice control listens for a question about the page, finds the relevant text, and answers in place." : caption}</p>
        <p className="jcd-fine">
          {mode === "voice"
            ? "This voice demo is scripted. It does not use your microphone or send audio anywhere."
            : auto
            ? "Auto-play is running. Click anything to take over."
            : "This demo is scripted. Every answer is pre-written and no AI is called. The real extension generates them live, on the engine you picked."}
        </p>
      </section>

      {/* ── 3 · The turn: why it can be free ─────────────────────────── */}
      <section className="jcd-turn">
        <p>
          We think the subscription model is backwards.{" "}
          <b className="jcd-hi">The intelligence already lives on your machine</b>. Chrome now
          ships an AI model inside the browser itself, and if that isn&apos;t enough you almost
          certainly already pay for ChatGPT, Claude or Gemini. Either way the answer can cost
          nothing extra, need no account, and never send a word of what you&apos;re reading to a
          server of ours. So that&apos;s what we built. Then we{" "}
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">open-sourced all of it</a>,
          so you don&apos;t have to take our word for any of this.
        </p>
        <p className="jcd-turn-kicker">
          Highlight a phrase, or ask about the page out loud. Read the answer where you stand. Keep going.
        </p>
      </section>

      {/* ── 4 · The convictions ──────────────────────────────────────── */}
      <section className="jcd-creed">
        <div className="jcd-creed-item">
          <span className="jcd-creed-ico" aria-hidden="true"><Glyph name="tag" /></span>
          <h3><span className="jcd-creed-n">01</span>Free where it costs us nothing.</h3>
          <div className="jcd-chips">
            <Chip glyph="chip">Device · Free forever</Chip>
            <Chip glyph="chat">Your LLM · Based on your subscription</Chip>
            <Chip glyph="key">BYOK · You pay your provider, not us</Chip>
            <Chip glyph="cloud">Hosted · 30 asks free, then $3.99/mo</Chip>
          </div>
          <p>
            Tools like this charge a subscription because every answer costs them server money.
            Three of the four ways JustClarify can answer cost us nothing: your computer&apos;s own
            model, the chatbot subscription you already pay for, or your own API key going straight
            to Anthropic, OpenAI or Google. Those are{" "}
            <span className="jcd-hi">free, forever, with no account and no credit counter</span>.
            Only the hosted engine runs on our hardware, so only the hosted engine costs money. You
            pick; nothing switches to a paid one behind your back.
          </p>
        </div>
        <div className="jcd-creed-item">
          <span className="jcd-creed-ico" aria-hidden="true"><Glyph name="lock" /></span>
          <h3><span className="jcd-creed-n">02</span>Private by architecture, up to the line you draw.</h3>
          <p>
            On the on-device engine, what you highlight never touches our servers, because{" "}
            <span className="jcd-hi">there are no servers in the loop</span>. The model runs on
            your machine and airplane mode works. Choose the hosted engine and your text goes to our
            server to be answered, because that is the only way that engine can exist. Fact-checks
            always send the claim and the article&apos;s URL, so an article is checked once and the
            verdict is served to everyone after you. The engine badge on every answer tells you
            which of those just happened, and the <a href="/privacy-policy">privacy policy</a>{" "}
            spells out the rest.
          </p>
        </div>
        <div className="jcd-creed-item">
          <span className="jcd-creed-ico" aria-hidden="true"><Glyph name="code" /></span>
          <h3><span className="jcd-creed-n">03</span>Open source, so trust is optional.</h3>
          <p>
            The entire extension is{" "}
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">public code</a>. Every
            answer is badged with the exact engine and model that wrote it, and fact-checks only
            return a verdict with a source you can click.{" "}
            <span className="jcd-hi">If we ever break these rules, you&apos;ll see it in the diff.</span>
          </p>
        </div>
      </section>

      {/* ── 5 · Voice ────────────────────────────────────────────────── */}
      <section className="jcd-tech">
        <p className="jcd-eyebrow">Also, without touching anything</p>
        <h2>
          Hold <Kbd sym="⇧">Shift</Kbd> and say it instead
        </h2>
        <p className="jcd-tech-lead">
          Highlighting is one way in. The other is speaking: hold <Kbd sym="⇧">Shift</Kbd>, say what
          you want, let go.{" "}
          <span className="jcd-hi">Releasing the key is what ends the turn</span>. No wake word, no
          open microphone, and nothing is ever captured unless a key is physically held down.
        </p>
        <ol className="jcd-pipe">
          <li>
            <span className="jcd-pipe-ico" aria-hidden="true"><Glyph name="cursor" /></span>
            <b>It does the same things your mouse does.</b> Every spoken verb ends in the exact
            function a click already reaches, so the two ways in can never drift apart.
            <span className="jcd-chips">
              <Chip icon="explain">&ldquo;Explain this&rdquo;</Chip>
              <Chip icon="factcheck">&ldquo;Fact-check that&rdquo;</Chip>
              <Chip icon="define">&ldquo;Define quantitative easing&rdquo;</Chip>
              <Chip glyph="translate">&ldquo;Translate it&rdquo;</Chip>
              <Chip glyph="speaker">&ldquo;Read it to me&rdquo;</Chip>
            </span>
          </li>
          <li>
            <span className="jcd-pipe-ico" aria-hidden="true"><Glyph name="scroll" /></span>
            <b>And the things your mouse is slower at.</b> About sixty phrases, all of them things
            you were going to do anyway.
            <span className="jcd-chips">
              <Chip glyph="search">&ldquo;Take me to the pricing bit&rdquo;</Chip>
              <Chip glyph="scroll">&ldquo;Keep scrolling, wait, back&rdquo;</Chip>
              <Chip glyph="tabs">&ldquo;Next tab&rdquo;</Chip>
              <Chip glyph="cursor">&ldquo;Click the sign-up button&rdquo;</Chip>
              <Chip glyph="undo">&ldquo;Undo that&rdquo;</Chip>
            </span>
          </li>
          <li>
            <span className="jcd-pipe-ico" aria-hidden="true"><Glyph name="target" /></span>
            <b>&quot;This&quot; means what you&apos;d expect it to mean.</b> Say &quot;explain
            this&quot; with nothing selected and it resolves the most recent thing you could
            plausibly have meant (your last highlight, the paragraph under your cursor, the thing
            you just asked about) as a real selection, so the answer arrives exactly where a click
            would have put it.
          </li>
          <li>
            <span className="jcd-pipe-ico" aria-hidden="true"><Glyph name="mic" /></span>
            <b>Two microphones, because one of them can be switched off.</b> Speech recognition runs
            in the page when the site allows it. Plenty of sites don&apos;t. A page can disable the
            microphone outright, and http:// pages have none at all. So the extension can hold one
            grant on its own origin and record there instead, which no website can veto.{" "}
            <span className="jcd-hi">You grant it once and never see a permission prompt again.</span>
          </li>
          <li>
            <span className="jcd-pipe-ico" aria-hidden="true"><Glyph name="cloud" /></span>
            <b>Voice needs the hosted engine.</b> <span className="jcd-pill">Paid engine</span>{" "}
            Turning a sentence into the right action is a harder job than explaining a paragraph,
            and it&apos;s the one part that doesn&apos;t run on Chrome&apos;s built-in model yet.
            Explaining, defining and fact-checking stay free on your own hardware.
          </li>
        </ol>
      </section>

      {/* ── 6 · The technical part, at the bottom on purpose ─────────── */}
      <section className="jcd-tech">
        <p className="jcd-eyebrow">For the curious</p>
        <h2>How a highlight becomes an answer</h2>
        <p className="jcd-tech-lead">
          No magic, and no hidden backend. The one server we do run is named below. Here is the
          actual pipeline, straight from the source code:
        </p>
        <ol className="jcd-pipe jcd-pipe-steps">
          <li>
            <span className="jcd-pipe-ico" aria-hidden="true"><Glyph name="brackets" /></span>
            <b>It reads around your selection, not just your selection.</b> When you highlight, the
            content script walks outward through the surrounding text and captures a{" "}
            <i>semantic window</i>: about two full sentences on each side for Explain, up to six for
            Expand. That&apos;s why answers fit the article you&apos;re in, not a dictionary&apos;s
            idea of the phrase.
          </li>
          <li>
            <span className="jcd-pipe-ico" aria-hidden="true"><Glyph name="layers" /></span>
            <b>The prompt is assembled on the page.</b> Your selection, the surrounding passage, the
            page title, the action you picked, and your density setting are built into a single prompt
            locally, inside the tab.{" "}
            <span className="jcd-hi">At this point, nothing has been sent anywhere.</span>
          </li>
          <li>
            <span className="jcd-pipe-ico" aria-hidden="true"><Glyph name="toggle" /></span>
            <b>Then you choose who answers it.</b> Four ways to answer, picked in the popup, never
            switched behind your back:
            <span className="jcd-engines">
              <span className="jcd-engine">
                <span className="jcd-engine-ico" aria-hidden="true"><Glyph name="chip" /></span>
                <span className="jcd-engine-body">
                  <span className="jcd-engine-h">
                    <span className="jcd-engine-name">Device</span>
                    <span className="jcd-pill jcd-pill-soft">Free</span>
                  </span>
                  Chrome&apos;s built-in Prompt API, Gemini Nano, running on your own hardware.
                  Chrome downloads that model once; JustClarify asks first and shows the progress
                  rather than hanging on a silent spinner. After that, answers stream in with no
                  network round-trip at all.
                  <span className="jcd-specs">
                    <span>~4GB one-time download</span>
                    <span>~16GB RAM</span>
                    <span>22GB free</span>
                    <span>Works offline</span>
                  </span>
                </span>
              </span>
              <span className="jcd-engine">
                <span className="jcd-engine-ico" aria-hidden="true"><Glyph name="chat" /></span>
                <span className="jcd-engine-body">
                  <span className="jcd-engine-h">
                    <span className="jcd-engine-name">Your LLM</span>
                    <span className="jcd-pill jcd-pill-soft">Based on your subscription</span>
                  </span>
                  The chat subscription you already pay for. JustClarify opens one tab of its own,
                  parked in a collapsed group at the edge of the tab strip, asks ChatGPT, Claude or
                  Gemini there, and reads the answer back. It never touches a tab you opened or a
                  conversation you were having, and it costs nothing beyond the plan you already
                  hold.
                  <span className="jcd-specs">
                    <span>ChatGPT</span>
                    <span>Claude</span>
                    <span>Gemini</span>
                    <span>No extra bill</span>
                  </span>
                </span>
              </span>
              <span className="jcd-engine">
                <span className="jcd-engine-ico" aria-hidden="true"><Glyph name="key" /></span>
                <span className="jcd-engine-body">
                  <span className="jcd-engine-h">
                    <span className="jcd-engine-name">BYOK</span>
                    <span className="jcd-pill jcd-pill-soft">You pay your provider, not us</span>
                  </span>
                  Bring your own API key. Paste a key from Anthropic, OpenAI, Google, Hugging Face
                  or an AI Gateway, and the request goes straight from the extension to that
                  company. The key is stored on your device, no JustClarify server sits in the
                  middle, and we never see it or bill you for anything.
                  <span className="jcd-specs">
                    <span>Anthropic</span>
                    <span>OpenAI</span>
                    <span>Google Gemini</span>
                    <span>Hugging Face</span>
                    <span>AI Gateway</span>
                  </span>
                </span>
              </span>
              <span className="jcd-engine">
                <span className="jcd-engine-ico" aria-hidden="true"><Glyph name="cloud" /></span>
                <span className="jcd-engine-body">
                  <span className="jcd-engine-h">
                    <span className="jcd-engine-name">Hosted</span>
                    <span className="jcd-pill">30 asks free, then $3.99/mo</span>
                  </span>
                  Our model on our server, for machines that can&apos;t run a local one and for
                  people who would rather not manage a key at all. This is the only one of the four
                  where your text leaves your machine for us, and the only one that costs money.
                  <span className="jcd-specs">
                    <span>No setup</span>
                    <span>Voice control included</span>
                  </span>
                </span>
              </span>
            </span>
          </li>
          <li>
            <span className="jcd-pipe-ico" aria-hidden="true"><Glyph name="book" /></span>
            <b>Definitions don&apos;t go to a model at all.</b> Highlight a single word and Define
            queries a real dictionary (the free, keyless Dictionary API) for the actual entry:
            part of speech, senses, and the dictionary&apos;s own example sentence.{" "}
            <span className="jcd-hi">A definition is a lookup, not a generation.</span> Only words
            with no entry (jargon, proper nouns, coinages) fall back to a contextual explanation.
          </li>
          <li>
            <span className="jcd-pipe-ico" aria-hidden="true"><Glyph name="key" /></span>
            <b>BYOK: your key, your models, your bill.</b> Flip on &quot;use your own AI key&quot;
            in settings, paste a key from Anthropic, OpenAI, Google, Hugging Face or an AI Gateway,
            and the same prompt goes straight from the extension to that company. JustClarify reads
            the prefix to know whose key it is and picks a sensible model unless you name one.{" "}
            <span className="jcd-hi">
              The key is stored on your device and sent only to the company it belongs to.
            </span>{" "}
            No JustClarify server sits in between, we never see the key, and we never charge you a
            cent for using it.
          </li>
          <li>
            <span className="jcd-pipe-ico" aria-hidden="true"><Glyph name="server" /></span>
            <b>Without a key, the hosted model. It is a real server.</b>{" "}
            <span className="jcd-pill">30 asks free, then $3.99/mo</span> Machines that can&apos;t
            run Gemini Nano used to install this and get nothing. Now the prompt goes to
            justclarify.xyz, which holds our API key server-side (a key shipped inside an extension
            is a zip file anyone can unpack) and streams the answer back. It is last in the chain
            because it is the only tier that costs us money and the only one where your text leaves
            your machine for us.
          </li>
          <li>
            <span className="jcd-pipe-ico" aria-hidden="true"><Glyph name="shield" /></span>
            <b>Fact-checks are shared, on purpose.</b> A claim and the page&apos;s URL go to our
            cache, which checks that article against published rulings once and serves the result to
            everyone who reads it after you. It&apos;s the one part of the product that gets better
            because other people used it, and{" "}
            <span className="jcd-hi">the one place a URL you visited is stored</span>. Verdicts come
            back with a source you can click, or they don&apos;t come back at all.
          </li>
          <li>
            <span className="jcd-pipe-ico" aria-hidden="true"><Glyph name="badge" /></span>
            <b>The badge never lies.</b> Every answer is stamped with the engine and the model that
            produced it, so a reply from your own hardware, from your chat subscription and from our
            server can never be mistaken for each other.{" "}
            <span className="jcd-hi">
              If you want to know where a sentence came from, it&apos;s written on the sentence.
            </span>
          </li>
        </ol>
      </section>

      {/* ── 6 · Close ────────────────────────────────────────────────── */}
      <section className="jcd-close">
        <p className="jcd-thesis">
          The web ships one version of every page to everyone. JustClarify recompiles it for what{" "}
          <i>you</i> already know.
        </p>
        <div className="jcd-close-row">
          <a className="jcd-cta" href={STORE_URL} target="_blank" rel="noopener noreferrer">
            Add it to Chrome · Free
          </a>
          <a className="jcd-cta-ghost" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            Read the source
          </a>
        </div>
      </section>
    </main>
  );
}

function TextArea({ tool, busy, onTool, onReset, taBtnRefs }) {
  const active = tool ? TA_TOOLS.find((t) => t.key === tool) : null;

  return (
    <div className="jcd-ta">
      <div className="jcd-ta-tools">
        <span className="jcd-ta-title">Text area</span>
        {active && (
          <button className="jcd-ta-reset" type="button" onClick={onReset}>
            ↺ Original
          </button>
        )}
        <span className="jcd-ta-dots"><i /><i /><i /></span>
      </div>

      {/* Once a tool has run, the rough draft stays above the result so the
          rewrite is legible as a change, not just new text. */}
      {active && (
        <div className="jcd-ta-before">
          <span className="jcd-ta-before-tag">Your text</span>
          {TA_ORIGINAL}
        </div>
      )}

      <div className={"jcd-ta-body" + (busy ? " is-busy" : "")}>
        {busy ? (
          <div className="jcd-skel" aria-label="rewriting">
            <span style={{ width: "94%" }} />
            <span style={{ width: "100%" }} />
            <span style={{ width: "61%" }} />
          </div>
        ) : active ? (
          <>
            {active.bullets ? (
              <ul className="jcd-ta-bullets">
                {active.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : (
              active.paras.map((p, i) => (
                <p key={i} className="jcd-ta-para">{p}</p>
              ))
            )}
          </>
        ) : (
          TA_ORIGINAL
        )}
      </div>

      <div className="jcd-ta-actions">
        {TA_TOOLS.map((t) => (
          <button
            key={t.key}
            ref={(el) => (taBtnRefs.current[t.key] = el)}
            className={"jcd-ta-btn" + (tool === t.key ? " is-on" : "")}
            onClick={() => onTool(t.key)}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>

      {active && !busy && (
        <div className="jcd-ta-out">
          <span className="jcd-ta-out-btn">Copy</span>
          <span className="jcd-ta-out-btn">Markdown</span>
          <span className="jcd-ta-out-btn">PDF</span>
        </div>
      )}

      <p className="jcd-ta-note">
        {busy
          ? "Rewriting…"
          : active
            ? `${active.note}  ·  Try another tool. It always rewrites your original.`
            : "Paste rough text, pick a tool, and it rewrites in place. Try all four."}
      </p>
    </div>
  );
}

function VoiceDemo() {
  const [state, setState] = useState("ready");
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [spoken, setSpoken] = useState("");
  const timers = useRef([]);
  const scenario = VOICE_SCENARIOS[scenarioIndex];

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => () => clearTimers(), []);

  function runVoiceDemo() {
    clearTimers();
    setState("listening");
    setSpoken("");
    const words = scenario.question.split(" ");
    words.forEach((_, index) => {
      timers.current.push(setTimeout(() => setSpoken(words.slice(0, index + 1).join(" ")), 260 * (index + 1)));
    });
    timers.current.push(setTimeout(() => {
      setState("heard");
      timers.current.push(setTimeout(() => {
        setState("answer");
      }, 1050));
    }, 260 * words.length + 650));
  }

  function nextQuestion() {
    clearTimers();
    setScenarioIndex((index) => (index + 1) % VOICE_SCENARIOS.length);
    setSpoken("");
    setState("ready");
  }

  return (
    <div className="jcd-voice" aria-live="polite">
      <article className="jcd-article jcd-voice-article">
        <h2>Why the team hit pause before the release</h2>
        <p>
          Late in the sprint, the engineers <mark className={"jcd-hl" + (scenario.target === "pause" && (state === "heard" || state === "answer") ? " is-sel" : "")}>hit pause before the release</mark>. Rather than cram in one more
          feature, they chose to refactor the legacy module first, arguing that the{" "}
          <mark className={"jcd-hl" + (scenario.target === "debt" && (state === "heard" || state === "answer") ? " is-sel" : "")}>
            technical debt
          </mark>{" "}
          had grown untenable, and was quietly slowing every new change to a crawl.
        </p>
        <p>Nobody outside the team could see it, but <mark className={"jcd-hl" + (scenario.target === "shortcuts" && (state === "heard" || state === "answer") ? " is-sel" : "")}>each shortcut taken months earlier</mark> was now taxing everything built on top of it.</p>
      </article>

      <aside className={"jcd-voice-card is-" + state}>
        <span className="jcd-voice-dot" aria-hidden="true"><VoiceIcon /></span>
        {state === "ready" && <>
          <p className="jcd-voice-kicker">Voice control</p>
          <button type="button" className="jcd-voice-go" onClick={runVoiceDemo}>▶ Watch it listen</button>
        </>}
        {state === "listening" && <>
          <p className="jcd-voice-kicker">Listening</p>
          <h3>Say what you want to understand.</h3>
          <p className="jcd-voice-prompt">“{spoken}”</p>
          <span className="jcd-voice-safe">Or tell it to scroll, go back, click a button, or find something on the site.</span>
        </>}
        {state === "heard" && <>
          <p className="jcd-voice-kicker">Heard</p>
          <p className="jcd-transcript">“{scenario.question}”</p>
          <p>Finding that idea in the article…</p>
        </>}
        {state === "answer" && <>
          <p className="jcd-voice-kicker">Explanation</p>
          <h3>“{scenario.label}”</h3>
          <p>{scenario.answer}</p>
          <button type="button" className="jcd-voice-again" onClick={nextQuestion}>Try another question</button>
        </>}
      </aside>
    </div>
  );
}

const VOICE_SCENARIOS = [
  {
    target: "debt",
    question: "What does technical debt mean?",
    label: "technical debt",
    answer: "It means the future cost of earlier shortcuts in the code. They saved time at first, but now every change takes longer and carries more risk.",
  },
  {
    target: "pause",
    question: "Why did the team pause before the release?",
    label: "hit pause before the release",
    answer: "They paused because the legacy module had become a bottleneck. Refactoring it first would make the work that followed safer and faster.",
  },
  {
    target: "shortcuts",
    question: "What shortcuts are they talking about?",
    label: "each shortcut taken months earlier",
    answer: "They mean earlier quick fixes and expedient choices. Each one was small at the time, but together they made the code harder to change.",
  },
];

function VoiceIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5a3 3 0 0 0-3 3v4a3 3 0 1 0 6 0v-4a3 3 0 0 0-3-3Z" /><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3M9 20.5h6" /></svg>;
}

function Step({ n, label, done, active }) {
  return (
    <div className={"jcd-step" + (done ? " done" : "") + (active ? " active" : "")}>
      <span className="jcd-step-n">{done ? "✓" : n}</span>
      <span className="jcd-step-l">{label}</span>
    </div>
  );
}

const CSS = `
.jcd-root { --a: __ACCENT__; min-height: 100vh; background: #faf9f7; color: #14110f; overflow-x: clip;
  font-family: var(--font-inter-tight), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
.jcd-root * { box-sizing: border-box; }

/* ── top bar ─────────────────────────────────────────────────────── */
/* The sticky piece is the stack, not the header: the strip rides on top of the
   header and the two travel together, so hiding the strip is one transform on
   one element rather than two elements negotiating a shared top edge. */
.jcd-stack { position: sticky; top: 0; z-index: 20;
  transition: transform 300ms cubic-bezier(0.215, 0.61, 0.355, 1); }
/* Up by exactly the strip's height: the header lands on the top edge and the
   strip parks just off-screen, ready to come straight back down. */
.jcd-stack.is-collapsed { transform: translateY(calc(-1 * var(--strip-h, 0px))); }

.jcd-top { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px clamp(16px, 4vw, 28px); border-bottom: 1px solid #ece7e3;
  background: #faf9f7cc; backdrop-filter: blur(8px); }
.jcd-brand { display: inline-flex; align-items: center; gap: 9px; text-decoration: none; color: inherit; }
.jcd-mark { display: inline-flex; color: var(--a); }
.jcd-brand-name { font-weight: 700; font-size: 16px; letter-spacing: -0.01em; }
.jcd-top-right { display: inline-flex; align-items: center; gap: 14px; }
.jcd-top-gh { font-size: 13px; font-weight: 600; color: #6d645d; text-decoration: none; }
.jcd-top-gh:hover { color: #14110f; }
.jcd-top-cta { padding: 9px 15px; border-radius: 999px; background: #14110f; color: #fff; text-decoration: none;
  font-weight: 700; font-size: 12.5px; white-space: nowrap; transition: background .16s ease; }
.jcd-top-cta:hover { background: var(--a); }

/* ── tellme banner ───────────────────────────────────────────────── */
/* Rides on top of the sticky header inside .jcd-stack. It is not pinned open,
   which would cost every visitor vertical space forever to say something once:
   it slides out of the way while you read downward and returns the moment you
   scroll back up. */
.jcd-banner { position: relative; z-index: 21; display: flex; align-items: center; gap: 12px;
  padding: 10px clamp(16px, 4vw, 28px); background: var(--a); color: #fff;
  font-size: 13.5px; line-height: 1.45;
  /* Only transform and opacity — both GPU, neither triggers layout. */
  animation: jcd-banner-in 340ms cubic-bezier(0.215, 0.61, 0.355, 1) both; }
.jcd-banner.is-out { animation: jcd-banner-out 200ms cubic-bezier(0.4, 0, 1, 1) both; }
.jcd-banner-text { margin: 0; }
.jcd-banner-text strong { font-weight: 700; }
.jcd-banner-link { margin-left: auto; white-space: nowrap; color: #fff; font-weight: 700;
  text-decoration: underline; text-underline-offset: 3px; opacity: .92;
  transition: opacity .15s ease; }
.jcd-banner-link:hover { opacity: 1; }
.jcd-banner-x { flex: none; width: 26px; height: 26px; border: 0; border-radius: 999px;
  background: transparent; color: #fff; font-size: 17px; line-height: 1; cursor: pointer;
  opacity: .7; transition: opacity .15s ease, background .15s ease; }
.jcd-banner-x:hover { opacity: 1; background: #ffffff26; }

/* Entering the screen, so ease-out, and from a short distance so the duration
   stays under the 300-ish ms that keeps a UI feeling responsive. */
@keyframes jcd-banner-in {
  from { opacity: 0; transform: translateY(-100%); }
  to   { opacity: 1; transform: translateY(0); }
}
/* Exits are ~20% quicker than entrances — the decision is already made. */
@keyframes jcd-banner-out {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-100%); }
}
@media (prefers-reduced-motion: reduce) {
  .jcd-banner, .jcd-banner.is-out { animation: none; }
  .jcd-banner.is-out { display: none; }
  /* The strip still gets out of the way and still comes back, it just cuts
     rather than slides. */
  .jcd-stack { transition: none; }
}

@media (max-width: 560px) {
  .jcd-banner { flex-wrap: wrap; gap: 6px 10px; font-size: 12.5px; }
  .jcd-banner-link { margin-left: 0; }
  /* Lifted out of the flow so the two lines of copy get the full width, which
     means the copy has to leave a hole for it — otherwise the first line runs
     under the button. */
  .jcd-banner-x { position: absolute; top: 6px; right: 8px; }
  .jcd-banner-text { padding-right: 26px; }
}

/* ── hero ────────────────────────────────────────────────────────── */
.jcd-hero { max-width: 760px; margin: 0 auto; padding: clamp(56px, 10vw, 110px) clamp(18px, 5vw, 28px) clamp(28px, 5vw, 48px); }
.jcd-eyebrow { margin: 0 0 18px; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--a); }
.jcd-hero h1 { margin: 0 0 26px; font-size: clamp(34px, 6.4vw, 58px); line-height: 1.04; font-weight: 800; letter-spacing: -0.035em; }
@media (max-width: 640px) { .jcd-br { display: none; } }
.jcd-hero-copy p { margin: 0 0 16px; font-size: clamp(15.5px, 2.2vw, 17.5px); line-height: 1.65; color: #3a342f; max-width: 640px; }
.jcd-hero-copy a { color: inherit; text-decoration-color: var(--a); text-underline-offset: 3px; }
.jcd-hero-copy a:hover { color: var(--a); }
.jcd-hero-kicker { font-weight: 650; color: #14110f !important; }

/* ── demo ────────────────────────────────────────────────────────── */
.jcd-demo { max-width: 860px; margin: 0 auto; padding: clamp(12px, 3vw, 24px) clamp(14px, 4vw, 28px) clamp(40px, 6vw, 64px); }
.jcd-demo-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.jcd-mode-switch { display: inline-flex; gap: 3px; padding: 4px; border: 1px solid #e7e2dd; border-radius: 999px; background: #f4f1ee; }
.jcd-mode { padding: 8px 12px; border: 0; border-radius: 999px; background: transparent; color: #6d645d; font: 700 12.5px/1 inherit; cursor: pointer; transition: background .16s ease-out, color .16s ease-out, box-shadow .16s ease-out, transform .1s ease-out; }
.jcd-mode.is-on { background: #fff; color: #14110f; box-shadow: 0 1px 4px rgba(0,0,0,.1); }
.jcd-mode:active, .jcd-voice-go:active, .jcd-voice-again:active { transform: scale(.97); }
.jcd-steps { display: flex; gap: 8px; flex-wrap: wrap; }
.jcd-step { display: inline-flex; align-items: center; gap: 7px; padding: 6px 11px; border-radius: 999px;
  border: 1px solid #e7e2dd; background: #fff; font-size: 12px; color: #a39a92; transition: all .2s ease; }
.jcd-step.active { border-color: var(--a); color: #14110f; }
.jcd-step.done { color: #14110f; }
.jcd-step-n { display: grid; place-items: center; width: 17px; height: 17px; border-radius: 50%;
  background: #eee9e4; color: #8a817a; font-size: 10px; font-weight: 700; }
.jcd-step.active .jcd-step-n, .jcd-step.done .jcd-step-n { background: var(--a); color: #fff; }
.jcd-auto { padding: 8px 15px; border: 1px solid #14110f; border-radius: 999px; background: #14110f; color: #fff;
  font: 700 12.5px/1 inherit; cursor: pointer; transition: background .16s ease, transform .1s ease; }
.jcd-auto:hover { background: var(--a); border-color: var(--a); }
.jcd-auto.on { background: #fff; color: #14110f; }
.jcd-auto:active { transform: scale(.97); }

.jcd-stage { position: relative; border: 1px solid #e7e2dd; border-radius: 16px; overflow: hidden; background: #fff;
  box-shadow: 0 18px 50px rgba(0,0,0,.07); min-height: 600px; }
.jcd-fakebar { display: flex; align-items: center; gap: 6px; padding: 11px 14px; background: #f4f1ee; border-bottom: 1px solid #ece7e3; }
.jcd-fakebar i { width: 10px; height: 10px; border-radius: 50%; background: #d8d2cc; }
.jcd-fakebar span { margin-left: 10px; font-size: 12px; color: #a39a92; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Voice control is a separate entry point, not an agent: it hears an intent,
   finds the relevant part of the current page, then puts the answer beside it. */
.jcd-voice { min-height: 440px; padding-bottom: 22px; }
.jcd-voice-article { padding-bottom: 8px; }
.jcd-voice-article p, .jcd-voice-article .jcd-dim { color: #3a342f; }
.jcd-voice-card { position: relative; margin: 16px clamp(16px, 4vw, 28px) 0; max-width: 490px; padding: 16px 18px 15px 58px; border: 1px solid rgba(17,17,17,.1); border-radius: 14px; background: rgba(255,255,255,.92); box-shadow: 0 14px 34px rgba(0,0,0,.12); backdrop-filter: blur(14px); transition: transform .22s cubic-bezier(.23,1,.32,1), opacity .22s ease-out; }
.jcd-voice-dot { position: absolute; left: 17px; top: 17px; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: color-mix(in srgb, var(--a) 16%, white); color: var(--a); }
.jcd-voice-dot svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.jcd-voice-card.is-listening .jcd-voice-dot { animation: jcd-listen 1.2s ease-in-out infinite; }
@keyframes jcd-listen { 50% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--a) 15%, transparent); } }
.jcd-voice-card h3 { margin: 0 0 5px; font-size: 16px; letter-spacing: -.015em; }
.jcd-voice-card p { margin: 0; font-size: 13px; line-height: 1.55; color: #5a524c; }
.jcd-voice-kicker { margin-bottom: 5px !important; color: var(--a) !important; font-size: 10px !important; font-weight: 800; letter-spacing: .11em; text-transform: uppercase; }
.jcd-voice-prompt, .jcd-transcript { margin: 8px 0 !important; color: #14110f !important; font-weight: 650; }
.jcd-voice-go, .jcd-voice-again { display: inline-flex; margin-top: 12px; padding: 8px 11px; border: 1px solid #14110f; border-radius: 999px; background: #14110f; color: #fff; font: 700 12px/1 inherit; cursor: pointer; transition: transform .1s ease-out, background .16s ease-out; }
.jcd-voice-go:hover, .jcd-voice-again:hover { background: var(--a); border-color: var(--a); }
.jcd-voice-safe { display: block; margin-top: 9px; font-size: 11px; color: #8f8780; }

.jcd-article { padding: 26px clamp(16px, 3.5vw, 28px) 8px; }
.jcd-article h2 { margin: 0 0 12px; font-size: clamp(17px, 2.6vw, 20px); font-weight: 700; letter-spacing: -0.02em; color: #14110f; }
/* The article is dimmed so the one selectable phrase stands out. */
.jcd-article p { margin: 0 0 14px; font-size: clamp(14.5px, 2vw, 16px); line-height: 1.65; color: #bcb4ac; }
.jcd-article .jcd-dim { color: #cfc9c2; }
/* <mark> carries a highlight background in the UA stylesheet, which would show
   the phrase as already-selected before the cursor ever reaches it. The only
   highlight here is the one the sweep paints on .is-sel. */
.jcd-hl { position: relative; background: transparent; color: #14110f; font-weight: 600; cursor: pointer;
  border-radius: 3px; padding: 0 2px;
  box-decoration-break: clone; -webkit-box-decoration-break: clone; outline: none; }
.jcd-hl.is-live::after { content: ""; position: absolute; left: 0; right: 0; bottom: -2px; height: 2px;
  background: var(--a); border-radius: 2px; animation: jcd-underline 1.5s ease-in-out infinite; }
@keyframes jcd-underline { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
/* Selection: an accent wash painted left→right on the text itself (as a
   background, so the text stays on top and it's never hidden behind the page). */
.jcd-hl.is-sel {
  color: #14110f;
  background-image: linear-gradient(color-mix(in srgb, var(--a) 42%, transparent), color-mix(in srgb, var(--a) 42%, transparent));
  background-repeat: no-repeat;
  background-position: left center;
  background-size: 0% 100%;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--a) 22%, transparent);
  animation: jcd-sweep 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
@keyframes jcd-sweep { to { background-size: 100% 100%; } }

/* Floats at the exact bottom of the highlighted phrase (JS-anchored), the way
   the extension anchors to the selection. Pinned to the stage's right edge too,
   so the action row / panel can never poke past it (the mobile "cut" fix). */
.jcd-pop { position: absolute; right: 12px; z-index: 12; }

/* The extension diamond that pops up under the selection */
.jcd-blob { position: relative; display: inline-grid; place-items: center; width: 42px; height: 42px; padding: 0;
  border: 1px solid rgba(17,17,17,.12); border-radius: 12px; background: #fff; color: var(--a); cursor: pointer;
  box-shadow: 0 8px 22px rgba(0,0,0,.16); animation: jcd-blob-in .34s cubic-bezier(.34,1.4,.64,1) both; }
@keyframes jcd-blob-in { from { opacity: 0; transform: translateY(-8px) scale(.6); } to { opacity: 1; transform: none; } }
.jcd-blob:hover { transform: translateY(-1px); }
.jcd-blob-hint { position: absolute; left: 52px; top: 50%; transform: translateY(-50%); white-space: nowrap;
  background: #14110f; color: #fff; font: 600 11px/1 inherit; padding: 6px 9px; border-radius: 7px; }
.jcd-blob-hint::before { content: ""; position: absolute; left: -4px; top: 50%; transform: translateY(-50%) rotate(45deg);
  width: 7px; height: 7px; background: #14110f; }

.jcd-row { display: inline-flex; gap: 4px; padding: 5px; background: #fff; border: 1px solid rgba(17,17,17,.1);
  border-radius: 13px; box-shadow: 0 8px 24px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.08);
  animation: jcd-blob-in .28s cubic-bezier(.34,1.3,.64,1) both; max-width: 100%; }
.jcd-btn { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 66px;
  padding: 9px 11px 13px; border: 0; background: transparent; cursor: pointer; border-radius: 9px; transition: background .14s ease; }
.jcd-btn:hover { background: #f5f4f2; }
.jcd-btn-ico { width: 22px; height: 22px; display: grid; place-items: center; color: #141414; transition: transform .3s cubic-bezier(.34,1.45,.6,1); }
.jcd-ico { width: 22px; height: 22px; }
.jcd-btn-label { font-size: 11px; font-weight: 600; color: #3a3a3a; white-space: nowrap; }
.jcd-btn.is-sel .jcd-btn-ico { transform: scale(1.3); }
.jcd-btn.is-sel .jcd-btn-label { font-weight: 800; text-transform: uppercase; letter-spacing: .02em; color: #111; }
.jcd-diamond { position: absolute; left: 50%; bottom: 5px; width: 5px; height: 5px; background: var(--a);
  transform: translateX(-50%) rotate(45deg) scale(0); opacity: 0; transition: transform .24s cubic-bezier(.34,1.4,.64,1), opacity .16s ease; }
.jcd-btn.is-sel .jcd-diamond { transform: translateX(-50%) rotate(45deg) scale(1); opacity: 1; }

.jcd-row-arr { flex: 0 0 auto; width: 28px; align-self: stretch; display: grid; place-items: center;
  border: 0; background: transparent; color: #3a3a3a; cursor: pointer; border-radius: 8px; transition: background .14s ease, opacity .14s ease; }
.jcd-row-arr svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.jcd-row-arr:disabled { opacity: .25; cursor: default; }
.jcd-row-arr:not(:disabled):hover { background: #f1f1ef; }

.jcd-panel { width: 380px; max-width: 100%; margin-top: 10px; padding: 16px 18px; background: #fff;
  border: 1px solid rgba(17,17,17,.08); border-radius: 13px; box-shadow: 0 14px 34px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.06);
  animation: jcd-panel-in .26s cubic-bezier(.2,.85,.25,1) both; }
@keyframes jcd-panel-in { from { opacity: 0; transform: scale(.96) translateY(-4px); } to { opacity: 1; transform: none; } }
.jcd-panel-head { font-size: 14px; font-weight: 700; color: #111; }
.jcd-rule { height: 1px; background: rgba(17,17,17,.1); margin: 10px 0 12px; }
.jcd-tag { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 11px; font-size: 12px; font-weight: 600; }
.jcd-tag .jcd-ico { width: 14px; height: 14px; }
.jcd-verdict { font-style: normal; color: #0b6b2d; font-weight: 700; }
.jcd-answer { font-size: 15px; line-height: 1.6; color: #1a1a1a; }
.jcd-para { margin: 0 0 10px; } .jcd-para:last-child { margin-bottom: 0; }
.jcd-key { margin-top: 4px; padding: 1px 0 1px 15px; border-left: 2px solid var(--a); font-weight: 560; line-height: 1.6; }
.jcd-srcs { list-style: none; margin: 14px 0 0; padding: 0; }
.jcd-srcs li { display: flex; flex-wrap: wrap; gap: 1px 6px; font-size: 11px; }
.jcd-src-host { color: #514b46; font-weight: 500; }
.jcd-src-title { flex: 1 1 100%; color: #b0a9a3; }

.jcd-skel { display: flex; flex-direction: column; gap: 9px; padding: 3px 0; }
.jcd-skel span { display: block; height: 11px; border-radius: 6px;
  background: linear-gradient(90deg,#ececea 0%,#ececea 40%,#f7f7f5 50%,#ececea 60%,#ececea 100%); background-size: 220% 100%; animation: jcd-shimmer 1.15s linear infinite; }
@keyframes jcd-shimmer { from { background-position: 130% 0; } to { background-position: -130% 0; } }

/* Text area demo */
.jcd-ta { margin: 22px clamp(14px, 3vw, 28px) 26px; border: 1px solid #e7e2dd; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,.06); animation: jcd-panel-in .3s ease both; }
.jcd-ta-tools { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #ece7e3; background: #faf8f6; }
.jcd-ta-title { font-size: 12px; font-weight: 700; color: #6d645d; }
.jcd-ta-dots { display: inline-flex; gap: 5px; margin-left: auto; }
.jcd-ta-dots i { width: 8px; height: 8px; border-radius: 50%; background: #d8d2cc; }
.jcd-ta-reset { padding: 4px 9px; border: 1px solid #e0dcd8; border-radius: 999px;
  background: #fff; color: #6d645d; font: 600 10.5px/1 inherit; cursor: pointer; transition: all .14s ease; }
.jcd-ta-reset:hover { border-color: #14110f; color: #14110f; }
.jcd-ta-before { position: relative; margin: 14px 18px 0; padding: 11px 13px; border: 1px dashed #ded8d3; border-radius: 10px;
  background: #fbf9f8; font-size: 13px; line-height: 1.55; color: #a39a92; }
.jcd-ta-before-tag { display: block; margin-bottom: 4px; font-size: 9.5px; font-weight: 800; letter-spacing: .09em;
  text-transform: uppercase; color: #c3bab3; }
.jcd-ta-body { padding: 18px 18px; min-height: 96px; font-size: 15px; line-height: 1.6; color: #1a1a1a;
  transition: opacity .18s ease; }
.jcd-ta-body.is-busy { opacity: .9; }
.jcd-ta-para { margin: 0 0 10px; } .jcd-ta-para:last-child { margin-bottom: 0; }
.jcd-ta-bullets { margin: 0; padding: 0; list-style: none; }
.jcd-ta-bullets li { position: relative; padding: 0 0 9px 18px; }
.jcd-ta-bullets li:last-child { padding-bottom: 0; }
.jcd-ta-bullets li::before { content: ""; position: absolute; left: 1px; top: 9px; width: 6px; height: 6px;
  background: var(--a); transform: rotate(45deg); border-radius: 1px; }
.jcd-ta-out { display: flex; gap: 7px; padding: 0 16px 4px; }
.jcd-ta-out-btn { padding: 5px 11px; border: 1px solid #e7e2dd; border-radius: 7px; background: #fbf9f8;
  color: #6d645d; font-size: 11px; font-weight: 600; }
.jcd-ta-actions { display: flex; flex-wrap: wrap; gap: 7px; padding: 0 14px 14px; }
.jcd-ta-btn { padding: 7px 13px; border: 1px solid #e0dcd8; border-radius: 999px; background: #fff; color: #2a2a2a; font: 600 12px/1 inherit; cursor: pointer; transition: all .14s ease; }
.jcd-ta-btn:hover { background: #141414; color: #fff; border-color: #141414; }
.jcd-ta-btn.is-on { background: var(--a); color: #fff; border-color: var(--a); }
.jcd-ta-note { margin: 0; padding: 0 16px 16px; font-size: 12px; color: #a39a92; }

/* Fake cursor */
.jcd-cursor { position: absolute; left: 0; top: 0; margin: -4px 0 0 -4px; z-index: 40; pointer-events: none;
  opacity: 0; transition: transform .55s cubic-bezier(.4,0,.2,1), opacity .2s ease; filter: drop-shadow(0 2px 3px rgba(0,0,0,.3)); }
.jcd-cursor.on { opacity: 1; }
.jcd-cursor.click svg { transform: scale(.8); }
.jcd-cursor svg { transition: transform .12s ease; }
.jcd-cursor.click::after { content: ""; position: absolute; left: 2px; top: 2px; width: 24px; height: 24px; margin: -12px 0 0 -12px;
  border-radius: 50%; border: 2px solid var(--a); animation: jcd-ripple .4s ease-out; }
@keyframes jcd-ripple { from { transform: scale(.2); opacity: .9; } to { transform: scale(1.6); opacity: 0; } }

.jcd-caption { margin: 18px 2px 0; font-size: 13.5px; color: #5a524c; min-height: 20px; font-weight: 500; }
.jcd-fine { margin: 6px 2px 0; font-size: 12px; color: #a39a92; }

@media (prefers-reduced-motion: reduce) {
  .jcd-mode, .jcd-voice-card, .jcd-voice-go, .jcd-voice-again { transition-duration: .01ms; }
  .jcd-voice-card.is-listening .jcd-voice-dot { animation: none; }
}

/* ── scan layer ──────────────────────────────────────────────────────
   Everything below the demo is prose, and most people will not read prose.
   These four primitives are what they read instead: the accent wash marks the
   one clause per paragraph that carries the point, the key cap shows the key
   rather than naming it, the pill carries a price or a caveat, and the chips
   turn a sentence-shaped list back into a list. */

/* The same accent wash the extension paints on a selection, so the page
   highlights its own key phrases exactly the way the product highlights yours. */
.jcd-hi { background-image: linear-gradient(color-mix(in srgb, var(--a) 30%, transparent), color-mix(in srgb, var(--a) 30%, transparent));
  border-radius: 3px; padding: 0 3px; color: #14110f; font-weight: 650;
  box-decoration-break: clone; -webkit-box-decoration-break: clone; }

/* Sized in em so the same cap works in a 34px h2 and in 15px body copy. */
.jcd-kbd { display: inline-flex; align-items: baseline; gap: .28em; padding: .1em .42em .18em;
  border: 1px solid #d8d2cc; border-bottom-width: 2px; border-radius: .32em; background: #fff;
  box-shadow: 0 1px 0 rgba(0,0,0,.05); font: inherit; font-size: .82em; font-weight: 700; line-height: 1.3;
  color: #14110f; white-space: nowrap; }
.jcd-kbd-sym { font-size: 1.1em; line-height: 1; }

.jcd-pill { display: inline-flex; align-items: center; padding: 2px 9px 3px; border-radius: 999px;
  background: var(--a); color: #fff; font-size: .78em; font-weight: 750; white-space: nowrap;
  vertical-align: baseline; }
.jcd-pill-soft { background: color-mix(in srgb, var(--a) 14%, transparent); color: var(--a); }

.jcd-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 11px 0 3px; }
.jcd-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px 6px 9px;
  border: 1px solid #e7e2dd; border-radius: 999px; background: #fff; font-size: 12.5px; font-weight: 600;
  color: #3a342f; line-height: 1.25; }
.jcd-chip .jcd-ico, .jcd-chip .jcd-glyph { flex: 0 0 auto; width: 15px; height: 15px; color: var(--a); }

.jcd-glyph { width: 22px; height: 22px; }

/* Engine cards: the four answer paths, which were a wall of <br>-separated prose.
   BYOK is its own card because it is its own decision, not a footnote on the
   hosted tier: the key goes straight to the provider and we never bill it. */
.jcd-engines { display: grid; gap: 9px; margin: 13px 0 4px; }
.jcd-engine { display: flex; gap: 12px; padding: 13px 15px 14px; border: 1px solid #ece7e3;
  border-radius: 12px; background: #fff; }
.jcd-engine-ico { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center;
  background: color-mix(in srgb, var(--a) 11%, transparent); color: var(--a); }
.jcd-engine-ico .jcd-glyph { width: 17px; height: 17px; }
.jcd-engine-body { display: block; font-size: 13.5px; line-height: 1.6; color: #3a342f; }
.jcd-engine-h { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 3px; }
.jcd-engine-name { font-size: 14.5px; font-weight: 750; color: #14110f; }
.jcd-specs { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
.jcd-specs span { padding: 3px 9px 4px; border-radius: 999px; background: #f4f1ee; color: #6d645d;
  font-size: 11px; font-weight: 600; }

/* ── the turn (sits directly under the demo) ─────────────────────── */
.jcd-turn { max-width: 760px; margin: 0 auto; padding: clamp(20px, 4vw, 36px) clamp(18px, 5vw, 28px) clamp(8px, 2vw, 16px); }
.jcd-turn p { margin: 0 0 16px; font-size: clamp(15.5px, 2.2vw, 17.5px); line-height: 1.65; color: #3a342f; }
.jcd-turn a { color: inherit; text-decoration-color: var(--a); text-underline-offset: 3px; }
.jcd-turn a:hover { color: var(--a); }
.jcd-turn-kicker { font-weight: 650; color: #14110f !important; }

/* ── convictions ─────────────────────────────────────────────────── */
.jcd-creed { max-width: 760px; margin: 0 auto; padding: clamp(24px, 5vw, 48px) clamp(18px, 5vw, 28px);
  border-top: 1px solid #ece7e3; display: flex; flex-direction: column; gap: clamp(28px, 5vw, 44px); }
.jcd-creed-item { position: relative; padding-left: clamp(48px, 8vw, 64px); }
/* The number used to hold this column on its own; the glyph says what the
   conviction is about before the heading has been read. */
.jcd-creed-ico { position: absolute; left: 0; top: 0; width: 34px; height: 34px; border-radius: 11px;
  display: grid; place-items: center; color: var(--a);
  background: color-mix(in srgb, var(--a) 11%, transparent);
  border: 1px solid color-mix(in srgb, var(--a) 20%, transparent); }
.jcd-creed-ico .jcd-glyph { width: 19px; height: 19px; }
.jcd-creed-n { display: block; margin-bottom: 3px; font-size: 12px; font-weight: 800; color: var(--a); letter-spacing: .1em; }
.jcd-creed-item h3 { margin: 0 0 8px; font-size: clamp(19px, 3vw, 23px); font-weight: 750; letter-spacing: -0.02em; }
.jcd-creed-item .jcd-chips { margin: 0 0 12px; }
.jcd-creed-item p { margin: 0; font-size: clamp(14.5px, 2vw, 16px); line-height: 1.65; color: #3a342f; }
.jcd-creed-item a { color: inherit; text-decoration-color: var(--a); text-underline-offset: 3px; }
.jcd-creed-item a:hover { color: var(--a); }

/* ── technical ───────────────────────────────────────────────────── */
.jcd-tech { max-width: 760px; margin: 0 auto; padding: clamp(32px, 6vw, 64px) clamp(18px, 5vw, 28px);
  border-top: 1px solid #ece7e3; }
.jcd-tech h2 { margin: 0 0 12px; font-size: clamp(24px, 4vw, 34px); font-weight: 800; letter-spacing: -0.03em; }
.jcd-tech-lead { margin: 0 0 24px; font-size: clamp(14.5px, 2vw, 16px); line-height: 1.6; color: #3a342f; }
.jcd-pipe { margin: 0; padding: 0; list-style: none; counter-reset: pipe; display: flex; flex-direction: column; }
.jcd-pipe li { counter-increment: pipe; position: relative; padding: 18px 0 18px clamp(48px, 8vw, 60px);
  font-size: clamp(14.5px, 2vw, 15.5px); line-height: 1.65; color: #3a342f; border-bottom: 1px solid #f0ece8; }
.jcd-pipe li:last-child { border-bottom: 0; }
/* The glyph is the marker now. On the pipeline (an actual sequence) the step
   number keeps its job and sits under the glyph; the voice list isn't ordered,
   so it gets the glyph alone. */
.jcd-pipe-ico { position: absolute; left: 0; top: 18px; width: 32px; height: 32px; border-radius: 10px;
  display: grid; place-items: center; color: var(--a);
  background: color-mix(in srgb, var(--a) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--a) 20%, transparent); }
.jcd-pipe-ico .jcd-glyph { width: 18px; height: 18px; }
.jcd-pipe-steps li::before { content: counter(pipe, decimal-leading-zero); position: absolute; left: 0; top: 55px;
  width: 32px; text-align: center; font-size: 10.5px; font-weight: 800; color: var(--a); letter-spacing: .06em; opacity: .75; }
.jcd-pipe b { color: #14110f; }
.jcd-pipe .jcd-chips { margin-bottom: 0; }

/* ── close ───────────────────────────────────────────────────────── */
.jcd-close { max-width: 760px; margin: 0 auto; padding: clamp(16px, 4vw, 32px) clamp(18px, 5vw, 28px) clamp(72px, 10vw, 110px); }
.jcd-thesis { margin: 0 0 24px; padding: 16px 18px; background: color-mix(in srgb, var(--a) 6%, transparent);
  border-left: 3px solid var(--a); border-radius: 0 10px 10px 0; font-size: clamp(15px, 2.2vw, 17px); line-height: 1.55; color: #14110f; }
.jcd-close-row { display: flex; gap: 12px; flex-wrap: wrap; }
.jcd-cta { display: inline-block; padding: 13px 22px; background: #14110f; color: #fff; text-decoration: none;
  border-radius: 11px; font-weight: 700; font-size: 14px; transition: transform .12s ease, background .16s ease; }
.jcd-cta:hover { background: var(--a); }
.jcd-cta:active { transform: scale(.98); }
.jcd-cta-ghost { display: inline-block; padding: 13px 22px; background: transparent; color: #14110f; text-decoration: none;
  border: 1px solid #d8d2cc; border-radius: 11px; font-weight: 700; font-size: 14px; transition: border-color .16s ease, color .16s ease; }
.jcd-cta-ghost:hover { border-color: var(--a); color: var(--a); }

@media (prefers-reduced-motion: reduce) {
  .jcd-hl.is-live::after, .jcd-skel span, .jcd-btn-ico, .jcd-panel, .jcd-blob, .jcd-row, .jcd-cursor { animation: none; transition: none; }
}
`;
