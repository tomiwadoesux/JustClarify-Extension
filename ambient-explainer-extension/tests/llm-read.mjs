// Unit tests for the three streaming/slowness fixes in llm.js:
//   1. pageRead falls back to textContent when innerText is empty (hidden tab)
//   2. the busy check is display-based, not layout-based
//   3. the completion gate finishes on stable text even if busy is stuck
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

let failures = 0;
const check = (label, cond) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};

// ---- 1 & 2: pageRead against a stubbed DOM -------------------------------
function makeEl({ innerText, textContent, display = "inline", visibility = "visible" }) {
  return {
    innerText,
    textContent,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ display, visibility }) } },
  };
}

function runPageRead({ replies, busyEl, baseline = 0, baselineText = "" }) {
  const document = {
    querySelectorAll: () => replies,
    querySelector: () => busyEl || null,
  };
  const fn = new Function("selectors", "baseline", "baselineText", "document",
    grab("pageRead") + "\nreturn pageRead(selectors, baseline, baselineText);");
  return fn({ reply: [".reply"], busy: ["#stop"] }, baseline, baselineText, document);
}

// A hidden tab: innerText empty (no layout), textContent has the answer.
const hidden = runPageRead({
  replies: [makeEl({ innerText: "", textContent: "the real answer" })],
  busyEl: null,
});
check("hidden tab: textContent is read when innerText is empty", hidden.text === "the real answer");

// A painting tab: innerText present, and it wins (cleaner than textContent).
const painting = runPageRead({
  replies: [makeEl({ innerText: "clean answer", textContent: "clean answerCopyShare" })],
  busyEl: null,
});
check("painting tab: innerText is preferred over textContent", painting.text === "clean answer");

// busy via display, not layout: a display:none stop button is NOT busy...
const notBusy = runPageRead({
  replies: [makeEl({ innerText: "x", textContent: "x" })],
  busyEl: makeEl({ innerText: "", textContent: "", display: "none" }),
});
check("busy=false when the stop button is display:none", notBusy.busy === false);

// ...and a visible one IS busy.
const isBusy = runPageRead({
  replies: [makeEl({ innerText: "x", textContent: "x" })],
  busyEl: makeEl({ innerText: "stop", textContent: "stop", display: "flex" }),
});
check("busy=true when the stop button is visible", isBusy.busy === true);

// ---- 4: the reply COUNT is not the only proof an answer arrived ----------
//
// From a real service-worker trace: baseline 3, replies 3, domChars 0, for a
// whole two-minute run — while the answer sat finished and visible on screen.
// ChatGPT reuses and virtualises its message nodes, so waiting for the count to
// exceed the baseline waits forever. The last reply's TEXT changing is the
// other, equally valid proof.
const older = "the answer to the PREVIOUS question";

const reused = runPageRead({
  replies: [
    makeEl({ innerText: "a", textContent: "a" }),
    makeEl({ innerText: "b", textContent: "b" }),
    makeEl({ innerText: "the new answer", textContent: "the new answer" }),
  ],
  baseline: 3,
  baselineText: older,
});
check("count pinned at baseline: a CHANGED last reply is still read", reused.text === "the new answer");
check("...and the read says which signal fired", reused.viaChange === true);

// The other half, and the reason `baseline` existed at all: a conversation that
// has not answered yet must NOT hand back the previous question's answer.
const stale = runPageRead({
  replies: [
    makeEl({ innerText: "a", textContent: "a" }),
    makeEl({ innerText: "b", textContent: "b" }),
    makeEl({ innerText: older, textContent: older }),
  ],
  baseline: 3,
  baselineText: older,
});
check("unchanged last reply is NOT served as this ask's answer", stale.text === "");

// A provider that does append a node still takes the unambiguous path.
const appended = runPageRead({
  replies: [
    makeEl({ innerText: "a", textContent: "a" }),
    makeEl({ innerText: "b", textContent: "b" }),
    makeEl({ innerText: older, textContent: older }),
    makeEl({ innerText: "brand new node", textContent: "brand new node" }),
  ],
  baseline: 3,
  baselineText: older,
});
check("a NEW reply node is read the old, unambiguous way", appended.text === "brand new node");
check("...and is not reported as a text-change read", appended.viaChange !== true);

// An empty conversation reads as nothing rather than throwing.
const empty = runPageRead({ replies: [], baseline: 0, baselineText: "" });
check("no replies at all: empty, no throw", empty.text === "" && empty.replies === 0);

// ---- 3: the completion gate, source-level -------------------------------
const askBody = src.slice(src.indexOf("async function llmAskNow"));
check(
  "a stable-done ceiling exists",
  /const STABLE_DONE_MS = 4000/.test(src),
);
check(
  "the loop finishes on stable text regardless of the busy button",
  /stableDone = stableFor >= STABLE_DONE_MS/.test(askBody),
);
check(
  "either a clean finish OR a stable-text finish ends the poll",
  /if \(cleanDone \|\| stableDone\)/.test(askBody),
);
check(
  "a newer ask supersedes a running one instead of queuing behind its timeout",
  /if \(superseded\(\)\)/.test(askBody),
);
check(
  "each ask claims a generation so it can be superseded",
  /let llmGeneration = 0/.test(src) && /const myGen = \+\+llmGeneration/.test(src),
);

console.log();
console.log(failures === 0 ? "llm-read OK" : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
