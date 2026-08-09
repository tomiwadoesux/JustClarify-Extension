// What a failed hold SAYS, and when it stops coaching and starts apologising.
//
// "I didn't hear anything." is true and has never helped anybody: it names the
// symptom and none of the three things a beginner actually does wrong (letting
// go of Shift before speaking, tapping instead of holding, talking before the
// key is down). So the first few failures teach the gesture, and the browser's
// own error is held back until it is genuinely the answer — three in a row, at
// which point coaching has demonstrably not worked and the user gets a way to
// reach a human instead.
//
// The escalation is easy to get subtly wrong in ways nobody notices until a
// real user is stuck: a streak that resets on the wrong event never reaches the
// offer, and one that never resets shows it to people who are fine.
import fs from "node:fs";

const src = fs.readFileSync(new URL("../voice.js", import.meta.url), "utf8");

function grab(name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  if (src.slice(start - 6, start) === "async ") start -= 6;
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

const constant = (name) => src.match(new RegExp(`const ${name} = [^;]+;`))[0];
const array = (name) => src.match(new RegExp(`const ${name} = \\[[\\s\\S]*?\\n  \\];`))[0];

let failures = 0;
const check = (label, cond, detail) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  <-- ${detail || ""}`}`);
};

// A driver over the real functions, with the chip and storage stubbed so what
// is asserted is the message that would reach the user.
function makeVoice(holds) {
  return new Function(
    "holds",
    `${constant("SUPPORT_EMAIL")}
     ${constant("LEARNING_HOLDS")}
     ${constant("TROUBLE_BEFORE_HELP")}
     ${array("COACH_GESTURE")}
     ${array("COACH_WORDS")}
     ${array("MAIL_APPS")}
     const shown = [];
     const stored = {};
     let holdCount = holds;
     let troubleStreak = 0;
     let lane = "page";
     let micGranted = false;
     let pageMicState = "prompt";
     const location = { host: "example.com" };
     const navigator = { userAgent: "TestBrowser/1.0" };
     const console = { debug: () => {} };
     const remember = (k, v) => { stored[k] = v; };
     const showChip = (state, text, actions) => shown.push({ state, text, actions: actions || null });
     const hideChip = () => {};
     const opened = [];
     const openMail = (url) => opened.push(url);
     ${grab("voiceWorked")}
     ${grab("voiceTrouble")}
     ${grab("troubleReport")}
     ${grab("askMailApp")}
     return {
       trouble: (m, c) => voiceTrouble(m, c === "gesture" ? COACH_GESTURE : c === "words" ? COACH_WORDS : null),
       worked: voiceWorked,
       last: () => shown[shown.length - 1],
       all: () => shown,
       streak: () => troubleStreak,
       stored: () => stored,
       opened: () => opened,
       report: troubleReport,
       apps: MAIL_APPS,
       email: SUPPORT_EMAIL,
     };`,
  )(holds);
}

const RAW = "I didn't hear anything.";

// ------------------------------------------------- the first few times: coach
{
  const v = makeVoice(1);
  v.trouble(RAW, "gesture");
  check("failure 1 coaches instead of reporting", v.last().text !== RAW, v.last().text);
  check("and the coaching mentions the gesture", /Shift/.test(v.last().text), v.last().text);
  check("with no support button this early", v.last().actions === null);

  v.trouble(RAW, "gesture");
  check("failure 2 coaches differently", v.last().text !== RAW && v.all()[0].text !== v.last().text, v.last().text);

  v.trouble(RAW, "gesture");
  check("failure 3 shows the browser's actual words", v.last().text === RAW, v.last().text);
  check("and offers a way to reach a human", !!v.last().actions?.length);
  check("labelled plainly", v.last().actions[0].label === "Email us", v.last().actions[0].label);
}

// --------------------------------------------------------- the streak resets
{
  const v = makeVoice(1);
  v.trouble(RAW, "gesture");
  v.trouble(RAW, "gesture");
  v.worked(); // a command finally ran
  check("a working command clears the streak", v.streak() === 0);
  // Persisted, not just in memory: a content script is rebuilt on every
  // navigation, so a streak kept only in a variable would reset itself on the
  // next link click and the offer would never arrive.
  check("and the reset is written down", v.stored().jcVoiceTrouble === 0);
  v.trouble(RAW, "gesture");
  check("so the next failure is back to coaching", v.last().text !== RAW, v.last().text);
  check("with the new count written down too", v.stored().jcVoiceTrouble === 1);
}

// ------------------------------------------------ past the learning period
{
  const v = makeVoice(40); // a seasoned user
  v.trouble(RAW, "gesture");
  check("an experienced user gets the real error, not a lesson", v.last().text === RAW, v.last().text);
  v.trouble(RAW, "gesture");
  v.trouble(RAW, "gesture");
  check("and three in a row still reaches the support offer", !!v.last().actions?.length);
}

// -------------------------------------------------- nothing to coach about
{
  const v = makeVoice(1);
  const hard = "No microphone found — check it's plugged in and selected.";
  v.trouble(hard, null);
  check("holding Shift harder can't find missing hardware, so no lesson", v.last().text === hard, v.last().text);
  v.trouble(hard, null);
  v.trouble(hard, null);
  check("but it still escalates — three of these is when you need a human", !!v.last().actions?.length);
}

// ---------------------------------------------- a heard phrase that missed
{
  const v = makeVoice(1);
  v.trouble('I don\'t understand what you mean by "banana".', "words");
  check(
    "a grammar miss coaches about WHAT to say, not how to hold a key",
    !/Shift/.test(v.last().text) && v.last().text.length > 0,
    v.last().text,
  );
}

// ------------------------------------------------------------ the mail draft
{
  const v = makeVoice(1);
  v.trouble(RAW, "gesture");
  v.trouble(RAW, "gesture");
  v.trouble(RAW, "gesture");
  v.last().actions[0].run(); // "Email us"

  const ask = v.last();
  check("it asks which mail app before opening anything", /Where do you read your email/.test(ask.text), ask.text);
  check("and names the address it will write to", ask.text.includes(v.email), ask.text);
  check("with a choice per mail service", ask.actions.length === v.apps.length);

  const labels = ask.actions.map((a) => a.label);
  check("Gmail is one of them", labels.includes("Gmail"), labels.join());
  check("and the system handler is offered too", labels.includes("Mail app"), labels.join());

  for (const action of ask.actions) action.run();
  const urls = v.opened();
  check("every choice opens something", urls.length === v.apps.length, `${urls.length}`);
  check(
    "the web ones are compose URLs, not mailto",
    urls.filter((u) => /^https:/.test(u)).length === v.apps.length - 1,
    urls.join("\n"),
  );
  check(
    "and only the system-handler one is mailto",
    urls.filter((u) => u.startsWith("mailto:")).length === 1,
    urls.join("\n"),
  );
  check(
    "all of them address the support inbox",
    urls.every((u) => u.includes(encodeURIComponent(v.email)) || u.includes(v.email)),
    urls.join("\n"),
  );
  check("every draft carries a subject", urls.every((u) => /su=|subject=/.test(u)));
  check("choosing a mail app clears the streak", v.streak() === 0);
}

// ------------------------------------------------------------ what it reports
{
  const v = makeVoice(1);
  const body = v.report(RAW);
  check("the report quotes the actual error", body.includes(RAW), body);
  check("names the site so a site-specific block is findable", body.includes("example.com"), body);
  check("says which microphone lane was in play", /lane/.test(body), body);
  check("and leaves room for the user's own words", /What I was trying to do/.test(body), body);
  // The full URL can carry a session token, a search query, a document name.
  // The host is what makes a microphone fail; the rest is nobody's business.
  check(
    "it sends the host, never the full URL",
    !/location\.href/.test(grab("troubleReport")),
    "troubleReport is reading location.href",
  );
}

console.log();
console.log(failures === 0 ? "voice-coach OK" : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
