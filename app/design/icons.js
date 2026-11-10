import { ICON_INSET, REICON } from "./icon-packs";

// The extension's icon family, lifted verbatim from
// ambient-explainer-extension/content.js so this reference page and the
// shipped UI can never drift apart. Phosphor-style duotone: a 20%-opacity
// filled silhouette behind a 1.7px stroked foreground.

export const DUO = {
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

export const FG = {
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

function duoKeyFor(name) {
  if (name.startsWith("align")) return "align";
  if (name === "expandFull" || name === "contract") return "resize";
  return name;
}

export function iconMarkup(name) {
  const duo = DUO[duoKeyFor(name)] || "";
  const fg = FG[name] || FG.explain;
  return (
    (duo
      ? `<g class="jc-ph-duo" fill="currentColor" stroke="none" opacity="0.2">${duo}</g>`
      : "") +
    `<g class="jc-ph-fg" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${fg}</g>`
  );
}

// Every icon the page draws, in Reicon outline. iconMarkup above is kept for
// the one place that still needs the old drawing: the specimen showing what
// content.js ships today, so the two can be compared honestly.
// Reicon draws edge to edge at 2 -> 22 in a 24 box, so its glyphs land larger
// and correspondingly heavier than the set they replace. Widening the viewBox
// scales the drawing down inside the same rendered box, which thins the
// apparent stroke and buys back the padding. Two icons carry their own larger
// pad because no stroke version of them exists in the family.
function inset(ic) {
  const p = ic.pad ?? ICON_INSET;
  return `${-p} ${-p} ${ic.w + p * 2} ${ic.h + p * 2}`;
}

export function Ico({ name, size = 22, className = "" }) {
  const ic = REICON[name];
  if (!ic) {
    return (
      <svg
        className={`jc-lucide jc-ph ${className}`}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: iconMarkup(name) }}
      />
    );
  }
  return (
    <svg
      className={`jc-lucide jc-pack ${className}`}
      viewBox={inset(ic)}
      width={size}
      height={size}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ic.b }}
    />
  );
}

// Every icon in the family, in the order they were authored.
export const ICON_NAMES = [
  "explain",
  "expand",
  "define",
  "factcheck",
  "textarea",
  "translate",
  "summarize",
  "example",
  "humanize",
  "shorten",
  "ondevice",
  "copy",
  "download",
  "alignJustify",
  "alignLeft",
  "alignCenter",
  "alignRight",
  "expandFull",
  "contract",
  "minimize",
  "close",
  "chevronLeft",
  "chevronRight",
];
