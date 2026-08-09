// What voice mode HIGHLIGHTS vs what it SENDS. Run with:  npm run test:grounding
//
// These two were the same thing until they were split, and the result was the
// bug this file exists to prevent: say a sentence, watch the whole paragraph
// light up. The highlight is a claim about what was heard, so it has to be
// exactly the heard words — while the model still has to receive the passage
// around them or the answer is about a fragment.
//
// Not part of `npm test`: it needs a real browser, because every assertion here
// is about Ranges, client rects and innerText, none of which have a meaningful
// stand-in. Like run-tests.mjs it EXTRACTS the functions from source rather
// than importing them, so it can never drift from the shipping code.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const commands = readFileSync(join(root, "commands.js"), "utf8");
const content = readFileSync(join(root, "content.js"), "utf8");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (_) {
  console.log("grounding: skipped (playwright not installed)");
  process.exit(0);
}

// ---------------------------------------------------------------- extraction

function grab(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

const stopStart = commands.indexOf("const STOP = new Set(");
const bundle = [
  commands.slice(stopStart, commands.indexOf(");", stopStart) + 2),
  "const CONTEXT_MIN_CHARS = 240, CONTEXT_MAX_CHARS = 6000;",
  grab(content, "extractSemanticWindow"),
  ...[
    "normalizeChar",
    "wordDistance",
    "wordsClose",
    "findTextRange",
    "contextRootFor",
    "locateText",
    "dataForRange",
    "tokens",
    "candidateBlocks",
    "bestBlock",
    "narrowToPhrase",
  ].map((name) => grab(commands, name)),
].join("\n\n");

// A page shaped like the real failure: a phrase wrapped in inline markup, sat
// mid-paragraph, with sentences on both sides that belong in the context and
// nowhere near the highlight.
const PAGE = `<!doctype html><meta charset=utf-8><body>
<article>
  <p id=p1>Every deployment used to take about forty minutes of manual work.
  Sam is a <strong>front-end engineer</strong> at Yolat, and he rebuilt the release
  pipeline over a single weekend. The team now ships four times a day without
  anyone watching a dashboard. Nobody has rolled back since March.</p>
  <p id=p2>Pricing is unchanged for existing customers. New seats are billed
  monthly at the published rate, and annual plans keep the old discount.</p>
</article></body>`;

// -------------------------------------------------------------------- checks

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(PAGE);
await page.addScriptTag({ content: bundle });

let failures = 0;
function check(ok, label, detail = "") {
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// 1. A phrase said aloud that is literally on the page.
const exact = await page.evaluate(() => {
  const range = findTextRange("front end engineer at yolat");
  if (!range) return null;
  const text = range.toString().trim();
  return { text, data: dataForRange(range, text) };
});
const p1Length = await page.evaluate(() => document.getElementById("p1").innerText.trim().length);

check(!!exact, "a verbatim phrase is found on the page");
check(
  exact && /^front-end engineer at Yolat$/i.test(exact.text),
  "the selection is EXACTLY the heard words",
  exact && JSON.stringify(exact.text),
);
check(
  exact && exact.text.length < p1Length / 3,
  "the selection is nowhere near the size of its block",
  exact && `${exact.text.length} of ${p1Length} chars`,
);
check(
  exact && exact.data.contextWindow.includes("release"),
  "the context window still reaches the surrounding sentences",
  exact && JSON.stringify(exact.data.contextWindow.slice(0, 90)),
);
check(
  exact && exact.data.contextWindow.includes("forty minutes"),
  "the context window reaches BACKWARDS too, not just forwards",
  exact && JSON.stringify(exact.data.contextWindow.slice(0, 90)),
);
check(
  exact && exact.data.contextWindowWide.length >= exact.data.contextWindow.length,
  "the wide window is at least as wide as the tight one",
);

// 2. Misheard or paraphrased: no exact range exists, so it falls back to a
//    block — but must still narrow to the sentence rather than take the lot.
const narrowed = await page.evaluate(() => {
  const want = tokens("ships four times a day");
  const block = bestBlock(want);
  if (!block.block) return null;
  const tight = narrowToPhrase(block.block.el, want);
  return {
    blockLength: block.block.text.length,
    text: tight && tight.text,
    context: tight && dataForRange(tight.range, tight.text).contextWindow,
  };
});

check(!!(narrowed && narrowed.text), "a paraphrase narrows to a sentence inside the block");
check(
  narrowed && narrowed.text && narrowed.text.length < narrowed.blockLength,
  "the narrowed sentence is shorter than the whole block",
  narrowed && `${narrowed.text?.length} of ${narrowed.blockLength} chars`,
);
check(
  narrowed && narrowed.context && narrowed.context.length > (narrowed.text || "").length,
  "the narrowed sentence still carries surrounding context",
);

// 3. A phrase crossing an inline element is one tight range, and the context
//    climbs past that element to the paragraph holding it.
const spanning = await page.evaluate(() => {
  const range = findTextRange("a front end engineer at yolat and he rebuilt");
  if (!range) return null;
  const text = range.toString().trim();
  return {
    text,
    rects: range.getClientRects().length,
    context: dataForRange(range, text).contextWindow,
  };
});

check(!!spanning, "a phrase crossing a <strong> boundary is found");
check(spanning && spanning.rects >= 1, "the range has client rects for the trace to draw");
check(
  spanning && spanning.context.includes("forty minutes"),
  "context climbs past the inline element to the paragraph",
  spanning && JSON.stringify(spanning.context.slice(0, 80)),
);

// 4. Nothing on the page: grounding must decline rather than point somewhere.
const absent = await page.evaluate(() => findTextRange("quarterly revenue in singapore") !== null);
check(!absent, "a phrase that isn't on the page grounds nowhere");

await browser.close();
console.log(failures ? `\ngrounding: ${failures} failing` : "all grounding tests passed");
process.exit(failures ? 1 : 0);
