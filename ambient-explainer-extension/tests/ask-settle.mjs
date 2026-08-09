// The bug this guards: an answer existed, streamed, and reached the page — and
// the page still spun forever, because jcSend swallowed send failures WITHOUT
// CALLING BACK, so askChatGPT's promise never settled. A request that cannot
// fail is a request that can hang, and a hung request is an answer the user
// never sees.
//
// Behavioural, not source-grep: jcSend is extracted and driven against a stubbed
// chrome.runtime through every failure mode.
import fs from "node:fs";

const src = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");

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

// ---- jcSend, driven through every outcome --------------------------------
function runSend({ alive, lastError, throws, respond }) {
  const chrome = {
    runtime: {
      id: alive ? "abc" : undefined,
      lastError: null,
      sendMessage(_msg, cb) {
        if (throws) throw new Error("channel exploded");
        chrome.runtime.lastError = lastError ? { message: lastError } : null;
        cb(respond);
      },
    },
  };
  const calls = { ok: [], err: [] };
  const fn = new Function(
    "chrome", "jcContextAlive", "jcWarnStale", "message", "callback", "onError",
    grab("jcSend") + "\nreturn jcSend(message, callback, onError);",
  );
  const returned = fn(
    chrome,
    () => alive,
    () => {},
    { type: "ASK_CLAUDE" },
    (r) => calls.ok.push(r),
    (e) => calls.err.push(e.message),
  );
  return { returned, ...calls };
}

const happy = runSend({ alive: true, respond: { ok: true, answer: "hi" } });
check("healthy send delivers the response", happy.ok.length === 1 && happy.err.length === 0);
check("healthy send returns true", happy.returned === true);

const dead = runSend({ alive: false });
check("dead context reports an error (never silent)", dead.err.length === 1);
check("dead context returns false", dead.returned === false);

const errored = runSend({ alive: true, lastError: "message port closed" });
check("lastError reports an error instead of vanishing", errored.err.length === 1);
check("lastError does NOT call the success callback", errored.ok.length === 0);
check("lastError message is surfaced", /message port closed/.test(errored.err[0] || ""));

const threw = runSend({ alive: true, throws: true });
check("a throwing sendMessage reports an error", threw.err.length === 1);
check("a throwing sendMessage returns false", threw.returned === false);

// ---- askChatGPT: structural guarantees -----------------------------------
const askStart = src.indexOf("async function askChatGPT");
const askBody = src.slice(askStart, src.indexOf("\n}\n", askStart));

check(
  "askChatGPT settles exactly once via a settled guard",
  /let settled = false/.test(askBody) && /if \(settled\) return;/.test(askBody),
);
check(
  "resolve appears only inside finishOk",
  (askBody.match(/\bresolve\(/g) || []).length === 1,
);
check(
  "reject appears only inside finishBad",
  (askBody.match(/\breject\(/g) || []).length === 1,
);
check(
  "an onError handler is passed to jcSend",
  /\(error\) => finishBad\(/.test(askBody),
);
check(
  "a false return from jcSend still settles the promise",
  /if \(!sent\) finishBad/.test(askBody),
);
// Two things must be true, and a bare call-count can't tell them apart:
// the watchdog is armed when the ask starts, AND re-armed by each progress
// message (so a slow-but-alive engine is never cut off).
const onMessageStart = askBody.indexOf("const onMessage = (msg)");
const onMessageEnd = askBody.indexOf("chrome.runtime.onMessage.addListener");
const inOnMessage = askBody.slice(onMessageStart, onMessageEnd);
check(
  "a silence ceiling is defined",
  /const JC_ASK_SILENCE_MS = /.test(src),
);
check(
  "progress messages re-arm the watchdog (slow engines aren't cut off)",
  /armWatchdog\(\)/.test(inOnMessage),
);
check(
  "the watchdog is armed when the ask begins",
  /addListener\(onMessage\);\s*\n\s*armWatchdog\(\);/.test(askBody),
);
check(
  "the watchdog is cleared on every settle",
  /clearTimeout\(watchdog\)/.test(askBody),
);
check(
  "a superseded ask fails quietly rather than showing an error",
  /resp\?\.superseded\) return finishBad\("superseded", true\)/.test(askBody),
);
check(
  "the listener is removed on every settle path",
  /removeListener\(onMessage\)/.test(askBody) &&
    askBody.indexOf("const cleanup") < askBody.indexOf("finishOk"),
);

// ---- the detached-card bug ------------------------------------------------
// The LLM engine takes the user away from the page for 20s+. Their return click
// used to destroy the answer card, and the answer then rendered into an orphan:
// no error, no exception, nothing visible, while the provider tab showed it
// perfectly. Three things have to hold.
check(
  "in-flight asks are counted",
  /let jcAsksInFlight = 0/.test(src) && /jcAsksInFlight \+= 1/.test(src),
);
check(
  "the counter is released in cleanup (every settle path)",
  /jcAsksInFlight = Math\.max\(0, jcAsksInFlight - 1\)/.test(src),
);
check(
  "a stray click cannot bin a card that is still loading",
  /if \(jcAsksInFlight > 0\) return;\s*\n\s*removePopup\(\);/.test(src),
);
check(
  "Escape still closes it (explicit intent is always honoured)",
  /e\.key === "Escape"[\s\S]{0,80}removePopup\(\)/.test(src),
);

// Every render entry point must re-resolve the live card rather than trusting a
// reference captured before an await.
check(
  "a live-card resolver exists",
  /function jcLivePopup\(popup\)/.test(src) && /popup\.isConnected/.test(src),
);
for (const fn of ["showPopupMessage", "setPopupLoading", "renderStreaming", "renderAnswer"]) {
  const i = src.indexOf(`function ${fn}(`);
  const head = src.slice(i, i + 260);
  check(`${fn} resolves the live card before writing`, /popup = jcLivePopup\(popup\);/.test(head));
}

// Reveal transitions must survive a hidden tab, or the answer sits at opacity 0.
check(
  "a hidden-tab-safe frame helper exists",
  /function jcNextFrame\(fn\)/.test(src) && /visibilityState === "hidden"/.test(src),
);
check(
  "the streaming pump still uses REAL frames (it wants smoothness, not fallback)",
  /jcStreamFrame = requestAnimationFrame\(step\)/.test(src),
);
const revealCount = (src.match(/jcNextFrame\(/g) || []).length;
check(`reveal sites converted to jcNextFrame (found ${revealCount})`, revealCount >= 7);

// A superseded ask must render nothing at all.
check(
  "superseded errors are marked quiet on the Error itself",
  /error\.jcQuiet = true/.test(src),
);
check(
  "showClaudeError ignores quiet errors",
  /if \(err && err\.jcQuiet\) return;/.test(src),
);

const llmSrc = fs.readFileSync(new URL("../llm.js", import.meta.url), "utf8");
check(
  "a superseded ask never returns a partial answer that could stomp the new one",
  /return \{ ok: false, error: "superseded", superseded: true \};/.test(llmSrc) &&
    !/if \(last\) return \{ ok: true[\s\S]{0,80}?superseded/.test(llmSrc),
);

console.log();
console.log(failures === 0 ? "ask-settle OK" : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
