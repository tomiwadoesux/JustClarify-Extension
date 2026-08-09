// The tile's SIZE, and the one line of copy that depends on it.
//
// Two reported bugs live here, and both are about the same thing — the window
// not keeping the size you gave it:
//
//   1. "even if I resize it to be smaller it comes back in another size."
//      llmPopupWake floored the restored width at LLM_POPUP.width with a
//      Math.max, so the ONLY resize anybody actually performs — dragging the
//      tile smaller — was silently undone on every single ask.
//   2. A provider that can't mount a composer in a 220px window makes the ask
//      borrow 420x600 mid-flight. Nothing ever gave it back, so one awkward
//      provider permanently resized a window the user had deliberately shrunk.
//
// And the caption that hangs off them: "Adjust me to be smaller" is shown at
// the granted size and withdrawn once it has been followed — so the shrink
// detection has to be exactly right in both directions.
import fs from "node:fs";

const src = fs.readFileSync(new URL("../llm.js", import.meta.url), "utf8");

function grab(name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  // Keep the `async` if there is one — dropping it turns every await inside
  // into a syntax error the moment new Function() compiles it.
  if (src.slice(start - 6, start) === "async ") start -= 6;
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

const popupConst = src.slice(
  src.indexOf("const LLM_POPUP = {"),
  src.indexOf("};", src.indexOf("const LLM_POPUP = {")) + 2,
);
const tolConst = src.match(/const LLM_TILE_SHRUNK_BY = \d+;/)[0];
const hintConst = src.match(/const LLM_TILE_HINT = "[^"]+";/)[0];

let failures = 0;
const check = (label, cond, detail) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  <-- ${detail || ""}`}`);
};

// ---------------------------------------------------------------- the verdict

// llmTileIsSmaller, run against a real baseline.
const makeIsSmaller = (base) =>
  new Function(
    "size",
    `${tolConst}
     const llmTile = { base: ${JSON.stringify(base)} };
     ${grab("llmTileIsSmaller")}
     return llmTileIsSmaller(size);`,
  );

{
  const isSmaller = makeIsSmaller({ width: 250, height: 250 });
  check("same size as granted is not 'smaller'", isSmaller({ width: 250, height: 250 }) === false);
  check("bigger is not 'smaller'", isSmaller({ width: 400, height: 600 }) === false);
  check("a few pixels of jitter is not 'smaller'", isSmaller({ width: 246, height: 250 }) === false);
  check("clearly narrower IS smaller", isSmaller({ width: 180, height: 250 }) === true);
  check("clearly shorter IS smaller", isSmaller({ width: 250, height: 140 }) === true);
  check("both axes smaller IS smaller", isSmaller({ width: 120, height: 120 }) === true);
  // Dragging it back up has to bring the caption back — that is the second half
  // of the behaviour, and it comes free only if this is a live comparison.
  check("back at the granted size, it is not 'smaller' again", isSmaller({ width: 250, height: 250 }) === false);
}

{
  // No baseline recorded yet: never claim a shrink we cannot substantiate.
  const isSmaller = makeIsSmaller(null);
  check("with no baseline nothing counts as shrunk", isSmaller({ width: 10, height: 10 }) === false);
}

// ------------------------------------------------------------ waking the tile

// llmPopupWake with every collaborator stubbed, so what is asserted is the
// bounds it ASKS Chrome for.
async function wake({ moved, bounds, base, cursor }) {
  const calls = [];
  const chrome = {
    storage: {
      local: {
        get: async () => ({ jcLlmWindowMoved: moved, jcLlmWindowBounds: bounds }),
        set: async () => {},
      },
    },
    windows: {
      update: async (_id, update) => {
        calls.push(update);
        // Chrome's undocumented floor, roughly. It clamps and reports back.
        return {
          width: Math.max(update.width || 0, 100),
          height: Math.max(update.height || 0, 96),
        };
      },
    },
  };
  const body = new Function(
    "chrome",
    "cursor",
    "tileBase",
    "calls",
    `${popupConst}
     ${tolConst}
     let llmTile = { base: tileBase, now: null, shrunk: false };
     const llmTileSet = (next) => { llmTile = { ...llmTile, ...next }; };
     const llmSelfMove = () => {};
     const llmTileZoom = async () => {};
     const llmPopupVeil = () => {};
     ${grab("llmTileIsSmaller")}
     ${grab("llmPopupPlace")}
     ${grab("llmPopupWake")}
     return llmPopupWake(1, 2, cursor).then(() => ({ calls, llmTile }));`,
  );
  return body(chrome, cursor, base, calls);
}

const DISPLAY = { availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1440 };

{
  // THE regression. A window dragged down to 140x120 must be woken at 140x120.
  const { calls, llmTile } = await wake({
    moved: true,
    bounds: { left: 300, top: 200, width: 140, height: 120 },
    base: { width: 250, height: 250 },
  });
  const asked = calls[0] || {};
  check(
    "a window shrunk to 140x120 is woken at 140x120, not grown back",
    asked.width === 140 && asked.height === 120,
    `asked for ${asked.width}x${asked.height}`,
  );
  check("and it is woken where they left it", asked.left === 300 && asked.top === 200);
  check("the caption stands down once they have shrunk it", llmTile.shrunk === true);
}

{
  // The other direction still works: a window dragged BIGGER stays bigger.
  const { calls, llmTile } = await wake({
    moved: true,
    bounds: { left: 40, top: 40, width: 700, height: 900 },
    base: { width: 250, height: 250 },
  });
  const asked = calls[0] || {};
  check(
    "a window dragged bigger keeps its size too",
    asked.width === 700 && asked.height === 900,
    `asked for ${asked.width}x${asked.height}`,
  );
  check("and a bigger window is not treated as shrunk", llmTile.shrunk === false);
}

{
  // Dragged smaller, then dragged back: the caption returns.
  const { llmTile } = await wake({
    moved: true,
    bounds: { left: 40, top: 40, width: 250, height: 250 },
    base: { width: 250, height: 250 },
  });
  check("back at the granted size the caption is offered again", llmTile.shrunk === false);
}

{
  // Never touched: the tile size, parked bottom-right. It no longer follows the
  // pointer — a silent tile appearing under your hand mid-page is something to
  // dismiss, not something ambient — so the corner is the assertion now.
  const { calls } = await wake({ moved: false, bounds: null, base: null, cursor: { x: 800, y: 500, ...DISPLAY } });
  const asked = calls[0] || {};
  const tileW = Number(popupConst.match(/width:\s*(\d+)/)[1]);
  const tileH = Number(popupConst.match(/height:\s*(\d+)/)[1]);
  const gap = Number(popupConst.match(/gap:\s*(\d+)/)[1]);
  const R = DISPLAY.availLeft + DISPLAY.availWidth;
  const B = DISPLAY.availTop + DISPLAY.availHeight;
  check("an untouched window still opens at the tile size", asked.width === tileW, `${asked.width}`);
  check(
    "and parks in the bottom-right corner, not at the cursor",
    asked.left === R - tileW - gap && asked.top === B - tileH - gap,
    `got [${asked.left},${asked.top}], wanted [${R - tileW - gap},${B - tileH - gap}]`,
  );
}

{
  // Worker restarted and lost the baseline, but the user clearly had one.
  // Silence is the right way to be wrong: better than nagging somebody who has
  // already done the thing the caption asks for.
  const { llmTile } = await wake({
    moved: true,
    bounds: { left: 10, top: 10, width: 160, height: 150 },
    base: null,
  });
  check("a lost baseline plus deliberate bounds means no nagging", llmTile.shrunk === true);
  check("and the size in front of us becomes the new baseline", llmTile.base?.width === 160);
}

// -------------------------------------------------------------- borrowed size

// The 420x600 grow is a loan. Something has to hand it back, or bug (2) above
// is still live.
{
  check(
    "the fallback grow has a matching restore",
    /async function llmPopupRestore\(/.test(src),
    "llmPopupRestore is missing",
  );
  const idle = grab("llmPopupIdle");
  check("and idling the window is what calls it", /llmPopupRestore\(/.test(idle), idle);
  const restore = grab("llmPopupRestore");
  check(
    "restore puts back the user's own bounds, not the tile default",
    /jcLlmWindowBounds/.test(restore) && /b\.width/.test(restore),
    restore,
  );
  check(
    "restore claims the move first, so its own resize is not read as user intent",
    /llmSelfMove\(\)/.test(restore),
  );
}

// ------------------------------------------------------------------- the copy

{
  check("the caption says what it does", /Adjust me to be smaller/.test(hintConst), hintConst);
  // Sized in REAL window pixels. At 0.25 zoom a 14px caption paints at three
  // and a half pixels, which is the entire reason the conversion exists.
  const veil = grab("pageVeil");
  check(
    "the tile converts real pixels to CSS pixels rather than trusting innerWidth",
    /tileWidth/.test(veil) && /cssPx/.test(veil),
    "pageVeil is not compensating for the tab zoom",
  );
  check(
    "a resize updates the caption without rebuilding the tile mid-ask",
    /function pageVeilHint\(/.test(src) && /pageVeilHint,/.test(src),
    "pageVeilHint missing, or never sent from onBoundsChanged",
  );
}

console.log();
console.log(failures === 0 ? "popup-tile OK" : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
