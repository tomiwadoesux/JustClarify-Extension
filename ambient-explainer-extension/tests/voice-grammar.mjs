// Routing tests for the voice grammar in commands.js.
//
// Born from a real failure: "what is this site about" fell through to the
// define catch-all and the extension solemnly defined the words "this site
// about". The grammar is an ordered list where the first match wins, so every
// new rule can silently steal sentences from the ones below it — and nothing
// noticed until a person did. This file is the thing that notices.
//
// The rules are extracted from the source as regex literals and probed with
// real sentences. Each probe pins WHICH KIND of rule must win, identified by a
// distinctive fragment of the winning regex — not by index, which would break
// on every insertion.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "commands.js"), "utf8");

const rules = [];
const ruleRe = /\{ re: (\/(?:[^/\\\n]|\\.)+\/[a-z]*),\s*\n?\s*run:/g;
let m;
while ((m = ruleRe.exec(src))) {
  try {
    rules.push(eval(m[1]));
  } catch {
    // A rule that doesn't eval as a bare literal (none today) just isn't probed.
  }
}

let failures = 0;
function check(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
}

check("the grammar extracted into a sensible number of rules", rules.length > 60);

// fragment: a substring of the regex source that must (or, for "MODEL", can
// never) be the first match for the sentence.
const FRAG = {
  PAGE: "site|page|website",
  TARGET: "i don'?t (?:get|understand)",
  DEFINE: "define|what'?s|what is) (?:a |an |the )?",
  SCROLL: "down|page down",
  CLICK: "click|press|tap",
  SEARCH: "search|look up|search for",
};

function winner(sentence) {
  const rule = rules.find((r) => r.test(sentence));
  return rule ? rule.source : null;
}

function route(sentence, want) {
  const won = winner(sentence);
  if (want === "MODEL") {
    check(`"${sentence}" reaches the model, matched by no rule`, won === null);
    return;
  }
  const ok = won != null && won.includes(FRAG[want]);
  check(`"${sentence}" routes to ${want}`, ok);
  if (!ok && won) console.log(`      won instead: ${won.slice(0, 70)}`);
}

// Questions about the page itself answer from the page, never the dictionary.
route("what is this site about", "PAGE");
route("what is this page", "PAGE");
route("what's this website for", "PAGE");
route("summarize this page", "PAGE");
route("summarize", "PAGE");
route("tldr", "PAGE");
route("where am i", "PAGE");
route("who runs this site", "PAGE");
route("what's happening here", "PAGE");
route("what's going on", "PAGE");
route("what am i looking at", "PAGE");

// Bare deixis resolves the most recent target, exactly like "explain this".
route("what is this", "TARGET");
route("explain this", "TARGET");

// The dictionary keeps real lookups: short, no deixis.
route("what is a derivative", "DEFINE");
route("define quantitative easing", "DEFINE");
route("what is the theory of relativity", "DEFINE");

// Open questions belong to the agent loop, not to a literal-minded rule.
route("what is the difference between stocks and bonds", "MODEL");
route("what is the best laptop to buy", "MODEL");
route("is this site legit", "MODEL");

// And the everyday verbs stay exactly where they were.
route("scroll down", "SCROLL");
route("click the sign up button", "CLICK");
route("search for mango recipes", "SEARCH");

// "explain this site" matches the explain rule, whose runner must hand the
// page — not the literal words — to the pipeline. The runner lives in
// explainPhrase, so assert the redirect exists rather than re-testing regexes.
check(
  "explainPhrase redirects page deixis to pageOverview",
  /explainPhrase[\s\S]{0,700}?(?:site|page|website)[\s\S]{0,300}?pageOverview\(/.test(src),
);

// The agent loop can answer page-level questions for phrasings the grammar
// never anticipated.
check("the model verb table includes pageOverview", /pageOverview:\s*\(\)\s*=>/.test(src));

if (failures) {
  console.error(`\n${failures} routing failure(s)`);
  process.exit(1);
}
console.log("\nvoice-grammar OK");
