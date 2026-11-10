// The tab-strip verbs, and the line between them and the page. Run with:
//   npm run test:tabs
//
// The reason this file exists is a specific collision. A web page can contain
// something called a tab — "Billing tab", "Settings tab" — and the extension
// now has verbs that act on the browser's tab strip. Both are reached by
// sentences that start with the same three words. Get the boundary wrong in
// either direction and the failure is loud: "switch to the settings tab"
// closes a browser tab, or "close the github tabs" hunts for a button.
//
// The rule the code holds, asserted below:
//   singular + a name        -> the page      (click, jump, search)
//   plural, or a property    -> the tab strip (tabs... verbs)
//   only the browser knows
//
// Same extraction trick as run-tests.mjs: the grammar is read out of the
// source as regex literals, so these assertions can never drift from the code.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const commands = readFileSync(join(root, "commands.js"), "utf8");
const background = readFileSync(join(root, "background.js"), "utf8");

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    failures++;
    if (detail) console.error(`      ${detail}`);
  }
}

// ---------------------------------------------------------------- extraction

// Each rule keeps a slice of its run-body, so a probe can assert WHICH handler
// wins rather than a rule index that shifts on every insertion.
const rules = [];
// The body is captured through a LOOKAHEAD so it isn't consumed — consuming
// 160 characters of run-body walks the scanner straight past the next rule,
// which silently drops a third of the grammar from the probe set.
const ruleRe = /\{ re: (\/(?:[^/\\\n]|\\.)+\/[a-z]*),\s*\n?\s*run:(?=([\s\S]{0,160}))/g;
let m;
while ((m = ruleRe.exec(commands))) {
  try {
    rules.push({ re: eval(m[1]), body: m[2] });
  } catch {
    /* a rule that isn't a bare literal simply isn't probed */
  }
}
check(rules.length > 70, "the grammar extracted", `${rules.length} rules`);

function winner(sentence) {
  return rules.find((r) => r.re.test(sentence)) || null;
}

// want: a substring that must appear in the winning rule's run-body.
function routes(sentence, want, label) {
  const won = winner(sentence);
  const ok = won != null && won.body.includes(want);
  check(ok, label || `"${sentence}" -> ${want}`, won ? `won: ${won.body.replace(/\s+/g, " ").slice(0, 80)}` : "no rule matched");
}

function reachesModel(sentence) {
  check(winner(sentence) === null, `"${sentence}" is left to the model`);
}

// ------------------------------------------------- the strip, not the page

// A relative clause after "tab" is something no page control ever has.
routes("find the tab where i was reading about mcp", 'tabsCommand(\n        "find"');
routes("show me the tab playing music", 'tabsCommand(\n        "find"');
routes("go to the tab with my email", 'tabsCommand(\n        "find"');

// Plural is the safeguard: "the github tabs" cannot be one control.
routes("close the github tabs", "tabsClose(");
routes("close all my youtube tabs", "tabsClose(");
routes("group my ai tabs", 'tabsCommand("group"');
routes("move the github tabs to a new window", 'tabsCommand("toWindow"');

// Properties only the browser can see.
routes("close the tabs i haven't looked at today", "tabsClose(");
routes("close the tabs i haven't used in a while", "tabsClose(");
routes("close old tabs", "tabsClose(");
routes("mute the tab that's playing audio", 'tabsCommand("mute"');
routes("which tab is playing audio", 'tabsCommand("find"');
routes("reopen my last five closed tabs", 'tabsCommand("reopen"');
routes("tidy up my tabs", 'tabsCommand("autoGroup"');
routes("organize my tabs", 'tabsCommand("autoGroup"');
routes("how many tabs do i have", 'tabsCommand("list"');
routes("what tab is using the most memory", 'tabsCommand("list"');

// ------------------------------------------------- the page, not the strip

// These are the collisions. Every one of them must stay with the page.
routes("click the billing tab", "clickByDescription", '"click the billing tab" stays a click');
routes("click the settings tab", "clickByDescription");
routes("go to the pricing tab", "goToDestination", '"go to the X tab" is a jump on the page');
routes("take me to the reviews tab", "goToDestination");
routes("find the settings tab", "goToDestination", 'singular "find the X tab" searches the page');
routes("show me the pricing tab", "goToDestination");

// The single-tab verbs are untouched by all of this.
routes("close this tab", 'tabCommand("close"');
routes("new tab", 'tabCommand("new"');
routes("next tab", 'tabCommand("next"');
routes("pin this tab", 'tabCommand("pin"');

// The one deliberately-ambiguous phrasing. It resolves to the tab strip, but
// only because it sits below every page rule and none of them claimed it.
routes("switch to the github tab", 'tabsCommand("find"');
check(
  commands.indexOf('/^(?:switch|swap|jump|go over) to') >
    commands.indexOf("goToDestination(m[1])"),
  "the ambiguous 'switch to the X tab' rule sits below the page jump rule",
);

// ------------------------------------------------------------ safety rails

check(
  /doomed = tabs\.filter\(\(t\) => !t\.pinned && !t\.active\)/.test(background),
  "a bulk close never touches a pinned tab or the tab you're on",
);
check(
  /jcTabsLastClosed = doomed\.map/.test(background) &&
    /function tabsRestoreLastClosed/.test(background),
  "a bulk close is remembered so undo can put the set back",
);
check(
  /pushUndo\("closing those tabs"/.test(commands),
  "closing a set arms undo in the content script",
);
check(
  !/JC_VOICE_TABS[\s\S]{0,4000}msg\.tabId/.test(background),
  "the tab-strip handler never accepts a tab id from the page",
);
check(
  /function tabIsOrdinary[\s\S]{0,200}https\?:/.test(background),
  "only http(s) tabs are ever selected",
);
check(
  /staleHours: Math\.min\(/.test(background) && /String\(filter\.query \|\| ''\)\.slice/.test(background),
  "every filter field the page can send is clamped",
);

// The model-facing side of the same boundary.
check(
  /TABS ON THE PAGE ARE NOT BROWSER TABS/.test(background),
  "the agent prompt tells the model which kind of tab is which",
);
for (const verb of [
  "tabsFind", "tabsClose", "tabsCloseStale", "tabsGroup", "tabsTidy",
  "tabsMuteAudible", "tabsToWindow", "tabsReopen", "tabsList",
]) {
  check(new RegExp(`\\n    ${verb}:`).test(commands), `${verb} is in the verb table`);
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\ntab-strip OK");
