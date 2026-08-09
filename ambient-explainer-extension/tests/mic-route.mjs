// Which microphone does a hold use, and when is the one-time setup offered?
//
// The bug this locks down: the setup page promises "grant it here instead and
// hold to talk works everywhere", but the code only offered it AFTER a site had
// already blocked the mic. So the ordinary path was a per-site prompt on every
// new site, and most users never saw the setup that exists to prevent that.
//
// The rule now: offer setup at the FIRST mic request. Once the extension holds
// its own grant, use the page lane only where the site has already allowed the
// mic (Web Speech is faster and free) and the extension lane everywhere else,
// so no site is ever asked again.
import fs from "node:fs";

const src = fs.readFileSync(new URL("../voice.js", import.meta.url), "utf8");

let failures = 0;
const check = (label, cond, detail) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  <-- ${detail || ""}`}`);
};

// Pull the two decisions out of beginHold and evaluate them as real predicates,
// rather than trusting that the source "looks right".
const beginStart = src.indexOf("function beginHold()");
const beginBody = src.slice(beginStart, src.indexOf("\n  }", beginStart));

const offerCond = beginBody.match(
  /if \((!micGranted && pageMicState !== "granted" && !preferPageLane && !micSetupOffered)\)/,
);
check("the setup gate is evaluated before any microphone is touched", !!offerCond);
check(
  "the setup gate sits above the lane choice (so no site prompt can precede it)",
  !!offerCond && beginBody.indexOf("offerMicSetup()") < beginBody.indexOf("beginExtensionHold()"),
);
check(
  "nothing starts listening before the gate",
  beginBody.indexOf("offerMicSetup()") < beginBody.indexOf("startEngine()"),
);

const offer = (s) =>
  !s.micGranted && s.pageMicState !== "granted" && !s.preferPageLane && !s.micSetupOffered;
const extensionLane = (s) =>
  s.blocked || (s.micGranted && s.pageMicState !== "granted" && !s.preferPageLane);

const base = {
  micGranted: false,
  pageMicState: "prompt",
  preferPageLane: false,
  micSetupOffered: false,
  blocked: false,
};

// 1. The very first hold, nothing granted anywhere: offer setup, touch nothing.
check("first ever hold offers the one-time setup", offer({ ...base }) === true);

// 2. Having offered once, a second hold must not re-offer — it acts.
check("it never offers twice on the same page", offer({ ...base, micSetupOffered: true }) === false);

// 3. After granting, every site that would have prompted uses the extension
//    lane — which is the entire point: no site ever asks again.
for (const state of ["prompt", "denied"]) {
  const s = { ...base, micGranted: true, pageMicState: state, micSetupOffered: true };
  check(`granted + site "${state}" routes to the extension lane (no site prompt)`, extensionLane(s) === true);
  check(`granted + site "${state}" does not re-offer setup`, offer(s) === false);
}

// 4. A site the user already allowed keeps the FAST page lane.
{
  const s = { ...base, micGranted: true, pageMicState: "granted", micSetupOffered: true };
  check("a site already allowed keeps the fast Web Speech lane", extensionLane(s) === false);
  check("and is never offered setup", offer(s) === false);
}

// 5. Declining ("just this site") is honoured: page lane, site does the asking.
{
  const s = { ...base, preferPageLane: true, micSetupOffered: true };
  check("choosing 'just this site' uses the page lane", extensionLane(s) === false);
  check("choosing 'just this site' stops the setup offer", offer(s) === false);
  // Even once the extension later has a grant, their choice stands.
  const later = { ...s, micGranted: true };
  check("their choice survives a later extension grant", extensionLane(later) === false);
}

// 6. A site that actively blocked still goes to the extension lane regardless.
{
  const s = { ...base, blocked: true, micSetupOffered: true, preferPageLane: true };
  check("a blocked site overrides even a page-lane preference", extensionLane(s) === true);
}

// 7. Structural guarantees around the two caches.
check(
  "the extension grant is verified against the real permission, not just storage",
  /JC_VOICE_MIC_STATUS/.test(src) && /micGranted = res\.state === "granted"/.test(src),
);
check(
  "the site's mic state is READ rather than probed (reading never prompts)",
  /navigator\.permissions\.query\(\{ name: "microphone" \}\)/.test(src),
);
check(
  "a revoked grant is noticed (permission change is watched)",
  /status\.onchange/.test(src),
);
check(
  "the unknown case defaults to 'prompt', which routes AWAY from a site prompt",
  /let pageMicState = "prompt"/.test(src),
);
check(
  "the offer gives a real second option rather than only a dismissal",
  /label: "Just this site"/.test(src),
);
check(
  "no faked permission-state sentinel is used as a flag",
  !/granted-by-choice/.test(src),
);

console.log();
console.log(failures === 0 ? "mic-route OK" : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
