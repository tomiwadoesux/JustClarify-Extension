"use client";

// JustClarify extension test bench.
//
// A real http page, so the extension runs here through exactly the same path it
// runs on any article — real content script, real tab id, real chrome.tabs
// messaging. Nothing here is mocked; if it works on this page it works in the
// wild.
//
// The STORE build is excluded from this URL (scripts/package-extension.sh adds
// exclude_matches at package time), so only the unpacked dev build injects here
// and you never get two copies of the UI fighting over the same selection.

import { useEffect, useRef, useState } from "react";

// Each pill is one surface of the extension's UI, with the gesture that opens it.
const SURFACES = [
  { id: "blob", label: "Selection blob", how: "Highlight any text" },
  { id: "explain", label: "Explain", how: "Highlight → click the blob → Explain" },
  { id: "define", label: "Define", how: "Highlight one word → Define" },
  { id: "factcheck", label: "Fact-check one", how: "Highlight a claim → Fact-check" },
  { id: "page", label: "Fact-check page", how: "Popup → check this page" },
  { id: "translate", label: "Translate", how: "Highlight → More → Translate" },
  { id: "reword", label: "Reword in place", how: "Highlight a sentence → Reword" },
  { id: "askbox", label: "Ask box", how: "Double-tap Shift" },
  { id: "texttools", label: "Text tools", how: "Popup → open text tools" },
  { id: "focus", label: "Focus mode", how: "Highlight → More → Focus" },
  { id: "threads", label: "Threads panel", how: "Ask something, then reopen it" },
  { id: "engine", label: "Engine + download", how: "First ask on a cold profile" },
];

// Claims with settled, checkable answers — a spread of true, false and
// "true but misleading" so a verdict of Mixed has something to land on. The
// false ones are famous misconceptions precisely because they're easy to verify.
const CLAIMS = [
  { text: "The Great Wall of China is visible from space with the naked eye.", expect: "False" },
  { text: "Humans use only 10 percent of their brains.", expect: "False" },
  { text: "The Amazon rainforest produces 20 percent of the world's oxygen.", expect: "Misleading" },
  { text: "Napoleon Bonaparte was unusually short for his era.", expect: "False" },
  { text: "Goldfish have a memory span of about three seconds.", expect: "False" },
  { text: "The Eiffel Tower is approximately 330 metres tall.", expect: "True" },
  { text: "Measured from base to summit, Mauna Kea is taller than Mount Everest.", expect: "True" },
  { text: "Lightning never strikes the same place twice.", expect: "False" },
];

// Terms where a dictionary lookup and a model explanation should visibly differ
// — the point of the Define/Explain split.
const JARGON = [
  { term: "liquidated damages", field: "Legal" },
  { term: "force majeure", field: "Legal" },
  { term: "indemnify", field: "Legal" },
  { term: "idiopathic", field: "Medical" },
  { term: "myocardial infarction", field: "Medical" },
  { term: "quantitative easing", field: "Finance" },
  { term: "collateralised debt obligation", field: "Finance" },
  { term: "usufruct", field: "Legal" },
];

export default function DevPage() {
  const [active, setActive] = useState("blob");
  const [detected, setDetected] = useState(null);
  const [downloads, setDownloads] = useState(0);
  const [events, setEvents] = useState([]);
  const seenDownload = useRef(false);

  // Extension detection + the re-download counter.
  //
  // The counter is the point of this panel: the "Setting up on-device AI
  // (one-time download)…" line is supposed to appear ONCE, ever. If this number
  // climbs each time you highlight something, the model is being re-fetched (or
  // at least re-reported) per ask, which is the bug this bench exists to catch.
  useEffect(() => {
    const log = (msg) =>
      setEvents((prev) => [
        { t: new Date().toLocaleTimeString(), msg },
        ...prev.slice(0, 24),
      ]);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          const cls = String(node.className || "");
          if (!cls.includes("jc-") && !node.querySelector?.("[class*='jc-']")) continue;

          if (detected !== true) setDetected(true);

          const text = node.textContent || "";
          if (/one-time download/i.test(text)) {
            if (!seenDownload.current) {
              seenDownload.current = true;
              log("Model download started (expected: once per profile)");
            }
            setDownloads((n) => n + 1);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // No JustClarify node within 2s of load usually means the content script
    // isn't injecting — most often the dev build isn't loaded unpacked.
    const timer = setTimeout(() => setDetected((d) => (d === null ? false : d)), 2000);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [detected]);

  const jump = (id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div style={S.page}>
      <header style={S.head}>
        <div style={S.headTop}>
          <span style={S.mark} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="4" width="16" height="16" rx="3.6" transform="rotate(45 12 12)" fill="#727cb0" />
              <rect x="8.6" y="8.6" width="6.8" height="6.8" rx="1.8" transform="rotate(45 12 12)" fill="#fff" />
            </svg>
          </span>
          <h1 style={S.h1}>Extension test bench</h1>
          <span style={{ ...S.badge, ...(detected ? S.badgeOk : detected === false ? S.badgeBad : S.badgeWait) }}>
            {detected === null ? "detecting…" : detected ? "extension detected" : "no extension"}
          </span>
        </div>

        <nav style={S.pills}>
          {SURFACES.map((s) => (
            <button
              key={s.id}
              onClick={() => jump(s.id)}
              style={{ ...S.pill, ...(active === s.id ? S.pillOn : null) }}
              title={s.how}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      <main style={S.main}>
        <Diagnostics downloads={downloads} events={events} detected={detected} />

        <Section id="blob" title="Selection blob" how="Highlight any text below.">
          <p style={S.body}>
            The blob is the entry point for every other surface — if it doesn&rsquo;t appear,
            nothing else on this page will work either. It should fade in near the end of
            your selection, follow the cursor, and dismiss when you click away.
          </p>
          <p style={S.body}>
            Select part of this sentence, then select a whole paragraph, then select a
            single word. The blob should behave identically at all three lengths, and the
            action list it opens should change with the selection size.
          </p>
        </Section>

        <Section id="explain" title="Explain" how="Highlight → click the blob → Explain.">
          <p style={S.body}>
            The court found that the defendant&rsquo;s failure to deliver constituted a
            repudiatory breach, entitling the claimant to terminate and to recover damages
            for loss of bargain, subject to the usual duty to mitigate and to any liquidated
            damages clause the parties had agreed in advance.
          </p>
          <p style={S.body}>
            Under a floating-rate note, the coupon resets periodically against a reference
            rate plus a fixed spread, so the instrument&rsquo;s duration stays short even
            where its stated maturity is long — which is why treasurers reach for them when
            they expect rates to rise.
          </p>
        </Section>

        <Section id="define" title="Define" how="Highlight exactly one word, then choose Define.">
          <p style={S.note}>
            Define goes to a real dictionary, not the model. Single words should return a
            dictionary entry with a part of speech; multi-word phrases should fall through
            to the model instead. Both paths are worth checking.
          </p>
          <div style={S.chips}>
            {JARGON.map((j) => (
              <span key={j.term} style={S.chip}>
                <em style={S.chipField}>{j.field}</em>
                {j.term}
              </span>
            ))}
          </div>
          <p style={S.body}>
            Code identifiers like useEffect and getElementById should <strong>not</strong>{" "}
            hit the dictionary — they fail the ordinary-casing test in background.js and
            should be answered by the model.
          </p>
        </Section>

        <Section id="factcheck" title="Fact-check one claim" how="Highlight a single claim → Fact-check.">
          <p style={S.note}>
            Each line has a settled answer, shown on the right. A verdict that disagrees is
            either a retrieval failure or a model failure — the card should say which.
          </p>
          <ul style={S.claims}>
            {CLAIMS.map((c) => (
              <li key={c.text} style={S.claim}>
                <span>{c.text}</span>
                <code style={S.expect}>{c.expect}</code>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="page" title="Fact-check the whole page" how="Open the popup → check this page.">
          <p style={S.note}>
            Runs claim extraction over the article below, then verifies each one. Watch for:
            claims getting highlighted in place, the counter chip updating as verdicts land,
            and the shared errata cache serving a second run instantly.
          </p>
          <article style={S.article}>
            <h3 style={S.h3}>A short article, mostly wrong on purpose</h3>
            <p style={S.body}>
              Humans use only 10 percent of their brains, a figure often attributed to
              Einstein, and one reason the Great Wall of China is the only man-made object
              visible from space with the naked eye. Neither statement survives contact with
              evidence, but both are repeated often enough to make good extraction targets.
            </p>
            <p style={S.body}>
              The Amazon rainforest is frequently described as the lungs of the planet,
              producing 20 percent of the world&rsquo;s oxygen. The figure is real but the
              framing is not: the forest consumes almost as much oxygen as it produces
              through respiration and decay, so its net contribution is close to zero.
            </p>
            <p style={S.body}>
              Napoleon Bonaparte, contrary to the popular image, stood around 1.68 metres —
              average for a Frenchman of his time. The myth comes from a confusion between
              French and English inches, compounded by British wartime caricature. Lightning,
              meanwhile, strikes the Empire State Building around 20 times a year, which
              settles the question of whether it strikes twice.
            </p>
          </article>
        </Section>

        <Section id="translate" title="Translate" how="Highlight → More → Translate.">
          <p style={S.body} lang="fr">
            La cour a jugé que le manquement du défendeur constituait une rupture
            fondamentale du contrat, ouvrant droit à la résiliation et à des dommages-intérêts.
          </p>
          <p style={S.body} lang="de">
            Die Bundesregierung hat angekündigt, die Förderung für Wärmepumpen im kommenden
            Haushaltsjahr deutlich auszuweiten.
          </p>
          <p style={S.body} lang="ja">
            裁判所は、被告の不履行が契約の重大な違反に当たると判断しました。
          </p>
          <p style={S.note}>
            Also worth testing: the non-English detector in content.js should notice these
            before you pick Translate, and offer it higher up the action list.
          </p>
        </Section>

        <Section id="reword" title="Reword in place" how="Highlight one sentence → Reword.">
          <p style={S.body}>
            Notwithstanding any provision to the contrary contained herein, the party of the
            first part shall indemnify and hold harmless the party of the second part against
            any and all claims arising out of or in connection with the performance of its
            obligations hereunder.
          </p>
          <p style={S.note}>
            The replacement should swap into the page in place, keep the surrounding
            sentence structure intact, and be undoable.
          </p>
        </Section>

        <Section id="askbox" title="Ask box" how="Double-tap Shift anywhere on this page.">
          <p style={S.body}>
            The box should open at the cursor, not at a fixed position. Ask a follow-up after
            the first answer to confirm per-tab conversation history is threading correctly —
            gateway.js keeps 12 messages per tab in storage.session.
          </p>
        </Section>

        <Section id="texttools" title="Text tools" how="Open the popup → text tools.">
          <p style={S.body}>
            Spawns the centred editor. Check the transform actions, the align cycle, expand
            and minimise, copy, and both downloads (Markdown and the print-to-PDF path).
          </p>
        </Section>

        <Section id="focus" title="Focus mode / collapse" how="Highlight → More → Focus.">
          <p style={S.note}>Neighbouring blocks should fold to a gist, with each fold individually re-openable.</p>
          {[1, 2, 3, 4, 5].map((n) => (
            <p key={n} style={S.body}>
              Paragraph {n} of the collapse fixture. Distinct enough to tell apart once
              folded, long enough that the gist has something to summarise, and adjacent to
              enough siblings that gatherNeighborBlocks has three blocks either side to work
              with. Highlight inside paragraph 3 to see folding in both directions.
            </p>
          ))}
        </Section>

        <Section id="threads" title="Threads panel" how="Ask something, then reopen it from the panel.">
          <p style={S.body}>
            Each ask is recorded as a thread with a topic tag and a colour derived from the
            topic string. Reopen one, post a reply, and confirm it persists across a reload —
            threads live in chrome.storage.local, so they should survive.
          </p>
        </Section>

        <Section id="engine" title="Engine + model download" how="Watch the counter in the diagnostics panel.">
          <p style={S.note}>
            This is the one that matters. The download line should appear{" "}
            <strong>once per profile, ever</strong>. If the counter above climbs every time
            you highlight, the model is being re-fetched or re-reported per ask.
          </p>
          <p style={S.body}>
            To test cold: open a fresh Chrome profile with no gateway key set, highlight
            anything, and let the download run to completion. Then highlight ten more times.
            The counter should not move. With a gateway key set, askEngine answers through
            the Gateway and warms the model in the background instead — that warm-up is now
            guarded so it can only ever fire one create() while a download is in flight.
          </p>
        </Section>
      </main>
    </div>
  );
}

function Section({ id, title, how, children }) {
  return (
    <section id={id} style={S.section}>
      <div style={S.sectionHead}>
        <h2 style={S.h2}>{title}</h2>
        <span style={S.how}>{how}</span>
      </div>
      {children}
    </section>
  );
}

function Diagnostics({ downloads, events, detected }) {
  return (
    <section style={S.diag}>
      <div style={S.diagGrid}>
        <Stat
          label="Model downloads reported"
          value={downloads}
          bad={downloads > 1}
          hint={downloads > 1 ? "should never exceed 1" : "0 or 1 is correct"}
        />
        <Stat label="Content script" value={detected ? "injected" : detected === false ? "absent" : "…"} bad={detected === false} />
        <Stat label="Page URL" value="/dev" hint="excluded from the store build" />
      </div>

      {detected === false && (
        <p style={S.warn}>
          No JustClarify DOM node appeared. Load the unpacked extension from{" "}
          <code>ambient-explainer-extension/</code> at <code>chrome://extensions</code> with
          Developer mode on. If the store version is also installed, that one is excluded
          from this URL by design.
        </p>
      )}

      <div style={S.log}>
        {events.length === 0 ? (
          <span style={S.logEmpty}>No events yet — highlight something to start.</span>
        ) : (
          events.map((e, i) => (
            <div key={i} style={S.logLine}>
              <code style={S.logTime}>{e.t}</code>
              {e.msg}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, hint, bad }) {
  return (
    <div style={S.stat}>
      <span style={S.statLabel}>{label}</span>
      <span style={{ ...S.statValue, ...(bad ? S.statBad : null) }}>{value}</span>
      {hint && <span style={S.statHint}>{hint}</span>}
    </div>
  );
}

const ACCENT = "#727cb0";

const S = {
  page: { minHeight: "100vh", background: "#fbf9f7", color: "#14110f", fontFamily: "var(--font-inter-tight), system-ui, sans-serif" },
  head: { position: "sticky", top: 0, zIndex: 40, background: "rgba(251,249,247,.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(20,17,15,.1)", padding: "14px 20px 10px" },
  headTop: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 },
  mark: { display: "inline-flex", flex: "none" },
  h1: { fontSize: 17, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" },
  badge: { fontSize: 11, padding: "3px 9px", borderRadius: 999, fontWeight: 600, marginLeft: "auto" },
  badgeOk: { background: "rgba(46,125,80,.12)", color: "#2e7d50" },
  badgeBad: { background: "rgba(180,60,60,.12)", color: "#b43c3c" },
  badgeWait: { background: "rgba(20,17,15,.08)", color: "#6b625c" },
  pills: { display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 },
  pill: { flex: "none", fontSize: 12.5, padding: "6px 13px", borderRadius: 999, border: "1px solid rgba(20,17,15,.14)", background: "transparent", color: "#14110f", cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" },
  pillOn: { background: ACCENT, borderColor: ACCENT, color: "#fff" },
  main: { maxWidth: 760, margin: "0 auto", padding: "28px 20px 120px" },
  diag: { border: `1px solid ${ACCENT}44`, background: `${ACCENT}0d`, borderRadius: 12, padding: 16, marginBottom: 36 },
  diagGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14 },
  stat: { display: "flex", flexDirection: "column", gap: 2 },
  statLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "#6b625c" },
  statValue: { fontSize: 22, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  statBad: { color: "#b43c3c" },
  statHint: { fontSize: 11.5, color: "#6b625c" },
  warn: { marginTop: 14, marginBottom: 0, fontSize: 13, lineHeight: 1.6, color: "#b43c3c" },
  log: { marginTop: 14, borderTop: "1px solid rgba(20,17,15,.1)", paddingTop: 10, maxHeight: 132, overflowY: "auto", fontSize: 12.5 },
  logEmpty: { color: "#6b625c" },
  logLine: { display: "flex", gap: 8, padding: "2px 0" },
  logTime: { color: "#6b625c", fontSize: 11.5, flex: "none" },
  section: { marginBottom: 44, scrollMarginTop: 108 },
  sectionHead: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid rgba(20,17,15,.1)" },
  h2: { fontSize: 19, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" },
  h3: { fontSize: 15, fontWeight: 600, margin: "0 0 10px" },
  how: { fontSize: 12.5, color: ACCENT, fontWeight: 500 },
  body: { fontSize: 15.5, lineHeight: 1.72, margin: "0 0 14px" },
  note: { fontSize: 13.5, lineHeight: 1.65, color: "#6b625c", margin: "0 0 14px" },
  article: { border: "1px solid rgba(20,17,15,.12)", borderRadius: 10, padding: "18px 20px", background: "#fff" },
  chips: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip: { display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, padding: "6px 12px", borderRadius: 8, background: "#fff", border: "1px solid rgba(20,17,15,.12)" },
  chipField: { fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".06em", color: "#6b625c", fontStyle: "normal" },
  claims: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 },
  claim: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, fontSize: 15, lineHeight: 1.55, padding: "10px 13px", background: "#fff", border: "1px solid rgba(20,17,15,.12)", borderRadius: 8 },
  expect: { flex: "none", fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "rgba(20,17,15,.06)", color: "#6b625c", fontWeight: 600 },
};
