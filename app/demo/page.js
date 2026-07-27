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
      "Here, “technical debt” means the hidden cost of the shortcuts the team took earlier in the code — quick fixes that made shipping faster then, but now make every new change slower and riskier.",
    ],
    key: "It isn't a real loan — it's a metaphor for work you'll have to pay back later, with interest.",
  },
  detailed: {
    paras: [
      "“Technical debt” describes what accumulates when a team repeatedly chooses the fast, expedient solution over the cleaner one. Each shortcut is small, but they compound: the code gets harder to read and every change ripples in unexpected ways.",
      "The team here is arguing the balance has grown so large it's now the main thing slowing feature work — which is why they refactor before piling on more.",
    ],
    key: "Left unpaid, technical debt turns a day's work into a week's, until progress crawls.",
  },
  example: {
    paras: [
      "Like paying only the minimum on a credit card: you get what you want now, but the balance — and the interest — keeps growing until it crowds out everything else.",
    ],
  },
  factcheck: {
    paras: [
      "Accurate as a description of a well-known engineering concept. “Technical debt” was coined by Ward Cunningham in 1992 and is widely used for the compounding cost of expedient code.",
    ],
    sources: [{ host: "wikipedia.org", title: "Technical debt — origin & definition" }],
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
    note: "Humanized — same meaning, written like a person wrote it.",
    paras: [
      "The team chose to refactor: the codebase had become difficult to work in, and even small changes were taking far longer than they should.",
    ],
  },
  {
    key: "shorten",
    label: "Shorten",
    note: "Shortened — 24 words down to 11.",
    paras: ["The team refactored because the messy codebase was slowing every change down."],
  },
  {
    key: "expand",
    label: "Expand",
    note: "Expanded — the reasoning spelled out.",
    paras: [
      "The team decided to refactor because the codebase had grown genuinely messy over time. Shortcuts taken during earlier sprints had accumulated, and the structure no longer matched what the product actually needed.",
      "The cost showed up in velocity: even trivial changes required touching several places at once, so work that should have taken an hour stretched across a day. Refactoring first was the faster path to everything that came after.",
    ],
  },
  {
    key: "summarize",
    label: "Summarize",
    note: "Summarized — the points, nothing else.",
    bullets: [
      "The codebase had become messy.",
      "Every small change was taking far too long.",
      "The team refactored to fix it.",
    ],
  },
];

export default function DemoPage() {
  // phase: idle → selected → open → loading → answer, plus 'textarea'
  const [phase, setPhase] = useState("idle");
  const [sel, setSel] = useState(null);
  const [auto, setAuto] = useState(false);
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
  }, [phase, sel, anchor, taTool, taBusy]);

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

  const answer = sel ? ANSWERS[sel] : null;
  const action = sel ? ACTIONS.find((a) => a.key === sel) : null;
  const showRow = phase === "open" || phase === "loading" || phase === "answer";
  const showBlob = phase === "selecting" || phase === "selected";

  const caption =
    phase === "idle"
      ? "Click the highlighted phrase to select it — like you would while reading."
      : phase === "selecting" || phase === "selected"
        ? "Selected. The JustClarify diamond appears — click it to open."
        : phase === "open"
          ? "Explain and Expand come first — the › arrow holds Fact-check, the Text area, and Example."
          : phase === "loading"
            ? "Reading the sentence around your highlight…"
            : phase === "textarea"
              ? "The Text area: paste anything and reshape it — humanize, shorten, expand, summarize."
              : "You never left the page. In the real extension this is generated on-device in ~1 second.";

  return (
    <main className="jcd-root" style={{ "--a": `var(--accent, ${ACCENT})` }}>
      <style>{CSS.replace(/__ACCENT__/g, ACCENT)}</style>

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
            Add to Chrome — free
          </a>
        </div>
      </header>

      {/* ── 1 · The hook ─────────────────────────────────────────────── */}
      <section className="jcd-hero">
        <p className="jcd-eyebrow">Free · On-device · Open source</p>
        <h1>
          You should never have to pay
          <br className="jcd-br" /> to understand something.
        </h1>
        <div className="jcd-hero-copy">
          <p>
            Every day you read things you only half-understand — a term, a claim, a paragraph that
            quietly assumes you know more than you do. The web has one fix for this, and it&apos;s a
            detour: open a tab, paste into a chatbot, lose your place. Or pay $10 a month for a
            sidebar that does the pasting for you.
          </p>
          <p className="jcd-hero-kicker">
            Here&apos;s the alternative. Highlight anything below.
          </p>
        </div>
      </section>

      {/* ── 2 · The demo ─────────────────────────────────────────────── */}
      <section className="jcd-demo" id="demo">
        <div className="jcd-demo-head">
          <div className="jcd-steps">
            <Step n="1" done={phase !== "idle"} active={phase === "idle"} label="Highlight" />
            <Step n="2" done={showRow || phase === "textarea"} active={showBlob} label="Open JustClarify" />
            <Step n="3" done={phase === "answer" || phase === "textarea"} active={phase === "open" || phase === "loading"} label="Read it in place" />
          </div>
          <button type="button" className={"jcd-auto" + (auto ? " on" : "")} onClick={toggleAuto}>
            {auto ? "■ Stop" : "▶ Watch it drive itself"}
          </button>
        </div>

        <div className="jcd-stage" ref={stageRef} style={{ minHeight: stageMinH }} role="figure" aria-label="A webpage with JustClarify">
          <div className="jcd-fakebar">
            <i /><i /><i />
            <span>a-long-article-you&apos;re-reading.com</span>
          </div>

          {phase === "textarea" ? (
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
                  feature, they chose to refactor the legacy module first — arguing that the{" "}
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

        <p className="jcd-caption">{caption}</p>
        <p className="jcd-fine">
          {auto
            ? "Auto-play is running — click anything to take over."
            : "This demo is scripted — every answer is pre-written and no AI is called. The real extension generates them live, on your device."}
        </p>
      </section>

      {/* ── 3 · The turn: why it can be free ─────────────────────────── */}
      <section className="jcd-turn">
        <p>
          We think the subscription model is backwards.{" "}
          <b>The intelligence already lives on your machine</b> — Chrome now ships an AI model
          inside the browser itself. Which means explaining what you read can cost nothing, need
          no account, and never send a word of what you&apos;re reading to anyone&apos;s server.
          So that&apos;s what we built. Then we{" "}
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">open-sourced all of it</a>,
          so you don&apos;t have to take our word for any of this.
        </p>
        <p className="jcd-turn-kicker">
          Highlight. Read the answer where you stand. Keep going. That&apos;s the whole product.
        </p>
      </section>

      {/* ── 4 · The convictions ──────────────────────────────────────── */}
      <section className="jcd-creed">
        <div className="jcd-creed-item">
          <span className="jcd-creed-n">01</span>
          <h3>Free, because it costs us nothing.</h3>
          <p>
            Tools like this charge subscriptions because every answer costs them server money.
            JustClarify&apos;s answers are generated by your own computer, so our marginal cost is
            zero — and when the cost is zero, we think the price should be too. No account, no trial,
            no &quot;you&apos;ve used your 5 free credits.&quot;
          </p>
        </div>
        <div className="jcd-creed-item">
          <span className="jcd-creed-n">02</span>
          <h3>Private by architecture, not by promise.</h3>
          <p>
            What you highlight never touches our servers, because there are no servers in the loop.
            The model runs on your machine; airplane mode works. Most privacy policies ask for trust —
            ours barely has anything to disclose.
          </p>
        </div>
        <div className="jcd-creed-item">
          <span className="jcd-creed-n">03</span>
          <h3>Open source, so trust is optional.</h3>
          <p>
            The entire extension is <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">public code</a>.
            Every answer is badged with the exact engine and model that wrote it, and fact-checks only
            return a verdict with a source you can click. If we ever break these rules, you&apos;ll see
            it in the diff.
          </p>
        </div>
      </section>

      {/* ── 5 · The technical part, at the bottom on purpose ─────────── */}
      <section className="jcd-tech">
        <p className="jcd-eyebrow">For the curious</p>
        <h2>How a highlight becomes an answer</h2>
        <p className="jcd-tech-lead">
          No magic, no hidden backend. Here is the actual pipeline, straight from the source code:
        </p>
        <ol className="jcd-pipe">
          <li>
            <b>It reads around your selection, not just your selection.</b> When you highlight, the
            content script walks outward through the surrounding text and captures a{" "}
            <i>semantic window</i> — about two full sentences on each side for Explain, up to six for
            Expand. That&apos;s why answers fit the article you&apos;re in, not a dictionary&apos;s
            idea of the phrase.
          </li>
          <li>
            <b>The prompt is assembled on the page.</b> Your selection, the surrounding passage, the
            page title, the action you picked, and your density setting are built into a single prompt
            locally, inside the tab. At this point, nothing has been sent anywhere.
          </li>
          <li>
            <b>On-device answers first.</b> The prompt goes to Chrome&apos;s built-in Prompt API —
            Gemini Nano, a model that runs on your own hardware. The first time you use it, Chrome
            downloads that model once (about 4GB); JustClarify asks before it starts and shows the
            progress rather than hanging on a silent spinner. After that one download, answers
            stream into the page with no network round-trip at all. Turn your Wi-Fi off; it still
            works.
          </li>
          <li>
            <b>Definitions don&apos;t go to a model at all.</b> Highlight a single word and Define
            queries a real dictionary (the free, keyless Dictionary API) for the actual entry —
            part of speech, senses, and the dictionary&apos;s own example sentence. A definition is
            a lookup, not a generation; a model can only paraphrase what a dictionary already
            states, and it can get it wrong. Only words with no entry — jargon, proper nouns,
            coinages — fall back to a contextual explanation.
          </li>
          <li>
            <b>Your key, your models — strictly optional.</b> Want frontier-quality answers? Add your
            own AI Gateway key in settings, and the same prompt routes through one OpenAI-compatible
            endpoint to whichever model you choose — Claude, GPT, Llama, hundreds of others — and
            streams straight back. The key lives in your browser&apos;s storage and is sent only to
            the gateway. We never see it, and there is no JustClarify server in between.
          </li>
          <li>
            <b>The badge never lies.</b> Every answer is stamped with the engine and model that
            produced it, so an on-device reply and a gateway one can never be confused. Fact-checks
            return a verdict plus a clickable source — or they don&apos;t return at all.
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
            Add it to Chrome — free
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
            ? `${active.note}  ·  Try another tool — it always rewrites your original.`
            : "Paste rough text, pick a tool — it rewrites in place. Try all four."}
      </p>
    </div>
  );
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
.jcd-top { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px clamp(16px, 4vw, 28px); border-bottom: 1px solid #ece7e3; position: sticky; top: 0;
  background: #faf9f7cc; backdrop-filter: blur(8px); z-index: 20; }
.jcd-brand { display: inline-flex; align-items: center; gap: 9px; text-decoration: none; color: inherit; }
.jcd-mark { display: inline-flex; color: var(--a); }
.jcd-brand-name { font-weight: 700; font-size: 16px; letter-spacing: -0.01em; }
.jcd-top-right { display: inline-flex; align-items: center; gap: 14px; }
.jcd-top-gh { font-size: 13px; font-weight: 600; color: #6d645d; text-decoration: none; }
.jcd-top-gh:hover { color: #14110f; }
.jcd-top-cta { padding: 9px 15px; border-radius: 999px; background: #14110f; color: #fff; text-decoration: none;
  font-weight: 700; font-size: 12.5px; white-space: nowrap; transition: background .16s ease; }
.jcd-top-cta:hover { background: var(--a); }

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

/* ── the turn (sits directly under the demo) ─────────────────────── */
.jcd-turn { max-width: 760px; margin: 0 auto; padding: clamp(20px, 4vw, 36px) clamp(18px, 5vw, 28px) clamp(8px, 2vw, 16px); }
.jcd-turn p { margin: 0 0 16px; font-size: clamp(15.5px, 2.2vw, 17.5px); line-height: 1.65; color: #3a342f; }
.jcd-turn a { color: inherit; text-decoration-color: var(--a); text-underline-offset: 3px; }
.jcd-turn a:hover { color: var(--a); }
.jcd-turn-kicker { font-weight: 650; color: #14110f !important; }

/* ── convictions ─────────────────────────────────────────────────── */
.jcd-creed { max-width: 760px; margin: 0 auto; padding: clamp(24px, 5vw, 48px) clamp(18px, 5vw, 28px);
  border-top: 1px solid #ece7e3; display: flex; flex-direction: column; gap: clamp(28px, 5vw, 44px); }
.jcd-creed-item { position: relative; padding-left: clamp(44px, 8vw, 64px); }
.jcd-creed-n { position: absolute; left: 0; top: 2px; font-size: 13px; font-weight: 800; color: var(--a); letter-spacing: .04em; }
.jcd-creed-item h3 { margin: 0 0 8px; font-size: clamp(19px, 3vw, 23px); font-weight: 750; letter-spacing: -0.02em; }
.jcd-creed-item p { margin: 0; font-size: clamp(14.5px, 2vw, 16px); line-height: 1.65; color: #3a342f; }
.jcd-creed-item a { color: inherit; text-decoration-color: var(--a); text-underline-offset: 3px; }
.jcd-creed-item a:hover { color: var(--a); }

/* ── technical ───────────────────────────────────────────────────── */
.jcd-tech { max-width: 760px; margin: 0 auto; padding: clamp(32px, 6vw, 64px) clamp(18px, 5vw, 28px);
  border-top: 1px solid #ece7e3; }
.jcd-tech h2 { margin: 0 0 12px; font-size: clamp(24px, 4vw, 34px); font-weight: 800; letter-spacing: -0.03em; }
.jcd-tech-lead { margin: 0 0 24px; font-size: clamp(14.5px, 2vw, 16px); line-height: 1.6; color: #3a342f; }
.jcd-pipe { margin: 0; padding: 0; list-style: none; counter-reset: pipe; display: flex; flex-direction: column; }
.jcd-pipe li { counter-increment: pipe; position: relative; padding: 18px 0 18px clamp(44px, 8vw, 60px);
  font-size: clamp(14.5px, 2vw, 15.5px); line-height: 1.65; color: #3a342f; border-bottom: 1px solid #f0ece8; }
.jcd-pipe li:last-child { border-bottom: 0; }
.jcd-pipe li::before { content: counter(pipe, decimal-leading-zero); position: absolute; left: 0; top: 21px;
  font-size: 13px; font-weight: 800; color: var(--a); letter-spacing: .04em; }
.jcd-pipe b { color: #14110f; }

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
