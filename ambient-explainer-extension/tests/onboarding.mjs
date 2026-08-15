// The first-run walk through spans five files that have to agree with each
// other: background.js arms it, the manifest loads it, onboarding.js runs it on
// the page, popup.js narrates the steps that happen inside browser chrome, and
// popup.html holds the element it writes into. None of them can see the others
// at runtime, so nothing fails loudly when one drifts. These tests are the
// only thing holding the seams together.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, "..", name), "utf8");

const onboarding = read("onboarding.js");
const background = read("background.js");
const popupJs = read("popup.js");
const popupHtml = read("popup.html");
const manifest = JSON.parse(read("manifest.json"));

let failures = 0;
function check(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
}

// --- it is loaded at all -----------------------------------------------------

const scripts = manifest.content_scripts?.[0]?.js || [];
check("onboarding.js is a content script", scripts.includes("onboarding.js"));
check(
  "it loads AFTER content.js, whose elements it points at",
  scripts.indexOf("onboarding.js") > scripts.indexOf("content.js"),
);

// --- it starts only on a genuine install -------------------------------------

check(
  "the walk through is armed from onInstalled",
  /onInstalled[\s\S]{0,1200}jcOnboard/.test(background),
);
check(
  "and only when the reason is a fresh install, never an update or a reload",
  /reason\s*===\s*'install'[\s\S]{0,400}jcOnboard/.test(background),
);
check(
  "it is armed as pending, not shown from the worker",
  /jcOnboard:\s*\{\s*status:\s*'pending'/.test(background),
);

// --- the two halves use the same names ---------------------------------------

const stageNames = [...onboarding.matchAll(/^\s{4}(?:async\s+)?(\w+)\(\)\s*\{/gm)].map((m) => m[1]);
check("onboarding.js defines its stages as a table", stageNames.length >= 8);
for (const required of ["invite", "toolbar", "engine", "highlight", "diamond", "action", "voice"]) {
  check(`stage "${required}" exists`, stageNames.includes(required));
}

// popup.js keys its lines by stage name. A renamed stage would silently show
// nothing, which is the failure this catches. Read only from the LINES table,
// so the unrelated key/model tables elsewhere in the file are not mistaken for
// stage names.
const linesBlock = popupJs.match(/const LINES = \{([\s\S]*?)\n {2}\};/);
check("popup.js has a LINES table", !!linesBlock);
const popupStages = linesBlock
  ? [...linesBlock[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
  : [];
check("popup.js narrates at least one stage", popupStages.length > 0);
for (const name of popupStages) {
  check(`popup.js line "${name}" matches a real stage`, stageNames.includes(name));
}

check(
  "popup.html has the element popup.js writes into",
  /id="jc-walk-text"/.test(popupHtml) && /id="jc-walk"/.test(popupHtml),
);
check(
  "and it starts hidden, so a normal open shows nothing",
  /id="jc-walk"[^>]*\shidden/.test(popupHtml),
);

// --- the baton ---------------------------------------------------------------

check(
  "popup.js reports that the toolbar was opened",
  /popupOpen:\s*true/.test(popupJs),
);
check(
  "and the page's first step waits for exactly that",
  /whenStorage\(KEY,\s*\(v\)\s*=>\s*v\s*&&\s*v\.popupOpen/.test(onboarding),
);
check(
  "the engine step waits on the real engine key the popup writes",
  /whenStorage\("jcEngine"/.test(onboarding) && /jcEngine:\s*btn\.dataset\.engine/.test(popupJs),
);

// --- it points at real things ------------------------------------------------

for (const selector of ["#ambient-blob", "#ambient-popup", ".jc-bar-btn", "#jc-voice-chip"]) {
  check(`it observes the real ${selector}`, onboarding.includes(selector));
}
check(
  "the action step accepts the real Explain and Expand keys",
  /"default"[\s\S]{0,60}"detailed"/.test(onboarding),
);

// --- nobody gets trapped -----------------------------------------------------

check("Escape ends it", /key === "Escape"[\s\S]{0,120}finish\("quit"\)/.test(onboarding));
check("a close button ends it", /\.x[\s\S]{0,200}finish\("quit"\)/.test(onboarding));
check(
  "remind me later stops asking after the second deferral",
  /deferrals\s*>=\s*2\s*\?\s*"done"/.test(onboarding),
);
check(
  "later means a day later, not the next page",
  /24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(onboarding),
);
check(
  "an abandoned run expires instead of resuming somewhere random",
  /STAGE_TTL_MS/.test(onboarding) && /status:\s*"done"/.test(onboarding),
);
check(
  "it never runs in an iframe",
  /window\.top\s*!==\s*window/.test(onboarding),
);
check(
  "it waits for a page with enough text to teach on",
  /pageIsReadable\(\)/.test(onboarding),
);

// --- the page's words are text, never markup ---------------------------------

check(
  "copy quoting the page is set with textContent",
  !/innerHTML\s*=\s*[`"'][^`"']*\$\{(?:chosen|phrase)/.test(onboarding),
);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nonboarding OK");
