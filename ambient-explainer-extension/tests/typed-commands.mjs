// Typed commands: correction, and the suggestions that make the grammar
// visible. Run with:  npm run test:typed
//
// WHAT THIS PROTECTS:
//
//  1. THE TYPIST'S GATE. background.js's closeEnough refuses any candidate
//     whose first letter changed, and says why: speech mangles vowels and
//     endings, not leading consonants. Typing does the opposite. "hwere",
//     "teh", "ant" are all one edit from the word meant and all rejected by
//     that rule, so the typed lane needs its own gate. If someone ever
//     "simplifies" the two into one, these fail.
//  2. THE CLOSED VOCABULARY. Corrections may only produce words the grammar
//     already knows. A general dictionary would offer three plausible words for
//     "reserch" and force a guess that then EXECUTES.
//  3. ARGUMENTS ARE NEVER CORRECTED. Everything after "about"/"for"/"on" is the
//     reader's own subject, matched later against real tab titles. Correcting
//     it silently changes which tabs are chosen.
//  4. NO AMBIGUOUS CORRECTION. Two candidates at the same distance means we do
//     not know what was meant. Running a coin flip is the worst outcome here.
//  5. WHAT IS SUGGESTED IS WHAT RUNS. A suggestion is offered only because the
//     corrected sentence genuinely matched that rule, never because it
//     resembled it.

import fs from "node:fs";
import vm from "node:vm";

const dir = new URL("../", import.meta.url);
const fuzzy = fs.readFileSync(new URL("fuzzy.js", dir), "utf8");
const commands = fs.readFileSync(new URL("commands.js", dir), "utf8");
const background = fs.readFileSync(new URL("background.js", dir), "utf8");
const content = fs.readFileSync(new URL("content.js", dir), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", dir), "utf8"));

let failures = 0;
const check = (label, cond, detail) => {
  if (!cond) {
    failures++;
    console.log(`FAIL  ${label}${detail ? `  <-- ${detail}` : ""}`);
  } else console.log(`PASS  ${label}`);
};

const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  `${fuzzy}\n;Object.assign(globalThis, {
     jcEditDistance, jcTypoNear, jcIsSwap, jcBuildVocabulary, jcBestWord,
     jcCorrectPhrase, jcCanonicalPhrase, JC_ARGUMENT_GATES,
   });`,
  ctx,
);

// The real grammar, pulled out of commands.js as regex literals — the same
// extraction voice-grammar.mjs uses.
const rules = [];
const ruleRe = /\{ re: (\/(?:[^/\\\n]|\\.)+\/[a-z]*),\s*\n?\s*run:/g;
let m;
while ((m = ruleRe.exec(commands))) {
  try {
    rules.push(eval(m[1]));
  } catch {}
}
check("the real grammar was extracted", rules.length > 100, `${rules.length} rules`);

const vocab = ctx.jcBuildVocabulary(rules.map((r) => r.source));
const correct = (p) => ctx.jcCorrectPhrase(p, vocab);
const firstMatch = (p) => rules.find((r) => r.test(p)) || null;

// ---- 1. the typist's gate, and why it is not the spoken one -------------

check("a transposition costs one edit, not two", ctx.jcEditDistance("teh", "the") === 1);
check("'googel' is one edit from 'google'", ctx.jcEditDistance("googel", "google") === 1);

// The exact cases background.js's first-letter rule throws away.
for (const [typed, meant] of [["hwere", "where"], ["teh", "the"], ["taht", "that"]]) {
  check(
    `a first-letter slip is accepted: "${typed}" -> "${meant}"`,
    ctx.jcTypoNear(typed, meant),
  );
}
check(
  "background.js's spoken gate still refuses those, which is why this one exists",
  /if \(a\[0\] !== b\[0\]\) return false;/.test(background),
);

// Short words are held tight: at three letters one edit is a different word.
check("'tap' is NOT corrected to 'tab'", !ctx.jcTypoNear("tap", "tab"));
check("'tag' is NOT corrected to 'tab'", !ctx.jcTypoNear("tag", "tab"));
check("but a pure swap at three letters is safe", ctx.jcTypoNear("teh", "the"));

// ---- 2. the vocabulary is closed and comes from the grammar -------------

check("the vocabulary was harvested from the rules", vocab.size > 80, `${vocab.size} words`);
for (const word of ["research", "tabs", "close", "mute", "scroll", "reopen", "group"]) {
  check(`the grammar taught it "${word}"`, vocab.has(word));
}
check(
  "regex syntax did not leak in as vocabulary",
  !["?:", "\\s", "\\d", "all)"].some((junk) => vocab.has(junk)),
  [...vocab].filter((w) => /[^a-z]/.test(w)).join(",") || "clean",
);

// ---- 3. real typos become real commands --------------------------------

const TYPOS = [
  ["reserch these tabs", "research these tabs"],
  ["reserch these tabz", "research these tabs"],
  ["compair these tabs", "compare these tabs"],
  ["cloze my github tabs", "close my github tabs"],
  ["scrol down", "scroll down"],
  ["tidyy up my tabs", "tidy up my tabs"],
];
for (const [typed, want] of TYPOS) {
  const got = correct(typed).text;
  check(`"${typed}" corrects to "${want}"`, got === want, got);
  check(`"${typed}" then matches a real rule`, !!firstMatch(got), got);
}

// A sentence already correct must come out untouched.
for (const clean of ["research these tabs", "scroll down", "close my github tabs"]) {
  const got = correct(clean);
  check(`"${clean}" is left alone`, got.text === clean && !got.changed.length, got.text);
}

// ---- 4. arguments are the reader's own words ---------------------------

{
  const got = correct("research my tabs about klimate polisy");
  check(
    "the command skeleton is corrected and the subject is not",
    got.text === "research my tabs about klimate polisy",
    got.text,
  );
  check("and it still matches the subject rule", !!firstMatch(got.text));
}
{
  const got = correct("reserch my tabs about teh election");
  check(
    "a typo INSIDE the subject survives, because it may be the real title",
    got.text === "research my tabs about teh election",
    got.text,
  );
}
{
  const got = correct("serch for mango recipies");
  check(
    "a search term is never rewritten",
    got.text.endsWith("mango recipies"),
    got.text,
  );
}

// ---- 5. an ambiguous correction is refused -----------------------------

{
  // "joing" is one edit from "join", "going" AND "doing". Equally close, so we
  // do not actually know which was meant, and a coin flip that then EXECUTES is
  // the worst outcome this design can produce.
  const oneAway = [...vocab].filter((w) => ctx.jcEditDistance("joing", w) === 1);
  check("the fixture really is ambiguous", oneAway.length >= 2, oneAway.join(","));
  check("an ambiguous word is left exactly as typed", ctx.jcBestWord("joing", vocab) === null);
  check(
    "so an ambiguous sentence matches nothing rather than running a guess",
    correct("joing these tabs").text === "joing these tabs",
    correct("joing these tabs").text,
  );

  // The other half of the same rule: two edits is FINE when there is only one
  // candidate in the whole vocabulary, because there is no wrong answer
  // available to pick. A blanket "allow two edits" would have taken this and
  // mangled "joing" too.
  const near = [...vocab].filter((w) => ctx.jcEditDistance("compair", w) <= 2);
  check("the fixture really is unambiguous", near.length === 1, near.join(","));
  check("a lone two-edit candidate IS taken", ctx.jcBestWord("compair", vocab) === "compare");
}

// ---- 6. the grammar becomes readable -----------------------------------

const canon = (re) => ctx.jcCanonicalPhrase(re.source);
check(
  "a rule turns back into the shortest sentence that matches it",
  canon(/^(?:research|join|combine) (?:my |the |these )?tabs$/) === "research tabs",
  canon(/^(?:research|join|combine) (?:my |the |these )?tabs$/),
);
check(
  "character classes take their first branch",
  canon(/^summari[sz]e these tabs$/) === "summarise these tabs",
  canon(/^summari[sz]e these tabs$/),
);
{
  // Every canonical phrase must be RUNNABLE: the sentence the list shows has to
  // match the rule it came from, or the list is advertising something that does
  // nothing when typed.
  let broken = [];
  for (const r of rules) {
    const label = canon(r);
    if (!label || /[()[\]|\\?*+^$]/.test(label)) continue; // not advertised
    if (!r.test(label)) broken.push(`${label}  !~  ${r.source.slice(0, 40)}`);
  }
  check(
    "every advertised phrase actually matches its own rule",
    broken.length === 0,
    broken.slice(0, 3).join(" | "),
  );
}

// ---- 7. the wiring -----------------------------------------------------

check(
  "fuzzy.js loads before commands.js in the manifest",
  (() => {
    const js = manifest.content_scripts[0].js;
    return js.indexOf("fuzzy.js") >= 0 && js.indexOf("fuzzy.js") < js.indexOf("commands.js");
  })(),
  manifest.content_scripts[0].js.join(","),
);
check("double-tap Shift is armed", /const DOUBLE_SHIFT_ENABLED = true;/.test(content));
check(
  "a Shift keyup that ended a spoken hold still cannot open the box",
  /jcVoiceHoldActive\(\)\) \{\s*\n\s*lastShiftUp = 0;/.test(content),
);
check("the suggestion engine is exported to the page scope", /jcVoiceSuggest,/.test(commands));
check(
  "submitting runs the CORRECTED phrase, not the raw one",
  /const command = jcVoiceExecute\(phrase\);/.test(content),
);
check(
  "a completion is typed into the input, never fired",
  /input\.value = item\.label;/.test(content) &&
    !/jcVoiceRunPhrase\(item\.label\)/.test(content),
);
check(
  "clicking a completion refuses a scripted click",
  /row\.addEventListener\("click", \(e\) => \{\s*\n\s*if \(!e\.isTrusted\) return;/.test(content),
);

console.log(failures ? `\n${failures} failing` : "\nall good");
process.exit(failures ? 1 : 0);
