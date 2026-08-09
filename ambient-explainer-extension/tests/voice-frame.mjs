// The iframe relay for push-to-talk. Run with:  npm run test:frame
//
// "Sometimes I hold Shift and nothing happens" was focus sitting inside an
// iframe: voice.js lives in the top frame only, and a keydown is dispatched in
// the document owning the focused element, so the gesture never existed there.
//
// The fix has two properties that are easy to regress and expensive to get
// wrong, so they are pinned here:
//   1. the relay runs in all frames but the HEAVY bundle must not — putting
//      content.js in every ad iframe is the cure being worse than the disease
//   2. the hop goes through the worker, NOT window.postMessage, because a page
//      can postMessage its own top frame and would otherwise be able to open
//      the microphone with no user action at all
import fs from "node:fs";

const dir = new URL("../", import.meta.url);
const frame = fs.readFileSync(new URL("voice-frame.js", dir), "utf8");
// Comments explain why postMessage is NOT used, so a naive substring test finds
// the word in the prose arguing against it. Strip commentary before asserting
// on what the code actually does.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const frameCode = stripComments(frame);
const voice = fs.readFileSync(new URL("voice.js", dir), "utf8");
const worker = fs.readFileSync(new URL("background.js", dir), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", dir), "utf8"));

let failures = 0;
const check = (label, cond, detail) => {
  if (!cond) { failures++; console.log(`FAIL  ${label}${detail ? `  <-- ${detail}` : ""}`); }
  else console.log(`PASS  ${label}`);
};

// ---- 1. what runs where -------------------------------------------------

const entries = manifest.content_scripts || [];
const relay = entries.find((e) => (e.js || []).includes("voice-frame.js"));
const bundle = entries.find((e) => (e.js || []).includes("content.js"));

check("the relay is registered as a content script", !!relay);
check("the relay runs in ALL frames", relay && relay.all_frames === true);
check(
  "the relay is the ONLY thing running in all frames",
  relay && relay.js.length === 1,
  relay && relay.js.join(","),
);
check(
  "the heavy bundle does NOT run in every frame",
  bundle && bundle.all_frames !== true,
  "content.js in every ad iframe is worse than the bug it fixes",
);
check("the relay carries no stylesheet", relay && !relay.css);

// ---- 2. the relay is inert in the top frame -----------------------------

check(
  "the relay returns immediately in the top frame",
  /if\s*\(\s*window\.top\s*===\s*window\s*\)\s*return/.test(frame),
  "otherwise the top frame relays to itself and double-fires every hold",
);
check(
  "the relay applies the editable-element guard in its own document",
  /isContentEditable/.test(frame) && /INPUT\|TEXTAREA\|SELECT/.test(frame),
  "the top frame only sees IFRAME as activeElement and cannot judge this",
);
check("the relay ignores auto-repeat", /e\.repeat/.test(frame));
check("the relay ignores other modifiers", /ctrlKey.*metaKey.*altKey/s.test(frame));
check(
  "the relay ends the hold when its frame loses focus",
  /addEventListener\(\s*["']blur["']/.test(frame),
  "a live microphone must not outlive the gesture",
);

// ---- 3. the hop cannot be forged by a page ------------------------------

check(
  "the relay uses chrome.runtime, not window.postMessage",
  /chrome\.runtime\.sendMessage/.test(frameCode) && !/postMessage/.test(frameCode),
  "postMessage is forgeable by any page and would open the mic unprompted",
);
check(
  "voice.js accepts the relay over chrome.runtime.onMessage",
  /onMessage\.addListener[\s\S]{0,400}JC_VOICE_FRAME_KEY/.test(voice),
);
check(
  "the worker refuses to relay a message that came from frame 0",
  /JC_VOICE_FRAME_KEY[\s\S]{0,700}_sender\.frameId/.test(worker),
  "frame 0 has its own real listener; relaying to it is a loop",
);
check(
  "the worker targets frame 0 explicitly",
  /JC_VOICE_FRAME_KEY[\s\S]{0,700}frameId:\s*0/.test(worker),
);

// ---- 4. the fixes that made the chip visible again ----------------------

check(
  "the chip mounts on documentElement, not body",
  /documentElement\s*\|\|\s*document\.body\)\.appendChild\(chip\)/.test(voice),
  "a transform/filter on <body> makes it the containing block for position:fixed",
);
check(
  "the chip does not depend on page-scope CSS variables for its colours",
  !/var\(--surface-color\)|var\(--text-primary\)|var\(--popup-border\)/.test(voice),
  "custom properties inherit THROUGH a shadow boundary — the one thing it cannot isolate",
);
check(
  "a speech error clears the hold flag, tears down, then reports",
  /holding = false;\s*\n\s*stopEngine\(\);\s*\n\s*stopRecording\(\);[\s\S]{0,400}?voiceTrouble\(\s*\n?\s*message/.test(
    voice,
  ),
  "otherwise the NEXT hold dies silently at the re-entrancy guard",
);
check(
  "stopRecording waits for the recorder's final chunk before killing the stream",
  /addEventListener\("stop", finish/.test(voice),
  "MediaRecorder emits its only chunk asynchronously; looking first found nothing",
);
check(
  "settle awaits that flush before giving up on a transcript",
  /recordingFlush[\s\S]{0,200}accurateTranscript/.test(voice),
);
check(
  "the engine gate that refused the microphone is gone",
  !/engineCache !== "api"/.test(voice),
  "transcription and the whole local grammar never needed it",
);

// ---- 5. a short utterance is still an utterance -------------------------

const offscreen = fs.readFileSync(new URL("offscreen.js", dir), "utf8");
const shortFloors = [...voice.matchAll(/blob\.size < (\d+)/g), ...offscreen.matchAll(/blob\.size < (\d+)/g)]
  .map((m) => Number(m[1]));
check(
  "the too-short-audio floor accepts one-word commands",
  shortFloors.length >= 2 && shortFloors.every((n) => n <= 300),
  `floors=${shortFloors.join(",")} — 800 bytes of WebM is ~a quarter second AFTER the container header, which threw away "stop" and "go back"`,
);
check(
  "both lanes use the SAME floor",
  new Set(shortFloors).size === 1,
  `floors=${shortFloors.join(",")}`,
);
check(
  "the extension lane resets per-hold state like the page lane does",
  /beginExtensionHold[\s\S]{0,600}alternatives = \[\];[\s\S]{0,200}topConfidence = null;/.test(voice),
  "otherwise a hold executes a runner-up from the PREVIOUS sentence",
);

// ---- 6. going somewhere else must not destroy this page -----------------

const commands = fs.readFileSync(new URL("commands.js", dir), "utf8");
check(
  "web search opens a tab instead of overwriting the page",
  /function webSearch[\s\S]{0,300}openInNewTab/.test(commands) &&
    !/function webSearch[\s\S]{0,300}location\.href =/.test(commands),
);
check(
  "opening a different site opens a tab",
  /const goTo = \(url\) => \{[\s\S]{0,300}openInNewTab/.test(commands),
);
check(
  "undo closes the tab it opened rather than walking history back",
  /closeTabId/.test(commands) && /closeTabId/.test(worker),
);
check(
  "the worker refuses a non-http URL from the page",
  /JC_VOICE_TAB[\s\S]*?case 'open'[\s\S]{0,400}\^https\?/.test(worker),
  "a content script must not be able to open javascript: or file:",
);
// Same-site moves deliberately stay put: "go home" and an in-site search both
// carry state across the navigation that a new tab would lose.
check(
  "same-site navigation still happens in place",
  /location\.href = location\.origin/.test(commands) && /location\.href = hit\.href/.test(commands),
);

console.log(failures ? `\nvoice-frame: ${failures} failing` : "\nvoice-frame OK");
process.exit(failures ? 1 : 0);
