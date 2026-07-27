"use client";

// A guided, no-AI demo of JustClarify.
//
// Manual: the target phrase stands out (the rest of the article is dimmed).
// Click it → it "selects" (blue sweep) → the extension diamond pops up under it
// → click the diamond → the action row opens → pick an action → 1.2s loader →
// a pre-written answer. Every answer is canned; nothing calls a model.
//
// Auto-play: a fake cursor drives the whole thing on a loop — sweep-select,
// drop the diamond, click it, open the row, cycle through the actions, then show
// the Text area. Runnable, cancellable, and it stops the moment you touch it.

import { useEffect, useRef, useState } from "react";

const ACCENT = "oklch(0.56 0.10 28)";

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

const ACTIONS = [
  { key: "explain", label: "Explain", icon: "explain", tag: "Explanation" },
  { key: "detailed", label: "Expand", icon: "expand", tag: "Expanded" },
  { key: "define", label: "Define", icon: "define", tag: "Definition" },
  { key: "eli5", label: "ELI5", icon: "eli5", tag: "In simple terms" },
  { key: "example", label: "Example", icon: "example", tag: "Example" },
  { key: "factcheck", label: "Fact-check", icon: "factcheck", tag: "Fact-check" },
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
  define: {
    paras: [
      "technical debt — noun. The implied future cost of choosing an easy, limited solution now instead of a better approach that would take longer. “We shipped on time, but the technical debt caught up a month later.”",
    ],
  },
  eli5: {
    paras: [
      "It's like leaving a mess in your room to play sooner. Fine once — but keep doing it and cleaning up later takes way, way longer than tidying as you go.",
    ],
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

const TA_BEFORE =
  "the team decided to refactor cuz the code was honestly a mess and it was slowing everything down so much, like every tiny change took forever";
const TA_AFTER =
  "The team chose to refactor: the codebase had become difficult to work in, and even small changes were taking far longer than they should.";

export default function DemoPage() {
  // phase: idle → selected → open → loading → answer, plus 'textarea'
  const [phase, setPhase] = useState("idle");
  const [sel, setSel] = useState(null);
  const [auto, setAuto] = useState(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0, on: false, click: false });
  const [taApplied, setTaApplied] = useState(false);
  const [anchor, setAnchor] = useState(null); // {left, top} of the phrase's bottom, in stage coords
  const [stageMinH, setStageMinH] = useState(460); // stage grows to fit the floating popup so nothing clips
  const popRef = useRef(null);

  const runId = useRef(0);
  const stageRef = useRef(null);
  const phraseRef = useRef(null);
  const blobRef = useRef(null);
  const btnRefs = useRef({});
  const taBtnRef = useRef(null);

  // ---- cursor helpers (coords relative to the stage) ----
  function pointAt(el) {
    const stage = stageRef.current;
    if (!stage || !el) return;
    const s = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setCursor((c) => ({ ...c, x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2, on: true }));
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Anchor the popup to the exact bottom-left of the highlighted phrase, the way
  // the extension anchors to the selection rect. Re-measured on select + resize.
  function measureAnchor() {
    const stage = stageRef.current;
    const ph = phraseRef.current;
    if (!stage || !ph) return;
    const s = stage.getBoundingClientRect();
    const r = ph.getBoundingClientRect();
    const maxLeft = Math.max(16, s.width - 380); // keep the ~360px panel in view
    setAnchor({
      left: Math.max(16, Math.min(Math.round(r.left - s.left), maxLeft)),
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
  }, [phase, sel, anchor, taApplied]);

  function resetAll() {
    setPhase("idle");
    setSel(null);
    setTaApplied(false);
    setCursor((c) => ({ ...c, on: false, click: false }));
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
    if (phase === "selected") setPhase("open");
  }
  function pick(key) {
    if (!auto && phase === "loading") return;
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

  // ---- auto-play: drives the whole flow on a loop ----
  async function runAuto() {
    const my = ++runId.current;
    const alive = () => runId.current === my;
    setAuto(true);
    resetAll();
    await wait(600);
    if (!alive()) return;

    setPhase("selecting"); // sweep the selection across the phrase
    measureAnchor();
    pointAt(phraseRef.current);
    await wait(750);
    if (!alive()) return;

    setPhase("selected"); // diamond drops in
    await wait(180);
    pointAt(blobRef.current);
    await wait(750);
    if (!alive()) return;

    clickPulse();
    await wait(320);
    if (!alive()) return;
    setPhase("open");
    setSel(null);
    await wait(750);
    if (!alive()) return;

    for (const key of ["explain", "factcheck", "define", "eli5"]) {
      if (!alive()) return;
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

    // The Text area — a second thing JustClarify does.
    setPhase("textarea");
    setTaApplied(false);
    setCursor((c) => ({ ...c, on: false }));
    await wait(900);
    if (!alive()) return;
    pointAt(taBtnRef.current);
    await wait(700);
    if (!alive()) return;
    clickPulse();
    await wait(250);
    setTaApplied(true);
    await wait(2600);
    if (!alive()) return;

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
          ? "Pick how you want it explained. The answer lands right here."
          : phase === "loading"
            ? "Reading the sentence around your highlight…"
            : phase === "textarea"
              ? "The Text area: paste anything and reshape it — humanize, shorten, expand, summarize."
              : "You never left the page. In the real extension this is generated on-device in ~1 second.";

  return (
    <main className="jcd-root">
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
          <span className="jcd-top-tag">Scripted demo — canned answers, no AI</span>
          <button type="button" className={"jcd-auto" + (auto ? " on" : "")} onClick={toggleAuto}>
            {auto ? "■ Stop" : "▶ Auto-play"}
          </button>
        </div>
      </header>

      <div className="jcd-grid">
        {/* ── Left: interactive stage ─────────────────────────────────── */}
        <section className="jcd-stage-wrap">
          <div className="jcd-steps">
            <Step n="1" done={phase !== "idle"} active={phase === "idle"} label="Highlight" />
            <Step n="2" done={showRow || phase === "textarea"} active={showBlob} label="Open JustClarify" />
            <Step n="3" done={phase === "answer" || phase === "textarea"} active={phase === "open" || phase === "loading"} label="Read it in place" />
          </div>

          <div className="jcd-stage" ref={stageRef} style={{ minHeight: stageMinH }} role="figure" aria-label="A webpage with JustClarify">
            <div className="jcd-fakebar">
              <i /><i /><i />
              <span>a-long-article-you're-reading.com</span>
            </div>

            {phase === "textarea" ? (
              <TextArea applied={taApplied} taBtnRef={taBtnRef} />
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
                        {ACTIONS.map((a) => (
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
                        ))}
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
                              <span className="jcd-tag" style={{ color: ACCENT }}>
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
            {auto ? "Auto-play is running — click anything to take over." : "Every answer here is pre-written for the demo. The real extension generates them live, on your device."}
          </p>
        </section>

        {/* ── Right: explainer ────────────────────────────────────────── */}
        <aside className="jcd-explain">
          <h1>
            Understand anything you read —<br /> without leaving the page.
          </h1>
          <p className="jcd-lead">
            JustClarify is a browser extension. Highlight any word, sentence, or claim on any page and it
            explains it <b>in the context of what you're reading</b> — right there. No new tab, no chat
            window, no copy-paste.
          </p>

          <h3>How it works</h3>
          <ol className="jcd-how">
            <li><b>Highlight</b> the thing you don't fully get.</li>
            <li><b>Pick how you want it</b> — explain, simpler, expand, define, or fact-check.</li>
            <li><b>Read it in place</b>, then keep reading.</li>
          </ol>

          <h3>Reshape text, too</h3>
          <p>
            The <b>Text area</b> is a scratch pad for writing: paste anything and humanize, shorten, expand,
            or summarize it, fix its grammar, then copy or download the result — Markdown or PDF. Same
            engine, no tab-switch.
          </p>

          <h3>How it answers</h3>
          <p>
            By default, JustClarify runs on <b>Chrome's built-in on-device AI</b> (Gemini Nano) — the model
            downloads once and every answer is generated right on your machine. That makes it free, private,
            and fully offline: nothing you highlight ever leaves your device.
          </p>
          <p>
            Want a sharper answer? Add your own <b>AI Gateway key</b> and JustClarify routes through the
            Vercel AI Gateway to any model you choose — Claude, GPT, Llama, and more. Your key is stored only
            on your device and sent only to the gateway, never to a JustClarify server. On-device stays the
            default; the gateway is there when you reach for it.
          </p>

          <h3>Transparency is the point</h3>
          <p>
            You should always know what's answering you. Every reply <b>badges the exact engine and model</b>
            {" "}that produced it, so an on-device answer and a gateway one are never confused. Fact-checks
            only return a verdict with a <b>source you can click</b> — never an opinion dressed up as a fact.
            And because it runs on-device by default and is open about where anything goes, there's no hidden
            server quietly reading what you read.
          </p>

          <h3>Why it matters</h3>
          <p>
            Reading online means constantly hitting things you half-understand. Today the fix is a detour:
            open a tab, paste into a chatbot, lose your place. JustClarify collapses that into a highlight.
          </p>

          <p className="jcd-thesis">
            The web ships one version of every page to everyone. JustClarify recompiles it for what
            <i> you</i> already know.
          </p>

          <a
            className="jcd-cta"
            href="https://chromewebstore.google.com/detail/justclarify/ggeikfbifbojgkgcehebpelplhajfffj"
            target="_blank"
            rel="noopener noreferrer"
          >
            Add it to Chrome — free
          </a>
        </aside>
      </div>
    </main>
  );
}

function TextArea({ applied, taBtnRef }) {
  const tools = ["Humanize", "Shorten", "Expand", "Summarize"];
  return (
    <div className="jcd-ta">
      <div className="jcd-ta-tools">
        <span className="jcd-ta-title">Text area</span>
        <span className="jcd-ta-dots"><i /><i /><i /></span>
      </div>
      <div className="jcd-ta-body">{applied ? TA_AFTER : TA_BEFORE}</div>
      <div className="jcd-ta-actions">
        {tools.map((t) => (
          <button
            key={t}
            ref={t === "Humanize" ? taBtnRef : null}
            className={"jcd-ta-btn" + (applied && t === "Humanize" ? " is-on" : "")}
            type="button"
          >
            {t}
          </button>
        ))}
      </div>
      <p className="jcd-ta-note">
        {applied ? "Humanized ✓  ·  copy it, or download as Markdown / PDF." : "Paste rough text, pick a tool — it rewrites in place."}
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
.jcd-root { --a: __ACCENT__; min-height: 100vh; background: #faf9f7; color: #14110f;
  font-family: var(--font-inter-tight), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
.jcd-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  padding: 16px 28px; border-bottom: 1px solid #ece7e3; position: sticky; top: 0; background: #faf9f7cc; backdrop-filter: blur(8px); z-index: 20; }
.jcd-brand { display: inline-flex; align-items: center; gap: 9px; text-decoration: none; color: inherit; }
.jcd-mark { display: inline-flex; color: var(--a); }
.jcd-brand-name { font-weight: 700; font-size: 16px; letter-spacing: -0.01em; }
.jcd-top-right { display: inline-flex; align-items: center; gap: 14px; }
.jcd-top-tag { font-size: 12px; color: #8a817a; }
.jcd-auto { padding: 8px 15px; border: 1px solid #14110f; border-radius: 999px; background: #14110f; color: #fff;
  font: 700 12.5px/1 inherit; cursor: pointer; transition: background .16s ease, transform .1s ease; }
.jcd-auto:hover { background: var(--a); border-color: var(--a); }
.jcd-auto.on { background: #fff; color: #14110f; }
.jcd-auto:active { transform: scale(.97); }

.jcd-grid { max-width: 1200px; margin: 0 auto; padding: 40px 28px 80px; display: grid;
  grid-template-columns: 1.15fr 0.85fr; gap: 48px; align-items: start; }
@media (max-width: 900px) { .jcd-grid { grid-template-columns: 1fr; gap: 40px; } }

.jcd-steps { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.jcd-step { display: inline-flex; align-items: center; gap: 7px; padding: 6px 11px; border-radius: 999px;
  border: 1px solid #e7e2dd; background: #fff; font-size: 12px; color: #a39a92; transition: all .2s ease; }
.jcd-step.active { border-color: var(--a); color: #14110f; }
.jcd-step.done { color: #14110f; }
.jcd-step-n { display: grid; place-items: center; width: 17px; height: 17px; border-radius: 50%;
  background: #eee9e4; color: #8a817a; font-size: 10px; font-weight: 700; }
.jcd-step.active .jcd-step-n, .jcd-step.done .jcd-step-n { background: var(--a); color: #fff; }

.jcd-stage { position: relative; border: 1px solid #e7e2dd; border-radius: 16px; overflow: hidden; background: #fff;
  box-shadow: 0 18px 50px rgba(0,0,0,.07); min-height: 600px; }
.jcd-fakebar { display: flex; align-items: center; gap: 6px; padding: 11px 14px; background: #f4f1ee; border-bottom: 1px solid #ece7e3; }
.jcd-fakebar i { width: 10px; height: 10px; border-radius: 50%; background: #d8d2cc; }
.jcd-fakebar span { margin-left: 10px; font-size: 12px; color: #a39a92; }

.jcd-article { padding: 26px 28px 8px; }
.jcd-article h2 { margin: 0 0 12px; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: #14110f; }
/* The article is dimmed so the one selectable phrase stands out. */
.jcd-article p { margin: 0 0 14px; font-size: 16px; line-height: 1.65; color: #bcb4ac; }
.jcd-article .jcd-dim { color: #cfc9c2; }
.jcd-hl { position: relative; color: #14110f; font-weight: 600; cursor: pointer; border-radius: 3px; padding: 0 2px;
  box-decoration-break: clone; -webkit-box-decoration-break: clone; outline: none; }
.jcd-hl.is-live::after { content: ""; position: absolute; left: 0; right: 0; bottom: -2px; height: 2px;
  background: var(--a); border-radius: 2px; animation: jcd-underline 1.5s ease-in-out infinite; }
@keyframes jcd-underline { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
/* Selection sweep: a left→right wipe of "selection blue" (the accent). */
.jcd-hl.is-sel { color: #14110f; }
.jcd-hl.is-sel::before { content: ""; position: absolute; inset: -1px -2px; background: color-mix(in srgb, var(--a) 26%, transparent);
  border-radius: 3px; z-index: -1; transform-origin: left; animation: jcd-sweep .5s cubic-bezier(.4,0,.2,1) both; }
@keyframes jcd-sweep { from { transform: scaleX(0); } to { transform: scaleX(1); } }

/* Floats at the exact bottom of the highlighted phrase (JS-anchored), the way
   the extension anchors to the selection. */
.jcd-pop { position: absolute; z-index: 12; }

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
  animation: jcd-blob-in .28s cubic-bezier(.34,1.3,.64,1) both; }
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

.jcd-panel { width: 360px; max-width: 100%; margin-top: 10px; padding: 16px 18px; background: #fff;
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
.jcd-ta { margin: 22px 28px 26px; border: 1px solid #e7e2dd; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,.06); animation: jcd-panel-in .3s ease both; }
.jcd-ta-tools { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #ece7e3; background: #faf8f6; }
.jcd-ta-title { font-size: 12px; font-weight: 700; color: #6d645d; }
.jcd-ta-dots { display: inline-flex; gap: 5px; }
.jcd-ta-dots i { width: 8px; height: 8px; border-radius: 50%; background: #d8d2cc; }
.jcd-ta-body { padding: 18px 18px; min-height: 96px; font-size: 15px; line-height: 1.6; color: #1a1a1a; }
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

.jcd-explain { position: sticky; top: 90px; }
@media (max-width: 900px) { .jcd-explain { position: static; } }
.jcd-explain h1 { margin: 0 0 16px; font-size: 30px; line-height: 1.15; font-weight: 800; letter-spacing: -0.03em; }
.jcd-lead { margin: 0 0 20px; font-size: 15.5px; line-height: 1.6; color: #3a342f; }
.jcd-explain h3 { margin: 22px 0 9px; font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--a); }
.jcd-how { margin: 0; padding-left: 0; list-style: none; counter-reset: jcd; }
.jcd-how li { counter-increment: jcd; position: relative; padding: 6px 0 6px 30px; font-size: 14.5px; line-height: 1.55; color: #3a342f; }
.jcd-how li::before { content: counter(jcd); position: absolute; left: 0; top: 6px; width: 20px; height: 20px; display: grid; place-items: center;
  border-radius: 50%; background: color-mix(in srgb, var(--a) 12%, transparent); color: var(--a); font-size: 11px; font-weight: 800; }
.jcd-explain p { font-size: 14.5px; line-height: 1.6; color: #3a342f; margin: 0 0 12px; }
.jcd-thesis { margin: 20px 0; padding: 14px 16px; background: color-mix(in srgb, var(--a) 6%, transparent);
  border-left: 3px solid var(--a); border-radius: 0 10px 10px 0; font-size: 15px; line-height: 1.55; color: #14110f; }
.jcd-cta { display: inline-block; margin-top: 8px; padding: 12px 20px; background: #14110f; color: #fff; text-decoration: none;
  border-radius: 11px; font-weight: 700; font-size: 14px; transition: transform .12s ease, background .16s ease; }
.jcd-cta:hover { background: var(--a); }
.jcd-cta:active { transform: scale(.98); }

@media (prefers-reduced-motion: reduce) {
  .jcd-hl.is-live::after, .jcd-skel span, .jcd-btn-ico, .jcd-panel, .jcd-blob, .jcd-row, .jcd-cursor { animation: none; transition: none; }
}
`;
