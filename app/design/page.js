"use client";

// /design — the extension's visual reference sheet.
//
// Every surface the extension can put on screen, in every state it can be in,
// built from the real markup and the real numbers in
// ambient-explainer-extension/. This is a working document for redesign: if a
// specimen here looks wrong, that IS the design problem, not a rendering bug.
//
// The accent is deliberately re-mintable at the top of the page — the shipped
// extension picks a fresh dull OKLCH hue on every browser start (brand.js), so
// no design decision here is allowed to depend on the colour being red.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Ico, ICON_NAMES, iconMarkup } from "./icons";
import { ThinkingOrb } from "thinking-orbs";
import { ICON_INSET, REICON, SLOT_MEANING } from "./icon-packs";
import "./design.css";

// Same ranges as brand.js: medium lightness, low chroma, any hue.
function mintAccent() {
  const l = +(0.55 + Math.random() * 0.11).toFixed(3);
  const c = +(0.05 + Math.random() * 0.06).toFixed(3);
  const h = Math.floor(Math.random() * 360);
  return { l, c, h, css: `oklch(${l} ${c} ${h})` };
}

const SECTIONS = [
  ["01", "foundations", "Foundations"],
  ["02", "icons", "Icon family"],
  ["03", "trigger", "The trigger"],
  ["04", "actionrow", "Action row"],
  ["05", "loading", "Loading states"],
  ["06", "answer", "Answer panel"],
  ["07", "blocks", "Answer blocks"],
  ["08", "extras", "Panel extras"],
  ["09", "factcheck", "Fact-check"],
  ["10", "textarea", "Text area"],
  ["11", "texttools", "Text tools"],
  ["12", "voice", "Voice chip"],
  ["13", "pagefeedback", "Page feedback"],
  ["14", "toolbar", "Toolbar popup"],
  ["15", "skins", "Skin archive"],
];

const SECTION_IDS = new Set(SECTIONS.map(([, id]) => id));

/* --- Collapse ---------------------------------------------------------------
   Every specimen on this sheet is live, not a screenshot, and the live ones are
   not cheap: section 05 alone mounts nineteen thinking-orbs, and each orb is a
   canvas driving its own requestAnimationFrame loop. With all fifteen sections
   rendered at once the page kept roughly twenty-five animation loops running at
   all times, nearly all of them for topics nobody was looking at.

   So a closed section is UNMOUNTED, not hidden. display:none would have left
   every canvas painting behind a collapsed header; returning null means those
   canvases are never created, the skin archive never lays out, and the icon
   grid never rasterises. Closing a topic you are not using is the entire
   mechanism by which it stops costing anything. */
const OPEN_KEY = "jc-design-open";
const DEFAULT_OPEN = ["foundations"];

const OpenCtx = createContext(null);

// Every loading indicator on the page is a thinking-orb. Theme is pinned to
// `light` rather than left on `auto`: the orbs sit on the product's white
// surfaces, but `auto` would resolve against the VIEWER's colour scheme, so a
// reader on a dark OS would get light ink painted onto white paper.
//
// Only two sizes ship, 64 and 20, and they are separate designs rather than a
// scale factor, so each surface gets whichever preset its slot was built for.
function Orb({ state, size = 20, ...rest }) {
  return <ThinkingOrb state={state} size={size} theme="light" {...rest} />;
}

// The nine states, so a surface can be matched to a verb rather than to
// whichever spinner was nearest.
const ORB_STATES = [
  ["working", "particles on tilted orbits"],
  ["searching", "a scan meridian sweeps a dotted globe"],
  ["solving", "bands scramble, then click back solved"],
  ["listening", "a waveform rolls through the rings"],
  ["connecting", "a constellation wires itself"],
  ["weaving", "three strands plait around the sphere"],
  ["composing", "an undulating multi-band sash"],
  ["breathing", "a ring slowly morphing"],
  ["shaping", "circle to triangle to square"],
];

// Same optical inset the Ico component applies, for the two places that render
// a Reicon body directly.
function insetBox(ic) {
  const p = ic.pad ?? ICON_INSET;
  return `${-p} ${-p} ${ic.w + p * 2} ${ic.h + p * 2}`;
}

function Diamond({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="20" height="20" rx="5" transform="rotate(45 16 16)" fill="currentColor" />
      <rect x="11.5" y="11.5" width="9" height="9" rx="2.5" transform="rotate(45 16 16)" fill="#fff" />
    </svg>
  );
}

// The engine picker's two drawn marks, kept here so both specimens below draw
// from one source. A ticket for the pass that is open for now, a plug for the
// connection you bring; a key would have said the same thing twice, since the
// row underneath the control is already "Use your own AI key". The middle
// segment carries the chosen provider's own logo, so its slot stays empty here
// and only holds the height.
function SegIco({ mark }) {
  if (!mark) return <span className="jc-seg-ico jc-seg-ico-slot" aria-hidden="true" />;
  return (
    <svg viewBox="0 0 24 24" className="jc-ico jc-seg-ico" aria-hidden="true">
      {mark === "ticket" ? (
        <>
          <path d="M4.5 6.5H19.5A2 2 0 0 1 21.5 8.5V9.8A2.2 2.2 0 0 0 21.5 14.2V16.5A2 2 0 0 1 19.5 18.5H4.5A2 2 0 0 1 2.5 16.5V14.2A2.2 2.2 0 0 0 2.5 9.8V8.5A2 2 0 0 1 4.5 6.5Z" />
        </>
      ) : (
        <>
          <path d="M9 7.5V2.5M15 7.5V2.5M12 21.5V16.9" />
          <path d="M17.5 7.5V10.9A5.5 5.5 0 0 1 6.5 10.9V7.5Z" />
        </>
      )}
    </svg>
  );
}

const SEG_ENGINES = [
  ["Early access", "ticket"],
  ["Your LLM", null],
  ["API", "plug"],
];

// Reads its own open state out of context rather than taking it as a prop, so
// the fifteen call sites below stay exactly as they read before: a section
// declares what it is, not whether it happens to be showing.
function Sec({ num, id, title, blurb, children }) {
  const ctx = useContext(OpenCtx);
  const open = ctx ? ctx.open.has(id) : true;
  return (
    <section className={`dsx-sec${open ? " is-open" : ""}`} id={id}>
      {/* Button inside the heading, not heading inside the button. A <button>
          takes phrasing content only, so an <h2> in there is invalid markup —
          and this sheet is navigated by heading, so the outline is the one
          thing the collapse is not allowed to cost. aria-controls is dropped
          while closed because the element it would name does not exist. */}
      <h2 className="dsx-sec-head">
        <button
          className="dsx-sec-toggle"
          type="button"
          aria-expanded={open}
          aria-controls={open ? `${id}-body` : undefined}
          onClick={() => ctx && ctx.toggle(id)}
        >
          <span className="dsx-sec-num">{num}</span>
          <span className="dsx-sec-title">{title}</span>
          <span className="dsx-sec-caret" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
              strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 9 7 7 7-7" />
            </svg>
          </span>
        </button>
      </h2>
      {open ? (
        <div className="dsx-sec-body" id={`${id}-body`}>
          {blurb ? <p>{blurb}</p> : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}

function BarBtn({ icon, label, state = "" }) {
  const busy = state.includes("is-loading");
  return (
    <button className={`jc-bar-btn ${state}`} type="button">
      <span className="jc-bar-icon">
        {busy ? <Orb state="working" size={20} /> : <Ico name={icon} size={20} />}
      </span>
      <span className="jc-bar-label">{label}</span>
    </button>
  );
}

function ActionRow({ items, prevDisabled = true, nextDisabled = false }) {
  return (
    <div className="jc-action-row">
      <button className="jc-row-arrow" type="button" disabled={prevDisabled} aria-label="Previous actions">
        <Ico name="chevronLeft" size={16} />
      </button>
      <div className="jc-row-view">
        <div className="jc-row-track">
          {items.map((it) => (
            <BarBtn key={it.label} icon={it.icon} label={it.label} state={it.state} />
          ))}
        </div>
      </div>
      <button className="jc-row-arrow" type="button" disabled={nextDisabled} aria-label="More actions">
        <Ico name="chevronRight" size={16} />
      </button>
    </div>
  );
}

function VerdictRow({ tone, word, meta, quote, body, refs }) {
  return (
    <div className={`jc-fc jc-fc--${tone} jc-fc-row`}>
      <div className="jc-fc-verdict">
        <span className="jc-fc-mark" />
        <span className="jc-fc-word">{word}</span>
        <span className="jc-fc-meta">{meta}</span>
      </div>
      <p className="jc-fc-quote">{quote}</p>
      <p className="jc-fc-body">{body}</p>
      {refs ? (
        <ul className="jc-fc-refs">
          {refs.map((r) => (
            <li key={r[0]}>
              <a href="#0" onClick={(e) => e.preventDefault()}>
                <span className="jc-fc-refhost">{r[0]}</span>
                <span className="jc-fc-reftitle">{r[1]}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// listening / hearing / thinking are the live states, and they now carry an orb
// instead of a pulsing dot. done / unknown / error stay a dot on purpose: their
// whole job is to be a COLOUR, green or red, and the orb is strictly monochrome.
const ORB_FOR_VOICE = { listening: "listening", hearing: "listening", thinking: "solving", confirm: "breathing" };

function Chip({ state, live, text, cls = "", actions }) {
  const orb = ORB_FOR_VOICE[state];
  return (
    <div className={`vchip ${cls}${orb ? " has-orb" : ""}`} data-state={state} data-live={live ? "1" : undefined}>
      {orb ? <Orb state={orb} size={20} className="jc-voice-orb" /> : <span className="jc-voice-dot" />}
      <span className="jc-voice-text">{text}</span>
      {actions ? (
        <span className="jc-voice-actions">
          {actions.map((a) => (
            <button key={a} className="jc-voice-btn" type="button">
              {a}
            </button>
          ))}
        </span>
      ) : null}
    </div>
  );
}

const SKIN_ACTIONS = [
  { icon: "explain", label: "Explain" },
  { icon: "expand", label: "Expand" },
  { icon: "define", label: "Define" },
  { icon: "factcheck", label: "Fact-check" },
  { icon: "textarea", label: "Text area" },
  { icon: "summarize", label: "Summarize" },
];

const SKINS = [
  ["Axis", "Deliberate rules, white field, black instruments."],
  ["Margin", "Reading-room list, one choice per line."],
  ["Index", "Framed reference cards, visibly denser."],
  ["Marker", "One highlighter-like dominant action."],
  ["Lens", "Quiet instrument panel, icon-first."],
];

function Skin({ i }) {
  const items = i === 4 ? SKIN_ACTIONS.slice(0, 5) : i === 0 ? SKIN_ACTIONS.slice(0, 4) : SKIN_ACTIONS;
  return (
    <div>
      <div className={`skin skin--${i}`}>
        <div className="skin-head">
          <span className="skin-brand">
            <i />
            <span>
              Just<em>Clarify</em>
            </span>
          </span>
          <span className="skin-cap">{SKINS[i][0]}</span>
        </div>
        <div className="skin-actions">
          {items.map((a) => (
            <button key={a.label} type="button">
              <span className="ic">
                <Ico name={a.icon} size={18} />
              </span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
        <button className="skin-more" type="button">
          <span>More</span>
          <span>+</span>
        </button>
      </div>
      <p className="dsx-cap">
        <b>
          0{i + 1} {SKINS[i][0]}
        </b>{" "}
        : {SKINS[i][1]}
      </p>
    </div>
  );
}

export default function DesignPage() {
  const [accent, setAccent] = useState({ l: 0.56, c: 0.1, h: 28, css: "oklch(0.56 0.1 28)" });
  const [pct] = useState(64);
  const [open, setOpen] = useState(() => new Set(DEFAULT_OPEN));

  // Handlers read the live set through this ref rather than through a closure.
  // The hashchange listener below is registered once, and a closure would leave
  // it firing forever against whatever happened to be open at mount.
  const openRef = useRef(open);

  // Saving happens at the point of change and nowhere else. An effect keyed on
  // `open` would also fire once on mount, before the restore below has been
  // committed, and write the default straight over what was saved — and under
  // StrictMode's second pass that clobber reads back as the truth, so "Close
  // all" could never survive a reload.
  const commit = (next) => {
    openRef.current = next;
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
    } catch {
      // Private mode or a full quota: the sheet still works, it just forgets.
    }
  };

  // localStorage and the URL hash are read AFTER the first paint, deliberately.
  // This route is server-rendered even though it is a client component, and
  // seeding state from either during the initial render would hand React a
  // tree the server could not possibly have produced. This effect only ever
  // READS, so running it twice is running it once.
  useEffect(() => {
    let next = null;
    try {
      const saved = JSON.parse(window.localStorage.getItem(OPEN_KEY) || "null");
      if (Array.isArray(saved)) next = new Set(saved.filter((id) => SECTION_IDS.has(id)));
    } catch {
      // A hand-edited or half-written entry just falls back to the default.
    }
    // A link straight to /design#voice has to arrive with voice already open,
    // whatever was left open last time.
    const deep = window.location.hash.slice(1);
    if (SECTION_IDS.has(deep)) {
      next = new Set(next || DEFAULT_OPEN);
      next.add(deep);
    }
    if (next) {
      openRef.current = next;
      setOpen(next);
    }
  }, []);

  // Bring a section into view once its body has actually mounted. The browser
  // already jumped to the collapsed header, which is the wrong place the moment
  // the content appears underneath it.
  const reveal = (id) => {
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const openSection = (id) => {
    if (!openRef.current.has(id)) commit(new Set(openRef.current).add(id));
    reveal(id);
  };

  // Back and forward between hashes, and any link into the sheet from
  // elsewhere on the site. Clicking a nav item whose hash is already current
  // fires no hashchange at all, which is why the links carry their own handler.
  useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.slice(1);
      if (SECTION_IDS.has(id)) openSection(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Collapsing never moves the header you clicked: a section only affects the
  // layout below itself, so there is nothing to re-anchor here.
  const toggle = (id) => {
    const next = new Set(openRef.current);
    if (!next.delete(id)) next.add(id);
    commit(next);
  };

  const style = {
    "--accent": accent.css,
    "--accent-soft": `oklch(${accent.l} ${accent.c} ${accent.h} / 0.1)`,
  };

  return (
    <OpenCtx.Provider value={{ open, toggle }}>
    <div className="dsx" style={style}>
      <div className="dsx-shell">
        {/* ── Nav ────────────────────────────────────────────────────────── */}
        <nav className="dsx-nav">
          <div className="dsx-brand">
            <Diamond size={18} />
            <b>JustClarify</b>
          </div>
          <p className="dsx-brand-sub">Extension design sheet</p>

          {SECTIONS.map(([n, id, title]) => (
            <a
              key={id}
              href={`#${id}`}
              className={open.has(id) ? "is-open" : ""}
              onClick={() => openSection(id)}
            >
              <i>{n}</i>
              <span>{title}</span>
              {open.has(id) ? <b aria-label="loaded" /> : null}
            </a>
          ))}

          {/* The count is the honest reading of what this page currently costs:
              a closed topic is not on screen and not in the tree. */}
          <div className="dsx-nav-bulk">
            <button type="button" onClick={() => commit(new Set(SECTIONS.map(([, id]) => id)))}>
              Open all
            </button>
            <button type="button" onClick={() => commit(new Set())}>
              Close all
            </button>
            <span>
              {open.size} of {SECTIONS.length} loaded
            </span>
          </div>

          <button className="dsx-mint" type="button" onClick={() => setAccent(mintAccent())}>
            Re-mint accent
            <span>
              oklch({accent.l} {accent.c} {accent.h})
            </span>
          </button>

        </nav>

        {/* ── Main ───────────────────────────────────────────────────────── */}
        <main className="dsx-main">
          <header className="dsx-head">
            <h1>Every surface the extension can show</h1>
            <p>
              Built from the shipped markup and the shipped numbers in{" "}
              <code>ambient-explainer-extension/</code>: <code>styles.css</code>,{" "}
              <code>voice.js</code>, <code>popup.css</code>, <code>content.js</code>. Nothing here is a
              mockup approximation: the CSS is copied across, so what looks wrong on this page looks
              wrong in the product. The accent is random per browser start, so re-mint it and check every
              decision survives a hue you did not pick.
            </p>
          </header>

          {/* ================= 01 Foundations ================= */}
          <Sec
            num="01"
            id="foundations"
            title="Foundations"
            blurb="Two palettes run side by side: the in-page surfaces (styles.css, warm-neutral ink on white) and the toolbar popup (popup.css, its own warmer paper). The accent is the only colour with a job: state, never decoration."
          >
            <div className="dsx-label">Accent, minted per browser start</div>
            <div className="dsx-swatches">
              <div className="dsx-sw">
                <i style={{ background: "var(--accent)" }} />
                <b>--accent</b>
                <span>oklch(0.55–0.66 / 0.05–0.11 / any hue)</span>
              </div>
              <div className="dsx-sw">
                <i style={{ background: "var(--accent-soft)" }} />
                <b>--accent-soft</b>
                <span>alpha 0.10</span>
              </div>
              <div className="dsx-sw">
                <i style={{ background: `oklch(${accent.l} ${accent.c} ${accent.h} / 0.06)` }} />
                <b>--accent-wash</b>
                <span>alpha 0.06</span>
              </div>
              <div className="dsx-sw">
                <i style={{ background: `oklch(${accent.l} ${accent.c} ${accent.h} / 0.28)` }} />
                <b>--accent-line</b>
                <span>alpha 0.28</span>
              </div>
            </div>

            <div className="dsx-note">
              <b>The constraint everything else inherits.</b> brand.js mints one dull hue on install /
              startup, stores it under <code>jcBrand</code>, and every surface, from the toolbar icon canvas to the popup, the in-page UI and the history page, paints from that same value. Low chroma is deliberate:
              it never screams the way the old fixed red did. Design nothing that needs the accent to be
              warm, or dark, or high-contrast against white.
            </div>

            <div style={{ height: 28 }} />
            <div className="dsx-label">In-page surface palette</div>
            <div className="dsx-swatches">
              {[
                ["--surface-color", "#ffffff", "panel + popup fill"],
                ["--bg-color", "#fafafa", "chips, code, inset"],
                ["--border-color", "#e6e6e6", "hairlines"],
                ["--text-primary", "#1a1a1a", "answer text"],
                ["--text-secondary", "#555555", "captions"],
                ["ink (fc)", "#24211f", "fact-check body"],
                ["muted (fc)", "#6b645e", "quotes"],
                ["faint (fc)", "#a49d97", "datelines"],
              ].map(([name, hex, use]) => (
                <div className="dsx-sw" key={name}>
                  <i style={{ background: hex, borderBottom: "1px solid var(--sheet-line)" }} />
                  <b>{name}</b>
                  <span>
                    {hex}, {use}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ height: 28 }} />
            <div className="dsx-label">Verdict colours (fact-check only)</div>
            <div className="dsx-swatches">
              {[
                ["True", "#0b6b2d"],
                ["Mixed", "#8a5d00"],
                ["False", "#c00000"],
                ["Unverified", "#6b645e"],
              ].map(([n, hex]) => (
                <div className="dsx-sw" key={n}>
                  <i style={{ background: hex }} />
                  <b>{n}</b>
                  <span>{hex}</span>
                </div>
              ))}
            </div>

            <div style={{ height: 28 }} />
            <div className="dsx-label">Type scale: Inter, one family everywhere</div>
            <div className="dsx-type">
              {[
                ["650 15px / -0.01em", "Panel title (the quoted selection)", 15, 650, "-0.01em"],
                ["400 15–16px / 1.55", "Answer body", 16, 400, "-0.005em"],
                ["560 15px / 1.6", "Key takeaway", 15, 560, "0"],
                ["600 15px / -0.022em", "Fact-check verdict", 15, 600, "-0.022em"],
                ["400 13px / 1.6", "Fact-check body", 13, 400, "-0.006em"],
                ["600 11px", "Action row label", 11, 600, "0"],
                ["700 9px / 0.12em caps", "Kicker", 9, 700, "0.12em"],
                ["400 10px", "Dateline / footer meta", 10, 400, "0"],
              ].map(([spec, use, size, weight, ls]) => (
                <div className="dsx-type-row" key={spec}>
                  <i>{spec}</i>
                  <span
                    style={{
                      fontSize: size,
                      fontWeight: weight,
                      letterSpacing: ls,
                      textTransform: spec.includes("caps") ? "uppercase" : "none",
                    }}
                  >
                    {use}
                  </span>
                </div>
              ))}
            </div>

            <table className="dsx-spec">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Spacing</td>
                  <td>4 / 8 / 16 / 24, on an 8px base</td>
                </tr>
                <tr>
                  <td>Radii</td>
                  <td>8 (sm) / 12 (md) / 14 (lg), plus corner-shape: squircle</td>
                </tr>
                <tr>
                  <td>--popup-shadow</td>
                  <td>0 1px 2px rgba(0,0,0,.03), 0 6px 20px rgba(0,0,0,.055)</td>
                </tr>
                <tr>
                  <td>--panel-shadow</td>
                  <td>0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.07)</td>
                </tr>
                <tr>
                  <td>Motion</td>
                  <td>140–220ms, ease-out / cubic-bezier(.215,.61,.355,1); all off under reduced-motion</td>
                </tr>
                <tr>
                  <td>z-index</td>
                  <td>999999 popup · 2147483646 overlays · 2147483647 voice chip</td>
                </tr>
              </tbody>
            </table>

            <div className="dsx-stage" style={{ marginTop: 22 }}>
              <div className="dsx-label">Elevation, side by side</div>
              <div className="dsx-shadowbox">
                <div style={{ boxShadow: "var(--popup-shadow)" }}>popup</div>
                <div style={{ boxShadow: "var(--panel-shadow)" }}>panel</div>
                <div style={{ boxShadow: "0 8px 24px rgba(0,0,0,.13), 0 1px 2px rgba(0,0,0,.08)" }}>action row</div>
                <div style={{ boxShadow: "0 14px 34px rgba(0,0,0,.16), 0 2px 6px rgba(0,0,0,.07)" }}>text area</div>
                <div style={{ boxShadow: "0 1px 2px rgba(0,0,0,.05), 0 6px 16px rgba(0,0,0,.07)" }}>voice chip</div>
              </div>
              <p className="dsx-cap dsx-cap-in">
                Deliberately light. These surfaces arrive uninvited next to something the reader was
                already reading, and a heavy shadow reads as a modal demanding attention.
              </p>
            </div>
          </Sec>

          {/* ================= 02 Icons ================= */}
          <Sec
            num="02"
            id="icons"
            title="Icon family"
            blurb="Reicon outline is the set, and every icon on this page draws from it. Below it: the Phosphor-style duotone set the extension still ships, so the two can be compared, and what each action means and therefore what its icon has to say."
          >
            <div className="dsx-stage">
              <div className="dsx-label">Reicon outline, all 23 slots</div>
              <div className="dsx-icons">
                {ICON_NAMES.map((n) => {
                  const ic = REICON[n];
                  return (
                    <div className="dsx-ico" key={n}>
                      <svg
                        className="jc-lucide jc-pack"
                        viewBox={insetBox(ic)}
                        width="24"
                        height="24"
                        aria-hidden="true"
                        dangerouslySetInnerHTML={{ __html: ic.b }}
                      />
                      <span>{n}</span>
                    </div>
                  );
                })}
              </div>
              <p className="dsx-cap dsx-cap-in">
                MIT, no attribution clause, 6,586 icons, and it resolves all 23 slots. A 24 grid with a
                1.5px stroke, so it sits a hair lighter than the duotone set it replaces. The two weights
                it also ships, duotone and fill, are drawn from the same shapes, which means changing your
                mind later costs one line.
              </p>
            </div>

            <div className="dsx-stage" style={{ marginTop: 20 }}>
              <div className="dsx-label">What the extension still ships, for comparison</div>
              <div className="dsx-icons">
                {ICON_NAMES.map((n) => (
                  <div className="dsx-ico" key={n}>
                    <Ico name={n} size={24} />
                    <span>{n}</span>
                  </div>
                ))}
              </div>
              <p className="dsx-cap dsx-cap-in">
                Two layers: a 20%-opacity filled silhouette behind a 1.7px stroked foreground, on a 24
                grid. This is what <code>content.js</code> draws today, and it is not yet Reicon: the
                swap has been decided here, not applied there. Note the <b>example</b> slot, which has no
                entry in either map and silently falls back to Explain&rsquo;s magnifier.
              </p>
            </div>

            {/* ---- what each icon has to mean ---- */}
            <div className="dsx-subhead" style={{ marginTop: 40 }}>
              <span className="dsx-sec-num">02.1</span>
              <h2 className="dsx-sec-title">What each icon has to say</h2>
            </div>
            <p>
              The first pass picked icons by convenience, not by meaning, and two of them were plainly the
              wrong word. Explain resolved to a magnifying glass, which says <i>search</i>. Expand
              resolved to resize arrows, which says <i>window control</i>. Both are now chosen from what
              the action does. Left column is the duotone set the extension ships today, right is Reicon
              outline.
            </p>

            <div className="dsx-mean">
              {SLOT_MEANING.map(([slot, does, says, was]) => {
                const alt = REICON[slot];
                return (
                  <div className="dsx-mean-row" key={slot}>
                    <div className="dsx-mean-pair">
                      <span className="dsx-mean-ico">
                        <svg
                          className="jc-lucide jc-ph"
                          viewBox="0 0 24 24"
                          width="22"
                          height="22"
                          aria-hidden="true"
                          dangerouslySetInnerHTML={{ __html: iconMarkup(slot) }}
                        />
                      </span>
                      <span className={`dsx-mean-ico${alt ? "" : " is-empty"}`}>
                        {alt ? (
                          <svg
                            className="jc-lucide jc-pack"
                            viewBox={insetBox(alt)}
                            width="22"
                            height="22"
                            aria-hidden="true"
                            dangerouslySetInnerHTML={{ __html: alt.b }}
                          />
                        ) : null}
                      </span>
                    </div>
                    <div className="dsx-mean-text">
                      <b>{slot}</b>
                      <span className="dsx-mean-does">{does}</span>
                      <span className="dsx-mean-says">Should say: {says}</span>
                      {was === "unchanged" ? null : (
                        <span className="dsx-mean-was">Was: {was}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ---- the pack library ---- */}
            <div className="dsx-note">
              <b>Why Reicon outline.</b> MIT with no attribution clause, unlike Solar which draws nearly
              the same shapes under CC BY. It resolves all 23 slots, it ships duotone and fill weights
              from the same drawings so the weight stays a one-line decision later, and at 6,586 icons
              there is room for every action this product has not built yet. The one compromise is the
              four align slots: Reicon has no text-align family, so those are object-alignment glyphs
              doing a text-alignment job.
            </div>

            <div className="dsx-stage" style={{ marginTop: 24 }}>
              <div className="dsx-label">Sizes in use</div>
              <div className="dsx-icoscale">
                <div>
                  <Ico name="factcheck" size={26} />
                  26: skin 05 ring
                </div>
                <div>
                  <Ico name="factcheck" size={22} />
                  22: action row
                </div>
                <div>
                  <Ico name="factcheck" size={19} />
                  19: text-area tool
                </div>
                <div>
                  <Ico name="factcheck" size={17} />
                  17: pager arrows
                </div>
                <div>
                  <Ico name="factcheck" size={15} />
                  15: panel tag
                </div>
              </div>
              <p className="dsx-cap dsx-cap-in">
                The real test of a pack is 15px, not 24. Fill weights hold up smallest, line weights go
                muddy first, and duotone lives or dies on how much contrast the underlayer keeps.
              </p>
            </div>

            <div className="dsx-stage" style={{ marginTop: 20 }}>
              <div className="dsx-label">Packaged assets</div>
              <div className="dsx-row" style={{ alignItems: "center", gap: 34 }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 20, color: "var(--accent)" }}>
                  {[16, 32, 48, 96, 128].map((s) => (
                    <div key={s} style={{ textAlign: "center" }}>
                      <Diamond size={Math.min(s, 64)} />
                      <div style={{ marginTop: 6, color: "#7c736c", font: "500 10px/1 Inter" }}>
                        icon-{s}.png
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <p className="dsx-cap dsx-cap-in">
                The toolbar icon is redrawn on a canvas at runtime in the minted accent, and{" "}
                <code>jcBrandRgb()</code> converts OKLCH to sRGB for exactly this. The mark is a rounded
                square rotated 45°, with a smaller rotated square knocked out of the middle.{" "}
                <code>assets/blob.svg</code> (a plain 12px red circle) is a leftover from the previous
                trigger and is no longer referenced.
              </p>
            </div>
          </Sec>

          {/* ================= 03 Trigger ================= */}
          <Sec
            num="03"
            id="trigger"
            title="The trigger"
            blurb="What appears when you highlight: a 16px diamond, pinned 6px right and 2px below the bottom-right of the selection rect. It is the whole first impression, because everything else is behind one click on it."
          >
            <div className="dsx-stage dsx-stage--article">
              <div className="dsx-article">
                <p>
                  The committee&rsquo;s finding rested on a single contested figure, and the argument that
                  followed turned on whether{" "}
                  <span className="dsx-selection">regulatory capture</span>
                  <span className="dsx-blob dsx-blob-anim">
                    <Diamond size={16} />
                  </span>{" "}
                  had occurred at all, or whether the agency had simply been outmatched.
                </p>
              </div>
              <p className="dsx-cap dsx-cap-in">
                In place, at real size, mid-paragraph: the honest test. Entrance is{" "}
                <code>blob-morph-reveal</code>, 0.5s: a clip-path wipe from the top-left plus a scale from
                0.5, so it draws itself into existence rather than popping.
              </p>
            </div>

            <div className="dsx-stage" style={{ marginTop: 20 }}>
              <div className="dsx-label">States</div>
              <div className="dsx-row" style={{ gap: 46, alignItems: "flex-end" }}>
                {[
                  ["Rest", "dsx-blob--big"],
                  ["Hover: opacity .85", "dsx-blob--big dsx-blob--hover"],
                  ["Exit: scale .3, 0.25s", "dsx-blob--big dsx-blob--exit"],
                ].map(([label, cls]) => (
                  <div key={label} style={{ textAlign: "center" }}>
                    <span className={`dsx-blob ${cls}`}>
                      <Diamond size={48} />
                    </span>
                    <div style={{ marginTop: 10, color: "#7c736c", font: "500 11px/1.3 Inter" }}>{label}</div>
                  </div>
                ))}
              </div>
              <p className="dsx-cap dsx-cap-in">Shown at 3×. The real thing is 16×16.</p>
            </div>

            <div className="dsx-note">
              <b>Worth questioning in a redesign.</b> Hover is the only affordance and it is a 15% opacity
              drop on a 16px target, below the 24px minimum most pointer guidance uses, with no cursor
              change beyond <code>pointer</code> and no tooltip saying what a click does.
            </div>
          </Sec>

          {/* ================= 04 Action row ================= */}
          <Sec
            num="04"
            id="actionrow"
            title="Action row"
            blurb="Click the diamond and the popup shell goes transparent, leaving only this. One horizontal row, paged by arrows, so every action stays reachable without a second menu and no design controls compete with the page underneath."
          >
            <div className="dsx-stage dsx-stage--grid">
              <div className="dsx-col" style={{ gap: 34 }}>
                <div>
                  <div className="dsx-label">Page 1: single word selected</div>
                  <ActionRow
                    items={[
                      { icon: "explain", label: "Explain" },
                      { icon: "expand", label: "Expand" },
                      { icon: "define", label: "Define" },
                    ]}
                  />
                  <p className="dsx-cap dsx-cap-in">
                    Define only joins page 1 when the highlight is one word: a dictionary lookup, not a
                    model answer.
                  </p>
                </div>

                <div>
                  <div className="dsx-label">Page 1: phrase or sentence selected</div>
                  <ActionRow
                    items={[
                      { icon: "explain", label: "Explain" },
                      { icon: "expand", label: "Expand" },
                    ]}
                  />
                </div>

                <div>
                  <div className="dsx-label">Page 2: behind the › arrow</div>
                  <ActionRow
                    prevDisabled={false}
                    items={[
                      { icon: "factcheck", label: "Fact-check" },
                      { icon: "textarea", label: "Text area" },
                      { icon: "example", label: "Example" },
                    ]}
                  />
                </div>

                <div>
                  <div className="dsx-label">Page 3: context-conditional</div>
                  <ActionRow
                    prevDisabled={false}
                    nextDisabled
                    items={[
                      { icon: "translate", label: "Translate" },
                      { icon: "summarize", label: "Summarize" },
                    ]}
                  />
                  <p className="dsx-cap dsx-cap-in">
                    Translate appears only when the selection reads as non-English (diacritic ratio ≥ 12%);
                    Summarize only when it is ≥ 4 lines or ≥ 40 words.
                  </p>
                </div>

                <div>
                  <div className="dsx-label">Hover · Running · Both arrows live</div>
                  <ActionRow
                    prevDisabled={false}
                    items={[
                      { icon: "explain", label: "Explain", state: "is-hover" },
                      { icon: "expand", label: "Expand", state: "is-loading" },
                      { icon: "define", label: "Define" },
                    ]}
                  />
                  <p className="dsx-cap dsx-cap-in">
                    While an action runs, the icon is replaced by the 20px orb in its slot, so the button
                    keeps its exact width and the row never reflows mid-request. Hover tints the icon
                    accent and the cell <code>#f1f1ef</code>.
                  </p>
                </div>

                <div>
                  <div className="dsx-label">Translate: the row morphs into a prompt</div>
                  <div className="jc-action-row jc-bar-form">
                    <span className="jc-bar-label">Translate to</span>
                    <input className="jc-lang-input" defaultValue="Yoruba" aria-label="Language" />
                    <button className="jc-bar-go" type="button">
                      →
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <table className="dsx-spec">
              <thead>
                <tr>
                  <th>Element</th>
                  <th>Spec</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Row</td>
                  <td>padding 3px 4px · gap 4px · radius 10px · bg rgba(255,255,255,.96) · border rgba(17,17,17,.10)</td>
                </tr>
                <tr>
                  <td>Button</td>
                  <td>min-width 56px · padding 6px 8px 7px · column · icon-to-label gap 5px · font 600 10px lowercase</td>
                </tr>
                <tr>
                  <td>Icon</td>
                  <td>20px · #141414 rest → var(--accent) hover · morph 0.3s cubic-bezier(.34,1.45,.6,1)</td>
                </tr>
                <tr>
                  <td>Arrow</td>
                  <td>26 × 30px · opacity .23 disabled · same #f1f1ef hover fill</td>
                </tr>
                <tr>
                  <td>Press</td>
                  <td>scale(0.96) on both buttons and arrows</td>
                </tr>
              </tbody>
            </table>

            <div className="dsx-note">
              <b>These numbers are ahead of the extension.</b> The row above is the tightened spec: the
              button box lost 12px of width and 7px of height, the icon dropped from 22 to 20, the label
              from 11 to 10, and the pager arrows to 26 × 30. Overall the row is about 16% shorter.{" "}
              <code>styles.css</code> in the extension still carries the old values, so this is the one
              place on the page where the specimen leads the product rather than mirroring it.
            </div>

            <div className="dsx-note">
              <b>The tension in this component.</b> Paging is invisible state: nothing tells the reader
              there are 2–3 pages, or that Fact-check exists at all, until they press ›. Two actions are
              one arrow-press from being undiscoverable, and the fixed 74px min-width means a page never
              holds more than three on a narrow viewport.
            </div>
          </Sec>

          {/* ================= 05 Loading ================= */}
          <Sec
            num="05"
            id="loading"
            title="Loading states"
            blurb="Pick an action and the row is replaced by a 356px pill that later morphs into the 520px answer panel. max-width and max-height are transitioned, not swapped, so the box grows into place."
          >
            <div className="dsx-stage">
              <div className="dsx-row" style={{ gap: 38 }}>
                <div>
                  <div className="dsx-label">is-loading: the pill</div>
                  <div className="amb is-loading">
                    <div className="popup-content loading">
                      <div className="jc-loading-mark">
                        <Orb state="working" size={64} aria-label="Preparing your context" />
                      </div>
                      <div className="jc-loading-copy">
                        <span className="jc-loading-kicker">JUSTCLARIFY / LIVE</span>
                        <p className="jc-passive-wait">Preparing your context</p>
                        <span className="jc-loading-detail">
                          The temporary chat stays visible and in your control.
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="dsx-cap dsx-cap-in">
                    356 × 150 max, 14px radius, and the one place the border goes to full{" "}
                    <code>#101010</code> ink. The mark column widened from 46px to 64px to take the orb
                    at its tuned size; 64 and 20 are separate designs, not a scale factor, so nothing
                    here is allowed to render at an in-between size.
                  </p>
                </div>

                <div>
                  <div className="dsx-label">What the pill used to hold</div>
                  <div style={{ transform: "scale(2)", transformOrigin: "top left", width: 90, height: 90 }}>
                    <div className="jc-loading-mark jc-loading-mark--legacy">
                      <i />
                      <b />
                      <i />
                    </div>
                  </div>
                  <p className="dsx-cap dsx-cap-in" style={{ marginTop: 4 }}>
                    Two concentric rings, outer ink and inner accent, with three 4–5px diamonds orbiting
                    at 1.1s. Shown at 2× and kept only for comparison; the orb replaces it.
                  </p>
                </div>
              </div>
            </div>

            <div className="dsx-stage" style={{ marginTop: 20 }}>
              <div className="dsx-label">The nine states, at both tuned sizes</div>
              <div className="dsx-orbs">
                {ORB_STATES.map(([st, what]) => (
                  <div className="dsx-orb" key={st}>
                    <div className="dsx-orb-pair">
                      <Orb state={st} size={64} />
                      <Orb state={st} size={20} />
                    </div>
                    <b>{st}</b>
                    <span>{what}</span>
                  </div>
                ))}
              </div>
              <p className="dsx-cap dsx-cap-in">
                Plain 2D canvas arcs, no WebGL and no filters, so the pixels are the same in every
                browser. Every instance shares one clock and pauses itself when scrolled offscreen or
                when the tab is hidden, which is what makes it safe to put one on every surface. Under{" "}
                <code>prefers-reduced-motion</code> each renders a single static frame instead.
              </p>
            </div>

            <div className="dsx-stage" style={{ marginTop: 20 }}>
              <div className="dsx-row" style={{ gap: 40, alignItems: "flex-start" }}>
                <div style={{ flex: "1 1 300px" }}>
                  <div className="dsx-label">Skeleton: a paragraph still being written</div>
                  <div className="amb is-loaded" style={{ width: 340 }}>
                    <div className="popup-content">
                      <div className="popup-header">
                        <h1 className="header-name">&ldquo;regulatory capture&rdquo;</h1>
                      </div>
                      <div className="popup-divider" />
                      <div className="jc-skel">
                        <span style={{ width: "100%" }} />
                        <span style={{ width: "92%" }} />
                        <span style={{ width: "68%" }} />
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="dsx-label">Inline wait</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, height: 40 }}>
                    <Orb state="breathing" size={20} />
                    <span style={{ color: "#6b645e", font: "500 12px/1 Inter" }}>
                      breathing, 20px, replaces the dot-breathe pulse
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Sec>

          {/* ================= 06 Answer panel ================= */}
          <Sec
            num="06"
            id="answer"
            title="Answer panel"
            blurb="The loaded state: 520px wide, capped at 800px tall, the selected text quoted as the title. The panel tag names which action produced what you are reading, so a follow-up restyle never leaves you guessing."
          >
            <div className="dsx-stage">
              <div className="amb is-loaded">
                <div className="popup-content">
                  <div className="popup-header">
                    <h1 className="header-name">&ldquo;regulatory capture&rdquo;</h1>
                  </div>
                  <div className="popup-divider" />

                  <details className="jc-thinking">
                    <summary>Thinking</summary>
                    <div className="jc-thinking-text">
                      The passage is about an agency and an industry it oversees. Keep it to the mechanism,
                      not the politics.
                    </div>
                  </details>

                  <div className="explanation-body">
                    <span className="jc-panel-tag">
                      <Ico name="explain" size={15} />
                      <span>Explanation</span>
                    </span>
                    <div className="expl-text">
                      Regulatory capture is what happens when the agency meant to police an industry starts
                      serving it instead. Not usually through bribery. Through proximity. The regulator
                      hires from the industry, relies on it for data, and over time adopts its sense of
                      what counts as reasonable.
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span className="source-tag">Early access</span>
                    <span className="footer-meta">2.1s · 148 tokens</span>
                  </div>
                </div>
              </div>

              <p className="dsx-cap dsx-cap-in">
                Title ink is deliberately <code>--text-primary</code>, not accent: a full-accent quote sitting
                over the divider read as a hyperlink, so the card&rsquo;s own title looked clickable. Accent
                stays on the tag and the takeaway rule, where it means something.
              </p>
            </div>

            <div className="dsx-stage" style={{ marginTop: 20 }}>
              <div className="dsx-label">Panel tags: one per action kind</div>
              <div className="dsx-row" style={{ gap: 22 }}>
                {[
                  ["explain", "Explanation"],
                  ["expand", "Expanded"],
                  ["define", "Definition"],
                  ["explain", "In simple terms"],
                  ["example", "Example"],
                  ["factcheck", "Fact-check"],
                  ["summarize", "Summary"],
                  ["translate", "Translation"],
                ].map(([ic, label]) => (
                  <span className="jc-panel-tag" key={label} style={{ marginBottom: 0 }}>
                    <Ico name={ic} size={15} />
                    <span>{label}</span>
                  </span>
                ))}
              </div>
            </div>
          </Sec>

          {/* ================= 07 Blocks ================= */}
          <Sec
            num="07"
            id="blocks"
            title="Answer blocks"
            blurb="Freeform model prose is parsed and reshaped into typed blocks: the model writes text, the panel decides what shape it is. These are all the shapes it can choose."
          >
            <div className="dsx-stage">
              <div className="amb is-loaded">
                <div className="popup-content">
                  <div className="jc-blocks">
                    <div className="dsx-label" style={{ marginBottom: 2 }}>
                      jc-key: pinned takeaway
                    </div>
                    <p className="jc-key" style={{ margin: 0 }}>
                      Capture is structural, not criminal. Nobody has to be bribed for it to happen.
                    </p>

                    <div className="dsx-label" style={{ margin: "14px 0 2px" }}>
                      jc-list-num
                    </div>
                    <ol className="jc-list jc-list-num" style={{ margin: 0 }}>
                      <li>The regulator depends on the industry for technical data.</li>
                      <li>Staff move between the two in both directions.</li>
                      <li>&ldquo;Reasonable&rdquo; drifts toward what the industry already does.</li>
                    </ol>

                    <div className="dsx-label" style={{ margin: "14px 0 2px" }}>
                      jc-steps
                    </div>
                    <ul className="jc-steps">
                      <li>
                        <span className="jc-step-dot">1</span>
                        <span>Read the rule the agency actually wrote.</span>
                      </li>
                      <li>
                        <span className="jc-step-dot">2</span>
                        <span>Check who supplied the evidence behind it.</span>
                      </li>
                    </ul>

                    <div className="dsx-label" style={{ margin: "14px 0 2px" }}>
                      jc-defs
                    </div>
                    <dl className="jc-defs">
                      <div className="jc-def">
                        <dt>Capture</dt>
                        <dd>the regulator serving the regulated.</dd>
                      </div>
                      <div className="jc-def">
                        <dt>Revolving door</dt>
                        <dd>staff moving between the two.</dd>
                      </div>
                    </dl>

                    <div className="dsx-label" style={{ margin: "14px 0 2px" }}>
                      jc-chips: numbers lifted out of the sentence
                    </div>
                    <div className="jc-chips">
                      <span className="jc-chip">62%</span>
                      <span className="jc-chip">1977</span>
                      <span className="jc-chip">$4.1bn</span>
                    </div>
                    <p className="jc-stats-text" style={{ margin: 0, font: "400 15px/1.5 Inter" }}>
                      Of the rules reviewed, 62% originated in industry submissions filed after 1977.
                    </p>

                    <div className="dsx-label" style={{ margin: "14px 0 2px" }}>
                      jc-collapse: [[MORE]] asides and auto-folded long prose
                    </div>
                    <details className="jc-collapse">
                      <summary>Where the term comes from</summary>
                      <div className="jc-collapse-body">
                        Coined by economists at Chicago in the 1970s, describing agencies whose rules
                        tracked the interests of the firms they oversaw.
                      </div>
                    </details>
                  </div>
                </div>
              </div>
              <p className="dsx-cap dsx-cap-in">
                The takeaway used to be a bare <code>border-left</code> on naked text, which read as a
                default markdown blockquote, the one treatment everyone has already seen. The 6% accent
                wash plus the asymmetric 4/10/10/4 radius makes it a deliberate object.
              </p>
            </div>
          </Sec>

          {/* ================= 08 Extras ================= */}
          <Sec
            num="08"
            id="extras"
            title="Panel extras"
            blurb="Everything that can appear inside or under the answer panel: the follow-up ask, the thread it becomes, the download bar, the error report link, and the soft email ask."
          >
            <div className="dsx-grid2">
              <div className="dsx-stage">
                <div className="dsx-label">Ask a follow-up</div>
                <form className="jc-ask-form" onSubmit={(e) => e.preventDefault()}>
                  <input className="jc-ask-input is-focus" placeholder="Ask about this…" />
                  <button className="jc-ask-submit" type="submit">
                    ↑
                  </button>
                </form>
                <p className="dsx-cap dsx-cap-in">
                  40px tall, 8px radius, focus ring is a 3px accent wash at 15%.
                </p>
              </div>

              <div className="dsx-stage">
                <div className="dsx-label">Setup bar: one-time model download</div>
                <div className="jc-setup">
                  <div className="jc-setup-row">
                    <span className="jc-setup-ico">
                      <Ico name="ondevice" size={16} />
                    </span>
                    <span className="jc-setup-label">Setting up on-device AI, one-time download</span>
                    <span className="jc-setup-pct">{pct}%</span>
                  </div>
                  <div className="jc-setup-bar">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>

              <div className="dsx-stage">
                <div className="dsx-label">Thread view: the panel docked bottom-right</div>
                <div className="jc-thread">
                  <div>
                    <span className="jc-tag" style={{ "--jc-tag-hue": 28 }}>
                      regulatory capture
                    </span>
                  </div>
                  <div className="jc-msg">
                    <span className="jc-msg-role">Clarify</span>
                    Capture is structural. The agency drifts toward the industry&rsquo;s sense of
                    reasonable.
                  </div>
                  <div className="jc-msg user">
                    <span className="jc-msg-role">You</span>
                    Is that the same as corruption?
                  </div>
                  <div className="jc-msg">
                    <span className="jc-msg-role">Clarify</span>
                    No. Corruption needs an intent that capture never requires.
                  </div>
                </div>
                <p className="dsx-cap dsx-cap-in">
                  Topic pills take a full OKLCH fill from the thread&rsquo;s own hue, so every chip stays
                  vivid and legible whichever hue came up.
                </p>
              </div>

              <div className="dsx-stage">
                <div className="dsx-label">Error + report</div>
                <div className="amb is-loaded" style={{ width: "100%" }}>
                  <div className="popup-content" style={{ padding: "14px 18px 16px" }}>
                    <div className="expl-text" style={{ fontSize: 14 }}>
                      That request didn&rsquo;t come back. The engine may be busy.
                    </div>
                    <span className="jc-tellme-link">
                      Tell us about this error
                      <span className="jc-tellme-note">opens a page, not your mail app</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="dsx-stage" style={{ marginTop: 20 }}>
              <div className="dsx-label">Soft email ask: slides in under the first answer</div>
              <div className="jc-email-card">
                <button className="jc-email-close" type="button" aria-label="Dismiss">
                  ✕
                </button>
                <div className="gate-domain">
                  <a href="#0" onClick={(e) => e.preventDefault()}>
                    <span className="gate-domain-red">justclarify</span>.xyz
                  </a>
                </div>
                <div className="email-gate">
                  <div className="gate-circle" aria-hidden="true">
                    <svg viewBox="0 0 145 145" fill="none">
                      <path
                        d="M98.965 26.5176C73.5984 11.8722 41.1623 20.5635 26.5169 45.9301C11.8715 71.2967 20.5627 103.733 45.9293 118.378C71.2959 133.024 103.732 124.332 118.377 98.9658"
                        stroke="black"
                      />
                      <path
                        d="M64.8906 59.3576C72.1205 55.1834 81.3654 57.6606 85.5396 64.8905C89.7138 72.1204 87.2366 81.3653 80.0067 85.5395C72.7768 89.7137 63.5319 87.2366 59.3577 80.0066"
                        stroke="black"
                      />
                      <path
                        d="M107.806 62.9789C113.038 82.5055 101.45 102.576 81.9234 107.809C62.3968 113.041 42.3259 101.453 37.0938 81.9262C31.8616 62.3996 43.4496 42.3287 62.9762 37.0965"
                        stroke="currentColor"
                        style={{ color: "var(--accent)" }}
                      />
                      <rect
                        x="72.7754"
                        y="68.9385"
                        width="4.75436"
                        height="4.75436"
                        transform="rotate(45 72.7754 68.9385)"
                        fill="currentColor"
                        style={{ color: "var(--accent)" }}
                      />
                    </svg>
                  </div>
                  <div className="gate-triangle" aria-hidden="true">
                    <svg viewBox="0 0 222 196" fill="none">
                      <path d="M0 0H222L111 196L0 0Z" fill="black" />
                    </svg>
                  </div>
                  <form className="email-form" onSubmit={(e) => e.preventDefault()}>
                    <input className="email-input" type="email" placeholder="mail@domain.com" />
                    <button type="submit" className="email-submit">
                      Unlock Early Access
                    </button>
                  </form>
                </div>
                <div className="gate-wave" aria-hidden="true">
                  <svg viewBox="0 0 624 204" fill="none">
                    <path
                      d="M374.5 100.502C369.5 71.1687 356.4 12.402 344 12.002C331.6 11.602 318.167 70.8353 313 100.502C307.667 131.168 293.8 192.5 281 192.5C268.2 192.5 254.333 131.168 249 100.502"
                      stroke="black"
                    />
                    <rect x="343.828" width="4.75" height="4.75" transform="rotate(45 343.828 0)" fill="currentColor" style={{ color: "var(--accent)" }} />
                    <rect x="281.121" y="197" width="4.75" height="4.75" transform="rotate(45 281.121 197)" fill="currentColor" style={{ color: "var(--accent)" }} />
                    <line y1="100.5" x2="624" y2="100.5" stroke="currentColor" style={{ color: "var(--accent)" }} />
                    <text x="30" y="118" fontSize="14" fill="#000">
                      <tspan style={{ fill: "var(--accent)" }}>understanding</tspan> what I am reading
                    </text>
                    <text x="594" y="94" textAnchor="end" fontSize="14" fill="#000">
                      without <tspan style={{ fill: "var(--accent)" }}>leaving the tab</tspan> I&rsquo;m in
                    </text>
                  </svg>
                </div>
                <div className="gate-footer">
                  <span className="footer-meta">© 2026 JustClarify</span>
                  <span className="gate-footer-sep">|</span>
                  <a className="gate-footer-mail" href="#0" onClick={(e) => e.preventDefault()}>
                    hello@ayotomcs.me
                  </a>
                </div>
              </div>
              <p className="dsx-cap dsx-cap-in">
                Demoted from a wall to a card: the first answer always renders, then this invites an email rather than requiring one. Submitting or dismissing retires it permanently; ignoring it retires
                it until the next page load.
              </p>
            </div>
          </Sec>

          {/* ================= 09 Fact-check ================= */}
          <Sec
            num="09"
            id="factcheck"
            title="Fact-check overlay"
            blurb="A 348px panel docked 18px from the top-right, running for as long as the reader wants, in page mode, video mode, or live mode listening to whatever is being said. Vertical rhythm is deliberately uneven so grouping reads without boxes: 9px inside a thought, 16px between thoughts, 26px between entries."
          >
            <div className="dsx-row" style={{ gap: 20 }}>
              <div className="dsx-stage" style={{ flex: "0 0 auto" }}>
                <div className="dsx-label">Results: all four verdict tones</div>
                <div className="jc-fc-overlay">
                  <div className="jc-fc-head">
                    <div className="jc-fc-titles">
                      <span className="jc-fc-kicker">Fact-check</span>
                      <span className="jc-fc-src">reuters.com / Agency review, page 3</span>
                    </div>
                    <button className="jc-fc-close" type="button" aria-label="Close">
                      <Ico name="close" size={14} />
                    </button>
                  </div>
                  <div className="jc-fc-scroll">
                    <VerdictRow
                      tone="true"
                      word="Mostly true"
                      meta="Reuters · 12 Mar"
                      quote="&ldquo;The agency has not opened a formal inquiry since 2019.&rdquo;"
                      body="Correct for formal inquiries. Three informal reviews were opened in that window, which the filing does not count."
                      refs={[
                        ["reuters.com", "Agency records show no formal inquiry since 2019"],
                        ["gao.gov", "Oversight report, Q2"],
                      ]}
                    />
                    <VerdictRow
                      tone="mixed"
                      word="Mixed"
                      meta="AP · 4 Apr"
                      quote="&ldquo;Staff turnover into the industry has doubled.&rdquo;"
                      body="Doubled from a small base, 6 departures to 12, which the phrasing overstates."
                    />
                    <VerdictRow
                      tone="false"
                      word="False"
                      meta="Full Fact · 22 Feb"
                      quote="&ldquo;The rule was written entirely by lobbyists.&rdquo;"
                      body="The published drafting record lists four agency authors. Industry submissions informed two clauses."
                    />
                    <VerdictRow
                      tone="unknown"
                      word="Unverified"
                      meta="No published check"
                      quote="&ldquo;Internal memos warned about this in 2016.&rdquo;"
                      body="No memo of that description is in the public record; nothing found either way."
                    />
                  </div>
                </div>
              </div>

              <div className="dsx-col" style={{ flex: "1 1 300px", gap: 20 }}>
                <div className="dsx-stage">
                  <div className="dsx-label">Live mode: listening</div>
                  <div className="jc-fc-overlay is-listening" style={{ maxHeight: 210 }}>
                    <div className="jc-fc-head">
                      <div className="jc-fc-titles">
                        <span className="jc-fc-kicker">Live</span>
                        <span className="jc-fc-src">Tab audio / Senate hearing</span>
                      </div>
                      <button className="jc-fc-close" type="button" aria-label="Close">
                        <Ico name="close" size={14} />
                      </button>
                    </div>
                    <div className="jc-fc-scroll">
                      <p className="jc-fc-heard">
                        …and I would remind the committee that the agency has not opened a formal
                      </p>
                      <div className="jc-fc jc-fc-row is-pending" style={{ marginTop: 18 }}>
                        <p className="jc-fc-quote">
                          &ldquo;The agency has not opened a formal inquiry since 2019.&rdquo;
                        </p>
                        <p className="jc-fc-pending">
                          <Orb state="searching" size={20} />
                          <span>Checking…</span>
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className="dsx-cap dsx-cap-in">
                    The kicker grows a pulsing accent dot while the mic is open. Interim transcript is
                    grey; it settles to the same grey on finalisation, then a claim card is minted from it.
                  </p>
                </div>

                <div className="dsx-stage">
                  <div className="dsx-label">Empty / status</div>
                  <div className="jc-fc-overlay" style={{ maxHeight: 150 }}>
                    <div className="jc-fc-head">
                      <div className="jc-fc-titles">
                        <span className="jc-fc-kicker">Fact-check</span>
                        <span className="jc-fc-src">youtube.com / captions</span>
                      </div>
                      <button className="jc-fc-close" type="button" aria-label="Close">
                        <Ico name="close" size={14} />
                      </button>
                    </div>
                    <div className="jc-fc-scroll">
                      <p className="jc-fc-status">Reading captions. No checkable claims yet.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="dsx-note">
              <b>Why the quote rule is neutral.</b> A verdict-coloured rule on the claim would give the
              ruling away above the line that states it. The diamond and the word carry the colour; the
              quote stays reported speech.
            </div>
          </Sec>

          {/* ================= 10 Text area ================= */}
          <Sec
            num="10"
            id="textarea"
            title="Text area"
            blurb="A scratch editor that opens over the page: paste anything, run a rewrite mode on it, copy or download the result. 16:9 by default, resizable from the corner, with an expanded mode over a spotlight and a minimized bubble."
          >
            <div className="dsx-stage">
              <div className="dsx-label">Default card: 720 × 405, top-centred</div>
              <div style={{ position: "relative", paddingTop: 14, paddingRight: 14 }}>
                <div className="jc-ta-card">
                  <div className="jc-ta-actions">
                    {["Humanize", "Paraphrase", "Formal", "Casual", "Simplify", "Shorten", "Expand", "Fix grammar"].map(
                      (m, i) => (
                        <button key={m} className={`jc-ta-action${i === 0 ? " is-busy" : ""}`} type="button">
                          {m}
                        </button>
                      ),
                    )}
                  </div>
                  <div className="jc-ta-tools">
                    <button className="jc-ta-tool is-ok" type="button" title="Copy">
                      <Ico name="copy" size={19} />
                    </button>
                    <button className="jc-ta-tool" type="button" title="Download">
                      <Ico name="download" size={19} />
                    </button>
                    <button className="jc-ta-tool" type="button" title="Align">
                      <Ico name="alignJustify" size={19} />
                    </button>
                    <button className="jc-ta-tool" type="button" title="Expand">
                      <Ico name="expandFull" size={19} />
                    </button>
                    <button className="jc-ta-tool" type="button" title="Minimize">
                      <Ico name="minimize" size={19} />
                    </button>
                  </div>
                  <div className="jc-ta-editor">
                    <p>
                      The agency&rsquo;s dependence on industry data is not a scandal in itself. It becomes
                      one at the point where no independent source is consulted at all.
                    </p>
                    <p>Humanizing…</p>
                  </div>
                  <div className="jc-ta-status">
                    <Orb state="composing" size={20} />
                    <span>Working, 1 of 2 paragraphs</span>
                  </div>
                  <button className="jc-ta-cancel" type="button" aria-label="Close">
                    <Ico name="close" size={16} />
                  </button>
                </div>
              </div>
              <p className="dsx-cap dsx-cap-in">
                Cancel is pinned to the corner from outside the card, deliberately, because inside it would be
                clipped by the card&rsquo;s own <code>overflow: hidden</code>. Running mode chips go solid
                accent; the copy tool turns accent on success.
              </p>
            </div>

            <div className="dsx-grid2" style={{ marginTop: 20 }}>
              <div className="dsx-stage dsx-stage--dark">
                <div className="dsx-label">Expanded: 1040 × 640 over a 55% spotlight</div>
                <div
                  style={{
                    background: "#fff",
                    borderRadius: 14,
                    height: 168,
                    boxShadow: "0 24px 70px rgba(0,0,0,.5)",
                    border: "1px solid rgba(17,17,17,.13)",
                    display: "grid",
                    placeItems: "center",
                    color: "#a49d97",
                    font: "500 12px/1 Inter",
                  }}
                >
                  editor, dead-centred
                </div>
              </div>

              <div className="dsx-stage">
                <div className="dsx-label">Minimized: the bubble</div>
                <div className="jc-ta-bubble">
                  <button className="jc-ta-bubble-open" type="button">
                    <Ico name="textarea" size={26} />
                  </button>
                  <span className="jc-ta-bubble-actions">
                    <button type="button">Copy</button>
                    <button type="button">Close</button>
                  </span>
                </div>
                <div style={{ height: 18 }} />
                <div className="dsx-label">Download menu</div>
                <div className="jc-ta-dl-menu">
                  <button type="button">.txt</button>
                  <button type="button">.md</button>
                  <button type="button">.docx</button>
                </div>
              </div>
            </div>
          </Sec>

          {/* ================= 11 Text tools ================= */}
          <Sec
            num="11"
            id="texttools"
            title="Text tools"
            blurb="The lighter cousin of the text area, launched from the toolbar popup: one input, a strip of modes, one result you can copy or push back into the input."
          >
            <div className="dsx-stage dsx-stage--dark">
              <div className="jc-rw-panel">
                <div className="jc-rw-head">
                  <span className="jc-rw-title">Text tools</span>
                  <button className="jc-rw-close" type="button" aria-label="Close">
                    <Ico name="close" size={14} />
                  </button>
                </div>
                <textarea
                  className="jc-rw-input"
                  defaultValue="The agency has, over an extended period, exhibited a pattern of deference with respect to the entities subject to its supervisory remit."
                />
                <div className="jc-rw-actions">
                  {["Humanize", "Shorten", "Expand", "Summarize", "Paraphrase", "Fix grammar"].map((m, i) => (
                    <button key={m} className={`jc-rw-action${i === 1 ? " is-busy" : ""}`} type="button">
                      {m}
                    </button>
                  ))}
                </div>
                <div className="jc-rw-status">
                  <Orb state="composing" size={20} />
                  <span>Shortening…</span>
                </div>
                <div className="jc-rw-result">
                  <span className="jc-rw-result-label">Result</span>
                  <div className="jc-rw-result-text">
                    The agency has long deferred to the firms it supervises.
                  </div>
                  <div className="jc-rw-result-bar">
                    <button className="jc-rw-copy" type="button">
                      Copy
                    </button>
                    <button className="jc-rw-useinput" type="button">
                      Use as input
                    </button>
                  </div>
                </div>
              </div>
              <p className="dsx-cap dsx-cap-in" style={{ color: "#8b837d" }}>
                Sits on a 45% ink scrim, centred. The title mark is the same rotated square as everywhere
                else, 9px.
              </p>
            </div>
          </Sec>

          {/* ================= 12 Voice ================= */}
          <Sec
            num="12"
            id="voice"
            title="Voice chip"
            blurb="Hold Shift, speak, let go. The chip is the only feedback a spoken command gets before it acts, so it lives in a shadow root where no page CSS can reach it, tracks the cursor rather than sitting in a fixed bar, and never waits on an animation to become readable."
          >
            <div className="dsx-stage">
              <div className="dsx-col" style={{ gap: 20 }}>
                <div>
                  <div className="dsx-label">listening: mic open, no words yet</div>
                  <Chip state="listening" live text="Listening…" />
                  <p className="dsx-cap dsx-cap-in">
                    The orb&rsquo;s own <code>listening</code> state is a waveform rolling through the
                    latitude rings, which says heard-and-still-hearing far better than a dot could. What
                    it gives up is the live mic level: the old dot scaled with{" "}
                    <code>--jc-level</code>, so the reader saw their own volume. The orb takes a{" "}
                    <code>speed</code> multiplier, so that signal can be re-fed there instead.
                  </p>
                </div>

                <div>
                  <div className="dsx-label">hearing: live transcript, full ink</div>
                  <Chip state="hearing" text="scroll to where they talk about the revolving door" />
                </div>

                <div>
                  <div className="dsx-label">is-multi: two or more lines square the corners off</div>
                  <Chip
                    state="hearing"
                    cls="is-multi"
                    text="find the paragraph about staff moving between the agency and the firms it regulates and read it out"
                  />
                  <p className="dsx-cap dsx-cap-in">
                    A stadium shape around a paragraph reads as a mistake. showChip measures the line boxes
                    and flips the class: 16px radius, dot top-aligned to the first line.
                  </p>
                </div>

                <div>
                  <div className="dsx-label">thinking</div>
                  <Chip state="thinking" text="One second…" />
                </div>

                <div>
                  <div className="dsx-label">confirm: a question, the only clickable state</div>
                  <Chip state="confirm" text="Open this in a new tab?" actions={["Yes", "No"]} />
                </div>

                <div>
                  <div className="dsx-label">has-many: past two choices it becomes a card</div>
                  <Chip
                    state="confirm"
                    cls="has-many"
                    text="Where do you want the summary?"
                    actions={["This tab", "New tab", "Text area", "Just read it"]}
                  />
                  <p className="dsx-cap dsx-cap-in">
                    Crammed onto one line the question ellipsised and the last button wrapped its own
                    label, leaving buttons of different heights in a pill that was no longer pill-shaped.
                  </p>
                </div>

                <div>
                  <div className="dsx-label">done: green dot</div>
                  <Chip state="done" text="Scrolled to &ldquo;revolving door&rdquo;" />
                </div>

                <div>
                  <div className="dsx-label">unknown: heard it, no match. Grey text, red dot</div>
                  <Chip state="unknown" text="I didn&rsquo;t catch a command in that." />
                </div>

                <div>
                  <div className="dsx-label">error: with recovery actions</div>
                  <Chip
                    state="error"
                    cls="has-many"
                    text="The microphone is blocked on this site."
                    actions={["Set it up", "Not now"]}
                  />
                </div>
              </div>
            </div>

            <table className="dsx-spec">
              <thead>
                <tr>
                  <th>Detail</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>padding 9px 15px 9px 17px</td>
                  <td>asymmetric: at radius 999px a round dot padded evenly sits inside the arc and reads crowded</td>
                </tr>
                <tr>
                  <td>dot margin-top -1px</td>
                  <td>optical, not geometric: the line box centre sits below the visible letter centre</td>
                </tr>
                <tr>
                  <td>rgba(255,255,255,.92) + blur(16px) saturate(1.35)</td>
                  <td>letting the page through is what makes it read as an overlay, not a sticker</td>
                </tr>
                <tr>
                  <td>pointer-events: none except .has-actions</td>
                  <td>a non-question chip can never swallow a click meant for the page</td>
                </tr>
                <tr>
                  <td>text wraps, never ellipsises</td>
                  <td>the transcript is the product; nowrap made a spoken sentence legible for four words</td>
                </tr>
                <tr>
                  <td>only live states pulse</td>
                  <td>a finished command that kept breathing would read as &ldquo;still listening&rdquo;</td>
                </tr>
              </tbody>
            </table>
          </Sec>

          {/* ================= 13 Page feedback ================= */}
          <Sec
            num="13"
            id="pagefeedback"
            title="Page feedback"
            blurb="When a voice command lands somewhere, the page itself confirms it. This is the only time the extension draws on the host page's own elements rather than over them."
          >
            <div className="dsx-stage dsx-stage--article">
              <div className="dsx-article">
                <div className="dsx-label">jc-voice-flash: the block that was jumped to</div>
                <p className="flashdemo" style={{ marginBottom: 26 }}>
                  Staff move between the agency and the firms it supervises in both directions, and the
                  traffic has thickened every year since the rule was written.
                </p>

                <div className="dsx-label">jc-voice-trace: the exact words that were heard</div>
                <p>
                  Staff move between the agency and{" "}
                  <span className="tracedemo">the firms it supervises</span> in both directions.
                </p>
              </div>
              <p className="dsx-cap dsx-cap-in">
                Both are rings, not fills: 3px for the block, 2px per line box for the phrase, fading to
                transparent over 1.4s. The native selection already fills the phrase, and two highlights on
                the same text read as two different answers. Under reduced-motion both become a static
                outline.
              </p>
            </div>
          </Sec>

          {/* ================= 14 Toolbar popup ================= */}
          <Sec
            num="14"
            id="toolbar"
            title="Toolbar popup"
            blurb="336px, pinned inline in the document head before any stylesheet loads so Chrome can never measure the panel at another width. Opened many times a day, so it has no entrance animation at all. Settings-style grouped cards, rows divided by inset hairlines, and the accent spent only on state."
          >
            <div className="dsx-stage">
              <div className="dsx-label">Default state, straight from popup.html</div>
              <div className="pop">
                <header className="jc-head">
                  <span className="jc-mark" aria-hidden="true">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                      <rect x="4" y="4" width="16" height="16" rx="3.6" transform="rotate(45 12 12)" fill="currentColor" />
                      <rect x="8.6" y="8.6" width="6.8" height="6.8" rx="1.8" transform="rotate(45 12 12)" fill="#fbf9f7" />
                    </svg>
                  </span>
                  <span className="jc-wordmark">JustClarify</span>
                  <span className="jc-head-engine">
                    <span className="jc-dot is-ok" />
                    <span>JustClarify</span>
                  </span>
                </header>

                <main className="jc-body">
                  <h2 className="jc-sec">Engine</h2>
                  <div className="jc-card">
                    <div className="jc-card-pad">
                      <div className="jc-seg jc-seg-3" role="radiogroup" aria-label="Engine">
                        {SEG_ENGINES.map(([label, mark], i) => (
                          <button
                            key={label}
                            className={`jc-seg-btn${i === 2 ? " is-on" : ""}`}
                            type="button"
                            role="radio"
                            aria-checked={i === 2}
                          >
                            <SegIco mark={mark} />
                            <span className="jc-seg-label">{label}</span>
                          </button>
                        ))}
                      </div>
                      <p className="jc-note">
                        JustClarify&rsquo;s model, free until August 28. Add your own key below any time.
                      </p>
                    </div>

                    <div className="jc-row jc-rule jc-row-byok">
                      <div className="jc-row-text">
                        <span className="jc-row-label">Use your own AI key</span>
                        <span className="jc-row-hint">
                          Anthropic, OpenAI, Gemini, Hugging Face, or an AI Gateway key.
                        </span>
                      </div>
                      <button className="jc-switch" type="button" role="switch" aria-checked="false" aria-label="Use your own AI key">
                        <span className="jc-switch-knob" />
                      </button>
                    </div>

                    <p className="jc-note jc-note-trial">Early access is on a free API key until August 28.</p>
                  </div>

                  <h2 className="jc-sec">Voice</h2>
                  <div className="jc-card">
                    <p className="jc-note jc-card-pad">
                      Hold <b>Shift</b>, speak, let go. Commands run on this device; anything else asks the
                      AI on whichever engine is picked.
                    </p>
                  </div>

                  <h2 className="jc-sec">This page</h2>
                  <div className="jc-card">
                    <button className="jc-btn" type="button">
                      <span className="jc-chip jc-chip-accent" aria-hidden="true">
                        <svg viewBox="0 0 24 24" className="jc-ico">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </span>
                      <span className="jc-btn-text">
                        <span className="jc-btn-label">Text tools</span>
                        <span className="jc-btn-hint">Humanize, shorten, expand, summarize, fix grammar.</span>
                      </span>
                    </button>

                    <button className="jc-btn" type="button">
                      <span className="jc-chip" aria-hidden="true">
                        <svg viewBox="0 0 24 24" className="jc-ico">
                          <rect x="3" y="6" width="11" height="14" rx="2.5" />
                          <path d="M7.5 3.5h11a2 2 0 0 1 2 2v11" />
                          <path d="M6.5 11h5M6.5 15h3" />
                        </svg>
                      </span>
                      <span className="jc-btn-text">
                        <span className="jc-btn-label">Join related tabs</span>
                        <span className="jc-btn-hint">
                          One briefing from the tabs you already have open, with sources.
                        </span>
                      </span>
                    </button>

                    <div className="jc-fc-group jc-rule">
                      <button className="jc-btn jc-fc-head" type="button" aria-expanded="false">
                        <span className="jc-chip jc-chip-accent" aria-hidden="true">
                          <svg viewBox="0 0 24 24" className="jc-ico">
                            <circle cx="12" cy="12" r="9" />
                            <path d="m8.4 12.2 2.4 2.4 4.8-5.2" />
                          </svg>
                        </span>
                        <span className="jc-btn-text">
                          <span className="jc-btn-label">Fact-check</span>
                          <span className="jc-btn-hint">
                            Checks the claims in what you&rsquo;re reading or watching.
                          </span>
                        </span>
                        <svg viewBox="0 0 24 24" className="jc-ico jc-fc-caret" aria-hidden="true">
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </button>
                    </div>

                    <div className="jc-field jc-card-pad jc-rule">
                      <input className="jc-input" type="password" placeholder="Google Fact Check key (optional, free)" />
                      <p className="jc-note">
                        Your own quota for published rulings. Blank uses the shared lookup.
                      </p>
                    </div>
                  </div>

                  <h2 className="jc-sec">Data</h2>
                  <div className="jc-card">
                    <button className="jc-btn" type="button">
                      <span className="jc-chip" aria-hidden="true">
                        <svg viewBox="0 0 24 24" className="jc-ico">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 7v5l3 2" />
                        </svg>
                      </span>
                      <span className="jc-btn-text">
                        <span className="jc-btn-label">Open history</span>
                        <span className="jc-btn-hint">Past questions and answers, in a full tab.</span>
                      </span>
                      <svg viewBox="0 0 24 24" className="jc-ico jc-caret" aria-hidden="true">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </button>
                  </div>

                  <p className="jc-note jc-note-foot">
                    Highlights, answers and history stay in this browser&rsquo;s local storage.
                  </p>
                </main>
              </div>

              <p className="dsx-cap dsx-cap-in">
                All three engines are live radios. The mic button under Voice is hidden until the
                extension has no microphone of its own, which is why Voice looks like a bare note here.
              </p>
            </div>

            <div className="dsx-grid2" style={{ marginTop: 20 }}>
              <div className="dsx-stage">
                <div className="dsx-label">Engine, all three selections</div>
                <div className="pop" style={{ boxShadow: "none" }}>
                  <div className="jc-body" style={{ paddingBottom: 4 }}>
                    {[
                      [0, "Early access", "JustClarify's API, free until August 28. Nothing to set up, voice included."],
                      [1, "Your LLM", "ChatGPT answers in a quiet tab on your own account, free. Slower streaming; no voice control."],
                      [2, "API", "JustClarify's model, free until August 28. Add your own key below any time."],
                    ].map(([on, , note]) => (
                      <div className="jc-card" key={on} style={{ marginBottom: 8 }}>
                        <div className="jc-card-pad">
                          <div className="jc-seg jc-seg-3" role="radiogroup" aria-label="Engine">
                            {SEG_ENGINES.map(([label, mark], i) => (
                              <button
                                key={label}
                                className={`jc-seg-btn${i === on ? " is-on" : ""}`}
                                type="button"
                                role="radio"
                                aria-checked={i === on}
                              >
                                <SegIco mark={mark} />
                                <span className="jc-seg-label">{label}</span>
                              </button>
                            ))}
                          </div>
                          <p className="jc-note">{note}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="dsx-cap dsx-cap-in">
                  The note under the control is rewritten live by <code>renderEngine()</code>, and it is
                  the only place the popup explains what the chosen engine costs or cannot do. Picking
                  Your LLM also reveals a provider select beneath the card.
                </p>
              </div>

              <div className="dsx-col">
                <div className="dsx-stage">
                  <div className="dsx-label">Fact-check, disclosure open</div>
                  <div className="pop" style={{ boxShadow: "none" }}>
                    <div className="jc-body" style={{ paddingBottom: 4 }}>
                      <div className="jc-card">
                        <div className="jc-fc-group is-open">
                          <button className="jc-btn jc-fc-head" type="button" aria-expanded="true">
                            <span className="jc-chip jc-chip-accent" aria-hidden="true">
                              <svg viewBox="0 0 24 24" className="jc-ico">
                                <circle cx="12" cy="12" r="9" />
                                <path d="m8.4 12.2 2.4 2.4 4.8-5.2" />
                              </svg>
                            </span>
                            <span className="jc-btn-text">
                              <span className="jc-btn-label">Fact-check</span>
                              <span className="jc-btn-hint">
                                Checks the claims in what you&rsquo;re reading or watching.
                              </span>
                            </span>
                            <svg viewBox="0 0 24 24" className="jc-ico jc-fc-caret" aria-hidden="true">
                              <path d="m9 18 6-6-6-6" />
                            </svg>
                          </button>
                          <div className="jc-fc-options">
                            <div className="jc-fc-inner">
                              {[
                                ["This page", "The article you're reading."],
                                ["This video's transcript", "A YouTube transcript, with timestamps."],
                                ["Listen & fact-check live", "Live tab audio. Needs a Deepgram key."],
                              ].map(([label, hint]) => (
                                <button className="jc-btn jc-fc-opt" type="button" key={label}>
                                  <span className="jc-chip" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" className="jc-ico">
                                      <rect x="5" y="3" width="14" height="18" rx="2.5" />
                                      <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
                                    </svg>
                                  </span>
                                  <span className="jc-btn-text">
                                    <span className="jc-btn-label">{label}</span>
                                    <span className="jc-btn-hint">{hint}</span>
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="dsx-cap dsx-cap-in">
                    A <code>grid-template-rows: 0fr &rarr; 1fr</code> reveal over 220ms, so it animates to
                    its real height without anyone measuring anything. The caret rotates 90°.
                  </p>
                </div>

                <div className="dsx-stage">
                  <div className="dsx-label">Own key, switch on</div>
                  <div className="pop" style={{ boxShadow: "none" }}>
                    <div className="jc-body" style={{ paddingBottom: 4 }}>
                      <div className="jc-card">
                        <div className="jc-row jc-row-byok is-on">
                          <div className="jc-row-text">
                            <span className="jc-row-label">Use your own AI key</span>
                            <span className="jc-row-hint">
                              Anthropic, OpenAI, Gemini, Hugging Face, or an AI Gateway key.
                            </span>
                          </div>
                          <button className="jc-switch is-on" type="button" role="switch" aria-checked="true" aria-label="Use your own AI key">
                            <span className="jc-switch-knob" />
                          </button>
                        </div>
                        <div className="jc-reveal" data-open="true">
                          <div className="jc-reveal-inner jc-card-pad">
                            <div className="jc-field">
                              <input className="jc-input" type="password" placeholder="API key: sk-ant-…, sk-…, AIza…, hf_…, or vck_…" />
                              <p className="jc-note">
                                The prefix says whose key it is. Paste it and JustClarify routes it to the
                                right company.
                              </p>
                            </div>
                            <div className="jc-field">
                              <button className="jc-btn-dark" type="button">
                                Save &amp; test key
                              </button>
                            </div>
                            <p className="jc-note">
                              Stored on this device only, and sent only to the company the key belongs to,
                              never to a JustClarify server.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="dsx-cap dsx-cap-in">
                    The row sits at 55% opacity until the switch is on, so the card reads as one live
                    control rather than two competing ones. A saved key is never shown as an editable
                    field: it is provider, masked tail, Delete, because an edited key is a broken key.
                  </p>
                </div>
              </div>
            </div>

            <div className="dsx-note">
              <b>The engine pill only has two states, not four.</b> <code>renderEngine()</code> adds{" "}
              <code>is-ok</code> on every successful path and nothing at all when the worker cannot be
              reached, where the label reads &ldquo;Unknown&rdquo;. <code>is-warn</code>,{" "}
              <code>is-off</code> and <code>is-busy</code> are all still defined in{" "}
              <code>popup.css</code>, including the only looping animation in the panel, and nothing
              sets them. Either the states are real and should be wired up, or the CSS should go.
            </div>

            <div className="dsx-note">
              <b>The label is not always the engine.</b> The pill shows the provider once one is
              resolved: &ldquo;Early access&rdquo; on the free tier, the chat site&rsquo;s own name on Your
              LLM, and the key&rsquo;s provider name once a personal key is saved. A saved key outranks
              Early access entirely, so the pill can read Anthropic while the segmented control still
              shows Early access selected.
            </div>
          </Sec>

          {/* ================= 15 Skins ================= */}
          <Sec
            num="15"
            id="skins"
            title="Skin archive"
            blurb="Five action-surface studies that shipped behind a switcher before the compact row replaced them. Kept here because the CSS is still in styles.css and because they are the clearest record of what has already been tried."
          >
            <div className="dsx-stage">
              <div className="dsx-row" style={{ gap: 30 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skin key={i} i={i} />
                ))}
              </div>
            </div>

            <div className="dsx-stage" style={{ marginTop: 20 }}>
              <div className="dsx-label">Matching answer surfaces</div>
              <div className="dsx-row" style={{ gap: 24 }}>
                {[
                  [0, "Harness: rounded, soft-shadowed, no hard border"],
                  [1, "Margin: 4px accent spine"],
                  [2, "Index: 2px ink, 6px hard offset"],
                  [3, "Marker: asymmetric 16/4 radius"],
                  [4, "Lens: 18px radius, wide soft cast"],
                ].map(([i, note]) => (
                  <div key={i}>
                    <div className={`surf surf--${i}`}>
                      <h4>&ldquo;regulatory capture&rdquo;</h4>
                      <p>The agency meant to police an industry starts serving it instead.</p>
                    </div>
                    <p className="dsx-cap">{note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="dsx-note">
              <b>Why they were retired.</b> The switcher put a design control on screen at the exact moment
              the reader wanted an answer, and five compositions meant five sets of hover, press and
              loading states to keep honest. The compact row is one surface with one set of states, but
              it also gave up the labelled, scannable grid these had.
            </div>
          </Sec>
        </main>
      </div>
    </div>
    </OpenCtx.Provider>
  );
}
