// Where does the little provider window land?
//
// Chrome REFUSES a window whose bounds are not at least 50% within visible
// screen space — it throws and the whole ask fails. Measured against real
// Chrome: asking for a position fully off-screen, half off-screen, OR at a
// negative offset were all rejected outright. So a naive "cursor + gap" breaks
// every time the pointer is near a right or bottom edge, and on a second
// monitor sitting left of the primary (where coordinates go negative).
//
// This drives llmPopupPlace through every corner of every plausible display
// layout and asserts the result is ALWAYS fully inside that display.
import fs from "node:fs";

const src = fs.readFileSync(new URL("../llm.js", import.meta.url), "utf8");

function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0, i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

// LLM_POPUP is referenced by the function, so pull the real literal in too.
const popupConst = src.slice(src.indexOf("const LLM_POPUP = {"), src.indexOf("};", src.indexOf("const LLM_POPUP = {")) + 2);
const place = new Function(
  "cursor", "size",
  `${popupConst}\n${grab("llmPopupPlace")}\nreturn llmPopupPlace(cursor, size);`,
);

let failures = 0;
const check = (label, cond, detail) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  <-- ${detail || ""}`}`);
};

const SIZE = { width: 420, height: 600 };

// Three realistic layouts: a laptop, a big primary, and a second monitor placed
// to the LEFT of and ABOVE the primary, where avail coords are negative.
const displays = [
  { name: "laptop 1440x900", availLeft: 0, availTop: 25, availWidth: 1440, availHeight: 875 },
  { name: "desktop 2560x1440", availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1440 },
  { name: "second monitor left/up", availLeft: -1920, availTop: -300, availWidth: 1920, availHeight: 1080 },
];

for (const d of displays) {
  const L = d.availLeft, T = d.availTop;
  const R = L + d.availWidth, B = T + d.availHeight;
  // Every corner, every edge midpoint, and the centre.
  const points = [
    ["top-left", L + 2, T + 2],
    ["top-right", R - 2, T + 2],
    ["bottom-left", L + 2, B - 2],
    ["bottom-right", R - 2, B - 2],
    ["centre", L + d.availWidth / 2, T + d.availHeight / 2],
    ["right edge", R - 1, T + d.availHeight / 2],
    ["bottom edge", L + d.availWidth / 2, B - 1],
    ["exactly at origin", L, T],
    ["past the right edge", R + 200, T + 100],
    ["past the bottom edge", L + 100, B + 200],
  ];

  let allInside = true;
  const offenders = [];
  for (const [label, x, y] of points) {
    const r = place({ x, y, ...d }, SIZE);
    if (r.left == null) { offenders.push(`${label}: no placement`); allInside = false; continue; }
    const inside =
      r.left >= L && r.top >= T && r.left + SIZE.width <= R && r.top + SIZE.height <= B;
    if (!inside) {
      allInside = false;
      offenders.push(`${label}: [${r.left},${r.top}] escapes [${L},${T} .. ${R},${B}]`);
    }
    if (!Number.isInteger(r.left) || !Number.isInteger(r.top)) {
      allInside = false;
      offenders.push(`${label}: non-integer [${r.left},${r.top}]`);
    }
  }
  check(`${d.name}: every cursor position lands fully on screen`, allInside, offenders.join("; "));
}

// The window PARKS BOTTOM-RIGHT and ignores the pointer entirely. Following the
// cursor made sense when this window was the answer surface; it is a silent
// tile now, and a box that appears under your hand mid-page is something to
// dismiss rather than something ambient. Bottom-right is where a system tray
// lives: findable, never over the text.
for (const d of displays) {
  const R = d.availLeft + d.availWidth, B = d.availTop + d.availHeight;
  const corner = place({ x: 800, y: 500, ...d }, SIZE);
  const gap = 16; // LLM_POPUP.gap
  check(
    `${d.name}: parks in the bottom-right corner`,
    corner.left === R - SIZE.width - gap && corner.top === B - SIZE.height - gap,
    `got [${corner.left},${corner.top}], wanted [${R - SIZE.width - gap},${B - SIZE.height - gap}]`,
  );
}

// And the pointer must make NO difference to where it lands.
{
  const d = displays[1];
  const a = place({ x: 10, y: 10, ...d }, SIZE);
  const b = place({ x: 2000, y: 1200, ...d }, SIZE);
  check(
    "the cursor position no longer moves the window",
    a.left === b.left && a.top === b.top,
    `[${a.left},${a.top}] vs [${b.left},${b.top}]`,
  );
}

// A display smaller than the window: hand it back to Chrome rather than
// producing bounds Chrome will reject.
{
  const tiny = { availLeft: 0, availTop: 0, availWidth: 320, availHeight: 400 };
  const r = place({ x: 100, y: 100, ...tiny }, SIZE);
  check("a display smaller than the window yields no forced position", r.left == null);
}

// Missing/garbage screen data must not crash or invent coordinates. The cursor's
// own x/y are no longer read at all, so only the display bounds matter.
for (const [label, cursor] of [
  ["null cursor", null],
  ["empty object", {}],
  ["no display bounds", { x: 10, y: 10 }],
]) {
  const r = place(cursor, SIZE);
  check(`${label} falls back to letting Chrome place it`, r && r.left == null);
}

// A garbage x with SOUND display bounds is now perfectly placeable — the corner
// does not depend on the pointer.
{
  const r = place({ x: "nope", y: 10, availLeft: 0, availTop: 0, availWidth: 1440, availHeight: 900 }, SIZE);
  check("a bad cursor x no longer prevents placement", r && r.left != null, JSON.stringify(r));
}

// The tile is now the ONLY size — there is no separate idle strip, because
// growing to work is what made this surface loud. It still has to clear Chrome's
// floor and still has to land on screen at the worst corner of the worst display.
{
  const tileW = Number(popupConst.match(/width:\s*(\d+)/)[1]);
  const tileH = Number(popupConst.match(/height:\s*(\d+)/)[1]);
  check("tile height clears Chrome's ~96px floor", tileH >= 96, `height=${tileH}`);
  check("tile is small enough to read as an icon", tileW <= 320 && tileH <= 320, `${tileW}x${tileH}`);

  const d = displays[2];
  const r = place({ x: d.availLeft + d.availWidth - 1, y: d.availTop + d.availHeight - 1, ...d }, { width: tileW, height: tileH });
  const inside =
    r.left >= d.availLeft && r.top >= d.availTop &&
    r.left + tileW <= d.availLeft + d.availWidth &&
    r.top + tileH <= d.availTop + d.availHeight;
  check("tile lands on screen at the far corner of a negative-coord display", inside, JSON.stringify(r));

  // Shrinking the window shrinks the viewport the provider lays out in, which is
  // what would unmount the composer the driver types into. Zoom is what buys it
  // back, so the effective CSS viewport must still be desktop-sized.
  const zoom = Number(popupConst.match(/zoom:\s*([\d.]+)/)[1]);
  check("zoom is not below Chrome's 0.25 floor", zoom >= 0.25, `zoom=${zoom}`);
  const cssWidth = Math.round(tileW / zoom);
  check("the zoomed-out CSS viewport is still desktop-width", cssWidth >= 768, `${cssWidth}px`);

  // And there must remain a way out if a provider defeats the zoom entirely.
  check(
    "a full-size fallback exists for a provider that still won't mount a composer",
    /fallbackWidth:\s*(\d+)/.test(popupConst) && /fallbackHeight:\s*(\d+)/.test(popupConst),
  );
}

console.log();
console.log(failures === 0 ? "popup-place OK" : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
