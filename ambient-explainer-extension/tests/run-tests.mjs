// Voice grammar + fuzzy-matching tests. Run with:  npm run test:voice
//
// These exist because the grammar is ORDER-SENSITIVE — several real bugs
// ("go to the top" swallowed by semantic jump, filler commas defeating the
// stripper, define capturing its argument and ignoring it) were caught by
// exactly these assertions while they lived in throwaway shell commands.
// Checked in, they catch the same class of bug every time a rule is added.
//
// The functions under test live inside content-script IIFEs that need a DOM,
// so they can't be imported. Instead the test EXTRACTS them from the source
// text: the rule regexes (with a snippet of each rule's run-body, so routing
// asserts "which function handles this" rather than a brittle rule index),
// plus `normalize`, `editDistance` and `closeEnough`, which are dependency-free
// and eval cleanly. Extraction means the tests can never drift from the code.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const commands = readFileSync(join(root, "commands.js"), "utf8");
const background = readFileSync(join(root, "background.js"), "utf8");

let failures = 0;
function check(ok, label, detail = "") {
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------- extraction

// Grab a top-level `function name(...) {...}` by brace matching. Only works for
// dependency-free functions — which is exactly the set extracted here.
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  let depth = 0;
  let i = source.indexOf("{", start);
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) break;
  }
  return source.slice(start, i + 1);
}

// Same idea for a top-level `const NAME = ...;` — scan to the semicolon that
// sits outside every bracket, so an object or a `new Set([...])` comes back
// whole.
//
// String-aware, and it has to be: the voice prompts are runs of concatenated
// literals full of `{"verb":"done"}` and mid-sentence semicolons, every one of
// which ends the scan early if quotes aren't skipped.
function extractConst(source, name) {
  const start = source.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`const ${name} not found`);

  let depth = 0;
  let quote = "";
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === ";" && depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`const ${name} unterminated`);
}

// ESM runs strict, so a bare eval of a declaration doesn't create a module
// binding — each function is evaluated as an expression instead. closeEnough
// references editDistance by name; direct eval shares this scope, so the
// module-level const satisfies it.
const asExpr = (src, name) => eval(`(${src.replace(`function ${name}`, "function")})`);
const normalize = asExpr(extractFunction(commands, "normalize"), "normalize");
const editDistance = asExpr(extractFunction(background, "editDistance"), "editDistance");
const closeEnough = asExpr(extractFunction(background, "closeEnough"), "closeEnough");

// Each rule: its regex plus the first ~160 chars of its run body, so a phrase
// can be asserted against the FUNCTION it routes to. Rule indices shift every
// time a rule is inserted; function names don't.
const rules = [...commands.matchAll(/\{ re: (\/(?:\\.|\[[^\]]*\]|[^\/\\])+\/),/g)].map((m) => ({
  re: eval(m[1]),
  snippet: commands.slice(m.index, m.index + m[0].length + 450),
}));
check(rules.length >= 40, `grammar extracted (${rules.length} rules)`);

function route(phrase) {
  const p = normalize(phrase);
  const i = rules.findIndex((r) => r.re.test(p));
  if (i < 0) return { handler: null, capture: null };
  const match = p.match(rules[i].re);
  return { handler: rules[i].snippet, capture: match && match[1] ? match[1] : null };
}

// ------------------------------------------------------------------- routing

// phrase → substring the handling rule's source must contain (null = no rule
// may match; the phrase falls through to the model tier).
const ROUTING = [
  ["scroll down", "scrollByPage"],
  ["Um, okay, scroll down.", "scrollByPage"],
  ["keep scrolling", "autoScrollStart"],
  ["keep going", "autoScrollStart"],
  ["wait here", "waitHere"],
  ["faster", "autoScrollRate"],
  ["slower", "autoScrollRate"],
  ["back to where i was", "backToMark"],
  ["a bit more", "scrollByAmount"],
  ["go to the top", "scrollToEdge"],
  ["all the way down", "scrollToEdge"],
  ["scroll to the end", "scrollToEdge"],
  ["go to the about us page", "goToDestination"],
  ["open google", "goToDestination"],
  ["take me to the pricing section", "goToDestination"],
  ["homepage", "goHome"],
  ["search this site for the sdk", "searchSiteAndExplain"],
  ["search this page for the sdk", "searchSiteAndExplain"],
  ["where do they talk about the sdk", "goToDestination"], // on-page first; falls back to site search inside
  // Searching means searching WHERE THE USER IS. Only a phrase that names the
  // web is allowed to leave the page — this pair is the whole rule, and it is
  // the one that regressed into "everything goes to Google".
  ["search for react hooks", "searchHere"],
  ["look up react hooks", "searchHere"],
  ["google react hooks", "webSearch"],
  ["search the web for react hooks", "webSearch"],
  ["web search for react hooks", "webSearch"],
  ["look up react hooks on the web", "webSearch"],
  ["type hello world", "typeText"],
  ["submit", "submitField"],
  ["press enter", "submitField"],
  ["follow this person", "clickByDescription"],
  ["click sign up", "clickByDescription"],
  ["add to cart", "clickByDescription"],
  ["explain this", "runOnTarget"],
  ["what does that mean", "runOnTarget"],
  ["is that true", "factcheck"],
  ["what does he mean by front end engineer at yolat", "explainPhrase"],
  ["define quantum entanglement", "runOnText"],
  ["read this to me", "speak"],
  ["new tab", "tabCommand"],
  ["undo", "jcVoiceUndo"],
  ["stop", "jcVoiceStopSpeaking"],
  ["buy me a sandwich", null],
];

for (const [phrase, expected] of ROUTING) {
  const { handler } = route(phrase);
  if (expected === null) {
    check(handler === null, `"${phrase}" falls through to the model`);
  } else {
    check(
      handler !== null && handler.includes(expected),
      `"${phrase}" → ${expected}`,
      handler ? "routed elsewhere" : "no rule matched",
    );
  }
}

// ------------------------------------------------------------------ captures

const CAPTURES = [
  ["go to the about us page", "about us page"],
  ["take me to the pricing section", "pricing section"],
  ["what does he mean by front end engineer at yolat", "front end engineer at yolat"],
  ["define quantum entanglement", "quantum entanglement"],
  ["type hello world", "hello world"],
  ["search for react hooks", "react hooks"],
  ["google react hooks", "react hooks"],
  ["search the web for react hooks", "react hooks"],
  ["look up react hooks on the web", "react hooks"],
];
for (const [phrase, expected] of CAPTURES) {
  const { capture } = route(phrase);
  check(capture === expected, `"${phrase}" captures "${expected}"`, `got "${capture}"`);
}

// ---------------------------------------------------- fuzzy site correction

// closeEnough(actualHost, heardName): misheard brand names must correct, and
// different-but-real names must NOT — "notion" opening motion.com is worse
// than no correction at all.
const FUZZY = [
  ["vercel", "vercell", true],
  ["vercel", "verscel", true],
  ["google", "googel", true], // transposition must count as one edit
  ["youtube", "yotube", true],
  ["stackoverflow", "stackoverflo", true],
  ["motion", "notion", false], // first letter differs — different company
  ["gitlab", "github", false],
  ["cloud", "clawd", false],
];
for (const [host, heard, expected] of FUZZY) {
  check(closeEnough(host, heard) === expected, `closeEnough("${host}", "${heard}") === ${expected}`);
}

// ------------------------------------------------------ spoken addresses

// resolveSite carries its tables with it, so the whole unit is rebuilt here
// rather than stubbed — a test against a hand-written KNOWN_SITES would pass
// forever while the real one drifted.
const resolveSite = eval(`(() => {
  ${extractConst(commands, "KNOWN_SITES")}
  ${extractConst(commands, "KNOWN_TLDS")}
  ${extractConst(commands, "COM_MISHEARINGS")}
  ${extractFunction(commands, "spokenDomain")}
  ${extractFunction(commands, "suffixOf")}
  ${extractFunction(commands, "resolveSite")}
  return resolveSite;
})()`);

const hostOf = (site) => (site ? site.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : null);

// [spoken, host it must open, may it go without asking]
const SITES = [
  ["google", "www.google.com", true],
  ["vercel", "vercel.com", true],
  ["vercel.com", "vercel.com", true],
  ["vercel dot com", "vercel.com", true], // speech spells the dot out as a word
  ["apple dot com", "www.apple.com", true],
  // The whole point: a brand we know, wearing a suffix that sounds like ".com"
  // with the last consonant clipped off. Colombia is not what they said.
  ["apple.co", "www.apple.com", true],
  ["apple dot co", "www.apple.com", true],
  ["vercel.con", "vercel.com", true],
  // ...but a real country domain on a known brand is a real address, and
  // "correcting" it to .com would be the same bug pointing the other way.
  ["google.de", "google.de", true],
  ["amazon.co.uk", "amazon.co.uk", true],
  // Brands we have never heard of are still addresses when they name a suffix.
  ["news.ycombinator.com", "news.ycombinator.com", true],
  ["bit.ly", "bit.ly", true],
];
for (const [spoken, host, sure] of SITES) {
  const site = resolveSite(spoken);
  check(hostOf(site) === host, `"${spoken}" → ${host}`, `got ${hostOf(site)}`);
  check(site && site.sure === sure, `"${spoken}" ${sure ? "opens" : "asks"} without asking`);
}

check(resolveSite("apple.co").corrected === "apple.co", "a corrected address remembers what was heard");
check(!resolveSite("google.de").corrected, "an uncorrected address claims no correction");

// The .com reflex. A bare word may still END UP at <word>.com, but only after
// history has been asked and only behind a confirmation — so it must never
// come back as a certainty, and a phrase must not become a domain at all.
check(resolveSite("yolat").bare === true, "a bare word is flagged as a guess");
check(resolveSite("yolat").sure === false, "a bare word is never sure");
check(resolveSite("onboarding").bare === true, "a plain English word is a guess too");
check(resolveSite("the pricing section") === null, "a phrase is not a domain");
check(resolveSite("what they charge for the api") === null, "nor is a question");

// And the callers have to honour the flag: a search that found nothing asks
// history, never the .com suffix.
check(
  /allowGuess:\s*false/.test(commands),
  "a failed page search looks up history without guessing a domain",
);
const searchSiteSrc = extractFunction(commands, "searchSite");
check(
  /site\.bare/.test(searchSiteSrc),
  "searchSite refuses to offer a bare .com guess on a miss",
);

// ------------------------------------------------------------------- safety

// The destructive-click gate and its coverage of both click paths. Source-level
// assertions: cheap, and they fail the moment someone reroutes a click around
// the confirmation.
// Tier one — money, deletion, session loss. Confirmed unconditionally.
check(/DESTRUCTIVE_LABEL\s*=/.test(commands), "destructive-label gate exists");
const destructive = commands.match(/DESTRUCTIVE_LABEL\s*=\s*\/(.+)\//);
for (const word of ["buy", "checkout", "delete", "pay", "transfer", "sign out"]) {
  check(destructive && destructive[1].includes(word), `always-confirm gate covers "${word}"`);
}

// Tier two — hard to undo, but also the label on every search box and chat
// composer. Confirmed only when the phrase was NOT clearly heard, so saying
// "click send" outright just works while a fuzzy match still asks first.
check(/SENSITIVE_LABEL\s*=/.test(commands), "sensitive-label gate exists");
const sensitive = commands.match(/SENSITIVE_LABEL\s*=\s*\/(.+)\//);
for (const word of ["send", "submit", "post", "publish", "confirm"]) {
  check(sensitive && sensitive[1].includes(word), `uncertain-only gate covers "${word}"`);
}

const performClickSrc = extractFunction(commands, "performClick");
check(
  /DESTRUCTIVE_LABEL\.test\([^)]*\)\s*\|\|/.test(performClickSrc),
  "performClick confirms every destructive label regardless of certainty",
);
check(
  /SENSITIVE_LABEL\.test\([^)]*\)\s*&&\s*sure\s*<\s*CLICK_SURE/.test(performClickSrc),
  "performClick confirms sensitive labels whenever the match was doubtful",
);

const clickByDescriptionSrc = extractFunction(commands, "clickByDescription");
const clickRefSrc = extractFunction(commands, "clickRef");
check(clickByDescriptionSrc.includes("performClick"), "clickByDescription goes through performClick");
check(clickRefSrc.includes("performClick"), "clickRef goes through performClick");
check(!/\bel\.click\(\)/.test(clickRefSrc), "clickRef has no direct .click()");
// A model-picked ref never heard the user, so it must never claim certainty —
// passing a score there would let the model click Send with no confirmation.
check(
  !/performClick\([^)]*,\s*(?!0\b)[^)]+\)/.test(clickRefSrc),
  "clickRef claims no certainty for a model-chosen element",
);

// Every click must go through the full pointer sequence: a bare .click() is
// invisible to Radix, Headless UI, MUI and anything else that opens on press.
const pressSrc = extractFunction(commands, "pressElement");
for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
  check(pressSrc.includes(type), `pressElement dispatches ${type}`);
}
check(pressSrc.includes("composed: true"), "pressElement events cross shadow boundaries");
check(
  extractFunction(commands, "performClick").includes("pressElement"),
  "performClick presses rather than bare-clicking",
);

// Nothing that waits on the worker may wait forever — that is the whole
// "it just keeps loading" class of bug.
const voiceSrc = readFileSync(join(root, "voice.js"), "utf8");
check(/function withTimeout\(/.test(voiceSrc), "voice.js has a timeout helper");
for (const call of ["JC_VOICE_STEP", "JC_VOICE_TRANSCRIBE", "JC_VOICE_MIC_STOP"]) {
  const idx = voiceSrc.indexOf(call);
  check(
    idx > 0 && voiceSrc.lastIndexOf("withTimeout", idx) > voiceSrc.lastIndexOf("async function", idx),
    `${call} is wrapped in withTimeout`,
  );
}
check(
  /pendingTimer\s*=\s*setTimeout/.test(commands),
  "an unanswered confirmation expires instead of pulsing forever",
);

// --------------------------------------------------- the live transcript

// Both microphone lanes have to show words as they are spoken. The page lane
// always did, from Web Speech in the content script; the extension lane showed
// "Listening…" and then nothing until release, which reads as a freeze. These
// assert the echo exists on BOTH, because the failure mode is invisible in
// tests that only check that voice still works.
const offscreen = readFileSync(join(root, "offscreen.js"), "utf8");

check(/showChip\("hearing"/.test(voiceSrc), "the page lane echoes what it hears");
check(
  /interimResults\s*=\s*true/.test(offscreen),
  "the extension lane runs a recogniser for the echo",
);
check(
  /JC_VOICE_PARTIAL/.test(offscreen) && /JC_VOICE_PARTIAL/.test(background),
  "interim words are emitted and relayed",
);

// The recording is what this lane is FOR. A recogniser that throws on the way
// up must not take the recording with it, so it starts after the recorder.
const micStartSrc = extractFunction(offscreen, "micStart");
check(
  micStartSrc.indexOf("micRecorder.start()") < micStartSrc.indexOf("micSpeechStart()"),
  "the echo starts after the recorder, never before it",
);
check(
  /micSpeechStop\(\)/.test(extractFunction(offscreen, "micRelease")),
  "every teardown path releases the recogniser too",
);

// What a microphone is hearing goes to the tab that opened it and nowhere else.
check(
  /chrome\.tabs\s*\n?\s*\.sendMessage\(\s*tabId/.test(background),
  "the echo is addressed to one tab, not broadcast",
);
check(
  /jcVoiceMicTab = null/.test(background),
  "the route is cleared when the hold ends",
);

// The page lane's own interim text must not be overwritten by a slower relay
// that has been through two message hops.
check(
  /lane !== "extension"/.test(voiceSrc),
  "the relayed echo is confined to the lane that needs it",
);

// ------------------------------------------------------- the agent loop

// Acting over several steps is the one place a voice command can run away
// with itself, so every bound on it is asserted here rather than trusted.
const runAgentSrc = extractFunction(voiceSrc, "runAgent");

check(/AGENT_MAX_STEPS\s*=\s*\d+/.test(voiceSrc), "the loop has a step ceiling");
check(
  /while\s*\(\s*state\.steps\s*<\s*AGENT_MAX_STEPS\s*\)/.test(runAgentSrc),
  "the ceiling is the loop condition, not a suggestion to the model",
);
check(
  /state\.steps\s*\+=\s*1/.test(runAgentSrc),
  "every step counts against the ceiling, including the ones that fail",
);

// The model asks for another step; the loop decides whether it gets one. A
// run that continued on the model's say-so alone would have no bound at all
// on the calls it could spend.
check(
  /if\s*\(\s*!step\.more\s*\)/.test(runAgentSrc),
  "a step that isn't marked as needing a follow-up ends the run",
);

// A click is a link as often as it is a button. Whatever survives the
// navigation has to be written BEFORE the click, or it is never written.
//
// Matched on the call NAME, not on its arguments. This assertion used to look
// for the literal "jcVoiceRunIntent(step" and went red the day a step grew the
// ability to carry a batch and the call became jcVoiceRunIntent(action, …).
// The ordering it guards was still correct; only the spelling had moved. A test
// that fails when correct code is refactored teaches people to ignore it.
const saveAt = runAgentSrc.indexOf("saveAgent(state)");
const actAt = runAgentSrc.indexOf("jcVoiceRunIntent(");
check(
  saveAt !== -1 && actAt !== -1 && saveAt < actAt,
  "the resume record is saved before the step that might navigate away",
);
check(
  /Date\.now\(\)\s*-\s*\(state\.at\s*\|\|\s*0\)\s*>\s*AGENT_TTL_MS/.test(
    extractFunction(voiceSrc, "loadAgent"),
  ),
  "an abandoned run expires instead of waking up on a later page",
);
check(
  /result\.quiet/.test(runAgentSrc),
  "a step that put a question on screen stops the loop rather than talking over it",
);

// parseStep is the allowlist boundary. "done" is the loop's own terminator and
// must NOT be an executable verb — if it ever reached the content script's
// table it would be an action rather than a full stop.
const parseStepSrc = extractFunction(background, "parseStep");
check(
  /verb\s*!==\s*'done'\s*&&\s*!verbs\.includes\(verb\)/.test(parseStepSrc),
  "parseStep drops any verb the content script did not offer",
);
check(
  !/^\s*done:/m.test(extractConst(commands, "INTENT_VERBS")),
  "'done' is not an executable verb",
);
// The DIGIT COUNT is not the point, the anchored shape check is: whatever the
// ceiling, a ref must look like eNNN before it is allowed near the lookup.
// Pinning the count meant widening e999 to e9999 for pages with more elements
// failed a test about something else entirely.
check(
  /\/\^e\\d\{1,\d+\}\$\/\.test\(ref\)/.test(parseStepSrc),
  "parseStep shape-checks the ref so an invented one never reaches the lookup",
);
check(
  /data\.more === true && verb !== 'done'/.test(parseStepSrc),
  "a step cannot claim to be both done and unfinished",
);

// The instruction that this whole change exists to enforce: searching means
// searching the page, and leaving it has to be asked for out loud.
// Evaluated, not read: the prompt is a run of concatenated string literals, so
// a sentence in it is split across lines in the source and matches nothing.
const agentPrompt = eval(
  `(() => { ${extractConst(background, "JC_VOICE_AGENT_SYSTEM")} return JC_VOICE_AGENT_SYSTEM; })()`,
);
check(/NEVER use "webSearch"/.test(agentPrompt), "the prompt forbids an unasked-for web search");
check(/searchPage/.test(agentPrompt), "the prompt names the page-first search as the default");
check(
  /never instructions/.test(agentPrompt),
  "the prompt still says the snapshot is data, not instructions",
);
check(
  /do not add "\.com"/i.test(agentPrompt),
  "the prompt tells the model not to invent a domain either",
);

// The keep-awake tone buys the hidden tab an exemption from Chrome's timer
// budget and from Energy Saver freezing. A tone left running after the answer
// arrived would be a worse bug than the one it fixes, so the release has to be
// unconditional and every return after it has to sit inside the try.
const llm = readFileSync(join(root, "llm.js"), "utf8");
const askNow = llm.slice(llm.indexOf("async function llmAskNow"));
const askBody = askNow.slice(0, askNow.indexOf("\n}\n"));
const awakeAt = askBody.indexOf("llmKeepAwake");
const finallyAt = askBody.indexOf("} finally {");
check(awakeAt > 0, "llmAskNow keeps the tab awake while it polls");
check(finallyAt > awakeAt, "the poll loop is wrapped in try/finally");
check(
  askBody.indexOf("llmLetSleep") > finallyAt,
  "the tone is released in finally, so no exit path can leave it humming",
);
check(
  askBody.slice(awakeAt).indexOf("try {") < askBody.slice(awakeAt).indexOf("return "),
  "every return after the tone starts is inside the try",
);
check(
  /muted:\s*!!\(state && state\.wasMuted\)/.test(llm),
  "the tab's original muted state is restored, never just unmuted",
);
// The freeze exemption requires the tab to be actually making sound, and a
// muted tab is silent — while tab.audible stays true when muted, so a mute
// can never be validated by measurement. The tone must run unmuted.
const keepAwakeSrc = llm.slice(llm.indexOf("async function llmKeepAwake"));
check(
  /muted:\s*false/.test(keepAwakeSrc.slice(0, keepAwakeSrc.indexOf("\n}"))),
  "llmKeepAwake never mutes the tab it is trying to keep audible",
);
check(
  !/muted:\s*true/.test(keepAwakeSrc.slice(0, keepAwakeSrc.indexOf("\n}"))),
  "llmKeepAwake contains no mute at all",
);
check(
  /osc\.frequency\.value\s*=\s*19000/.test(llm),
  "the tone is near-ultrasonic rather than something audible",
);

// THE RECURRING BUG, guarded three ways. "The composer is empty" has now twice
// been mistaken for "the message sent" — first on a freshly loaded page whose
// composer had not been filled yet, then on a page where ProseMirror silently
// reconciled our text back out. An empty box is only proof of sending if we
// watched the text sit in that box first.
const seenAt = askBody.indexOf("textSeen = true");
const emptyTrustAt = askBody.indexOf("evidence.emptyComposer) { sendConfirmed");
check(seenAt > 0, "the typed path confirms the text actually landed and stayed");
check(
  emptyTrustAt > seenAt,
  "an empty composer is only trusted AFTER the text was observed in it",
);
check(
  /if \(!textSeen && !sendConfirmed\)/.test(askBody),
  "text that never held in the composer is reported, not silently polled",
);
// The URL path has no composer evidence at all, so it may only ever trust a
// page that is visibly answering.
const urlPath = askBody.slice(0, askBody.indexOf("TYPED PATH"));
check(
  !/emptyComposer/.test(urlPath),
  "the URL fast path never treats an empty composer as proof of anything",
);

// The false privacy claim must never come back.
const popup = readFileSync(join(root, "popup.js"), "utf8");
check(!popup.includes("nothing you say is sent anywhere"), "popup.js makes no absolute speech-privacy claim");

// ------------------------------------------------------------------- result

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log(`all voice tests passed (${ROUTING.length} routing, ${CAPTURES.length} capture, ${FUZZY.length} fuzzy, safety gates)`);
