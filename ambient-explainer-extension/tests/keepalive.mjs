// Runs llm-keepalive.js against a stubbed hidden tab. The property that has to
// hold: frames fire when the tab is hidden AND stamped, and the script is
// completely inert on a tab it was never stamped on (a user's own ChatGPT tab).
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../llm-keepalive.js", import.meta.url), "utf8");

function run({ stamped, visibility }) {
  const timers = [];
  let realFrames = 0;

  const dataset = stamped ? { jcDrive: "1" } : {};
  const html = { dataset };

  const document = { documentElement: html };
  // The real visibilityState/hidden live on Document.prototype in Chrome; the
  // script walks the prototype chain to find them, so mirror that shape.
  const proto = {};
  Object.defineProperty(proto, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(proto, "hidden", {
    configurable: true,
    get: () => visibility === "hidden",
  });
  Object.setPrototypeOf(document, proto);

  const listeners = [];
  const window = {
    // A real browser eventually runs the callback on the visible path; model
    // that so `painted` means the same thing on both paths.
    requestAnimationFrame: (cb) => { realFrames++; cb(0); return 9000 + realFrames; },
    cancelAnimationFrame: () => {},
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
  };

  const context = {
    document,
    window,
    performance: { now: () => 123 },
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    Set, Object, Error,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(src, context);

  // The page asks for a frame.
  let painted = false;
  const id = window.requestAnimationFrame(() => { painted = true; });
  // Drain any timer the shim queued.
  const queued = timers.length;
  timers.forEach((t) => t.fn());

  return {
    painted,
    viaTimer: queued > 0,
    viaRealFrame: realFrames > 0,
    reportsVisible: document.visibilityState === "visible",
    reportsHidden: document.hidden,
    swallowsVisibilityChange: listeners.some((l) => l.type === "visibilitychange" && l.capture),
    id,
  };
}

const cases = [
  ["OUR temp tab, hidden      (the bug)", { stamped: true,  visibility: "hidden"  }],
  ["OUR temp tab, visible             ", { stamped: true,  visibility: "visible" }],
  ["user's own tab, hidden            ", { stamped: false, visibility: "hidden"  }],
  ["user's own tab, visible           ", { stamped: false, visibility: "visible" }],
];

console.log("scenario                              painted  via        says-visible");
console.log("-".repeat(74));
const results = {};
for (const [label, cfg] of cases) {
  const r = run(cfg);
  results[label.trim()] = r;
  console.log(
    label,
    (r.painted ? "YES" : "no").padEnd(8),
    (r.viaTimer ? "timer" : r.viaRealFrame ? "real frame" : "none").padEnd(11),
    String(r.reportsVisible),
  );
}

const checks = [
  [
    "hidden + stamped paints via a timer (the fix)",
    results["OUR temp tab, hidden      (the bug)"].painted &&
      results["OUR temp tab, hidden      (the bug)"].viaTimer,
  ],
  [
    "hidden + stamped is told it is visible",
    results["OUR temp tab, hidden      (the bug)"].reportsVisible &&
      !results["OUR temp tab, hidden      (the bug)"].reportsHidden,
  ],
  [
    "visible + stamped uses the REAL frame path",
    results["OUR temp tab, visible"].viaRealFrame &&
      !results["OUR temp tab, visible"].viaTimer,
  ],
  [
    "unstamped hidden tab is untouched (real frames, still hidden)",
    results["user's own tab, hidden"].viaRealFrame &&
      !results["user's own tab, hidden"].viaTimer &&
      !results["user's own tab, hidden"].reportsVisible,
  ],
  [
    "unstamped visible tab is untouched",
    results["user's own tab, visible"].viaRealFrame &&
      results["user's own tab, visible"].reportsVisible,
  ],
  [
    "visibilitychange is intercepted in the capture phase",
    results["OUR temp tab, hidden      (the bug)"].swallowsVisibilityChange,
  ],
];

console.log();
let bad = 0;
for (const [label, pass] of checks) {
  if (!pass) bad++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
}
console.log();
console.log(bad === 0 ? "keepalive OK" : `${bad} check(s) failed`);
process.exit(bad === 0 ? 0 : 1);
