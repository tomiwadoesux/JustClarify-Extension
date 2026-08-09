// End-to-end harness for the "Your LLM" engine — the REAL extension, a REAL
// (headless) Chrome, and a fake provider page that behaves like ChatGPT's
// ProseMirror composer in every way that has bitten us:
//
//   - direct DOM writes to the composer are REVERTED a moment later
//     (ProseMirror reconciliation — the "second ask does nothing" bug)
//   - only a paste event or real typing updates its internal state
//   - the send button stays disabled until that internal state has text
//   - ?q= in the URL auto-fills and auto-submits (ChatGPT behaviour)
//   - replies stream into the DOM via requestAnimationFrame (the "answer
//     only appears when I open the tab" bug)
//
// Headless on purpose: nothing appears on screen.
//
// Needs Playwright once:   npm i -D playwright && npx playwright install chromium
// Run:                     npm run test:e2e        (CSP=1 adds a Claude-style CSP)
//
// What it has already proven, for the record:
//   - the typed path fills and sends a PM-style composer that reverts direct
//     DOM writes (the "second ask does nothing" family of bugs)
//   - the MAIN-world keepalive script loads even under a strict page CSP
//   - hidden-tab streaming degrades to ~1s lumps WITHOUT the audio exemption;
//     headless Chrome has no audio device, so the tone path (tab.audible) can
//     only be verified in a headed browser.
import http from "node:http";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const FAKE_PAGE = `<!doctype html>
<meta charset="utf-8"><title>FakeLLM</title>
<body>
<div id="composer" contenteditable="true" style="border:1px solid #999;min-height:2em;padding:4px"></div>
<button id="send" disabled>Send</button>
<button id="stop" hidden>Stop</button>
<div id="thread"></div>
<script>
  // Internal state, ProseMirror-style: the DOM is a VIEW of this, not the truth.
  const state = { text: "" };
  const composer = document.getElementById("composer");
  const sendBtn = document.getElementById("send");
  const stopBtn = document.getElementById("stop");
  const thread = document.getElementById("thread");
  let rendering = false;

  function render() {
    rendering = true;
    composer.textContent = state.text;
    sendBtn.disabled = !state.text.trim();
    rendering = false;
  }

  // Reconciliation: any DOM change we didn't make ourselves gets reverted,
  // exactly like ProseMirror stomping a direct textContent write.
  new MutationObserver(() => {
    if (rendering) return;
    if (composer.textContent !== state.text) setTimeout(render, 10);
  }).observe(composer, { childList: true, characterData: true, subtree: true });

  // Paste is the supported way in (ProseMirror handles paste itself).
  composer.addEventListener("paste", (e) => {
    e.preventDefault();
    const t = e.clipboardData && e.clipboardData.getData("text/plain");
    if (t) { state.text = t; render(); }
  });

  composer.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && state.text.trim()) { e.preventDefault(); submit(); }
  });
  sendBtn.addEventListener("click", () => { if (state.text.trim()) submit(); });

  // A REAL streaming fetch, like a real chat app: the answer comes over an SSE
  // connection to the server, and the page reads it token by token. This is
  // what llm-net.js tees. NODOM=1 makes the page consume the stream but never
  // write it to the DOM — simulating a hidden tab whose render loop is frozen —
  // so the ONLY way the answer can reach the extension is the network path.
  async function submit() {
    const q = state.text.trim();
    state.text = "";
    render();
    const user = document.createElement("div");
    user.className = "user";
    user.textContent = q;
    thread.appendChild(user);
    stopBtn.hidden = false;

    const reply = document.createElement("div");
    reply.className = "reply";
    thread.appendChild(reply);

    let res;
    try {
      res = await fetch("/stream?q=" + encodeURIComponent(q));
    } catch (_) {
      stopBtn.hidden = true;
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let acc = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\\n");
      buffer = lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const delta = JSON.parse(payload).choices[0].delta.content;
          if (delta) {
            acc += delta;
            // The DOM write the extension would normally read. Skipped under
            // NODOM to prove the network path stands alone.
            if (!window.__noDom) reply.textContent = acc;
          }
        } catch (_) {}
      }
    }
    // BUSY_STUCK=1 simulates a stop-button selector gone stale after a provider
    // redesign: the button never hides. The reader must still finish (via the
    // stable-text fallback) instead of hanging two minutes.
    if (!window.__busyStuck) stopBtn.hidden = true;
  }
  window.__busyStuck = new URLSearchParams(location.search).get("busystuck") === "1";
  window.__noDom = new URLSearchParams(location.search).get("nodom") === "1";

  // ChatGPT's ?q= behaviour: fill and submit shortly after load.
  const q = new URLSearchParams(location.search).get("q");
  if (q) setTimeout(() => { state.text = q; render(); submit(); }, 300);
</script>
</body>`;

const CLAUDE_CSP =
  "default-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src-attr 'none'";
const server = http.createServer(async (req, res) => {
  // The SSE answer stream — OpenAI delta shape, which llm-net.js's generic
  // extractor understands. One token every 80ms so the whole answer takes a few
  // seconds, like a real model. This is the network the interceptor tees.
  if (req.url.startsWith("/stream")) {
    const q = decodeURIComponent((req.url.split("q=")[1] || "").split("&")[0]);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const words = ("ANSWER[" + q + "] " + "lorem ".repeat(60)).trim().split(" ");
    for (const w of words) {
      const frame = { choices: [{ delta: { content: w + " " } }] };
      res.write(`data: ${JSON.stringify(frame)}\n\n`);
      await new Promise((r) => setTimeout(r, 80));
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }
  const headers = { "Content-Type": "text/html" };
  if (process.env.CSP === "1") headers["Content-Security-Policy"] = CLAUDE_CSP;
  res.writeHead(200, headers);
  res.end(FAKE_PAGE);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
console.log("fake provider at", base);

// Two modes, because streaming has two independent halves:
//
//   default (AWAKE=1, the default): the tab is kept responsive, which is the
//     state the audio exemption produces in a real browser and the state the
//     user confirmed they now have ("playing a sound"). This isolates the
//     READ logic — does textContent + polling actually stream when the DOM is
//     genuinely updating? This is what the llm.js fixes target.
//
//   THROTTLE=1: Chrome's real background throttling left on. Headless has no
//     audio device, so the exemption can't apply and the tab is starved — the
//     fake page's own rAF barely fires, so there is little to stream no matter
//     how well we read. This documents the ceiling, it is not a pass/fail.
const throttled = process.env.THROTTLE === "1";
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--autoplay-policy=no-user-gesture-required"],
  ignoreDefaultArgs: throttled
    ? [
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ]
    : [],
});
console.log("mode:", throttled ? "THROTTLED (documents the ceiling)" : "AWAKE (tests the read fix)");

let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => null);
if (!worker) {
  console.log("VERDICT: headless Chrome never started the extension service worker — harness impossible here.");
  await context.close();
  server.close();
  process.exit(2);
}
console.log("extension service worker: started");

// The origin page — where the user highlighted. Stays in FRONT so the
// provider tab is genuinely hidden, like a collapsed group.
const origin = await context.newPage();
await origin.goto(`${base}/origin`);
await origin.bringToFront();

// Teach the worker a "dev" provider that points at the fake, and log the
// progress stream instead of sending it to a popup.
await worker.evaluate(async ({ base, nodom }) => {
  // NODOM: the provider page consumes its stream but never writes it to the
  // DOM — a stand-in for a hidden tab whose render loop is frozen. If the answer
  // still arrives, streams, and reaches the origin page, it did so entirely
  // through the network interceptor, with the DOM contributing nothing.
  const suffix = nodom ? "nodom=1&" : "";
  LLM_PROVIDERS.dev = {
    name: "DevLLM",
    symbol: "⚙",
    url: `${base}/chat?${suffix.replace(/&$/, "")}`,
    host: "127.0.0.1",
    askUrl: (p) => `${base}/chat?${suffix}q=${encodeURIComponent(p)}`,
    editor: ["#composer"],
    send: ["#send"],
    reply: [".reply"],
    busy: ["#stop"],
  };
  await chrome.storage.local.set({ jcLlmProvider: "dev" });
  try { await chrome.scripting.unregisterContentScripts({ ids: ["jc-llm-keepalive"] }); } catch (_) {}
  await chrome.scripting.registerContentScripts([{
    id: "jc-llm-keepalive",
    matches: ["http://127.0.0.1/*"],
    js: ["llm-net.js", "llm-keepalive.js"],
    runAt: "document_start",
    world: "MAIN",
    allFrames: false,
  }]);
  self.jcLog = [];
  self.jcDeliver = [];
  const t0 = Date.now();
  llmState = (tab, req, prov, text) => self.jcLog.push({ kind: "state", text, ms: Date.now() - t0 });
  // Record the event AND actually attempt delivery to the origin tab. The
  // earlier version only recorded, and passed null as the origin tab — so the
  // last hop (worker -> origin page's content script) was never exercised at
  // all. That is exactly the hop that broke: the answer existed, streamed, and
  // was never received by the page the user highlighted on.
  llmProgress = (tab, req, prov, answer, done) => {
    self.jcLog.push({ kind: "progress", len: answer.length, done, ms: Date.now() - t0 });
    if (tab == null) {
      self.jcDeliver.push({ ok: false, done, reason: "no origin tab id" });
      return;
    }
    chrome.tabs
      .sendMessage(tab, {
        type: "CLAUDE_PROGRESS",
        reqId: req,
        thinking: "",
        answer,
        done,
        engine: "llm",
        model: prov.name,
      })
      .then(
        () => self.jcDeliver.push({ ok: true, done }),
        (e) => self.jcDeliver.push({ ok: false, done, reason: String(e).slice(0, 90) }),
      );
  };
}, { base, nodom: process.env.NODOM === "1" });

const display = await origin.evaluate(() => ({
  availLeft: screen.availLeft, availTop: screen.availTop,
  availWidth: screen.availWidth, availHeight: screen.availHeight,
}));
// A pointer roughly mid-screen, like a user reading an article.
const cursor = {
  x: Math.round(display.availLeft + display.availWidth * 0.35),
  y: Math.round(display.availTop + display.availHeight * 0.4),
  ...display,
};
console.log("display:", JSON.stringify(display), "cursor:", cursor.x + "," + cursor.y);

async function ask(label, question, { hideAfterMs } = {}) {
  console.log(`\n=== ${label} ===`);
  await worker.evaluate(() => { self.jcLog.length = 0; self.jcDeliver.length = 0; });
  // The REAL origin tab id, resolved in the worker — this is what the content
  // script on the highlighted page listens as.
  const running = worker.evaluate(async ({ q, cursor }) => {
    const [tab] = await chrome.tabs.query({ url: "http://127.0.0.1/*", active: true });
    const originId = tab ? tab.id : null;
    self.jcOriginId = originId;
    return llmAsk(q, "req-" + Date.now(), originId, { cursor, host: "127.0.0.1" });
  }, { q: question, cursor });

  if (hideAfterMs != null) {
    // The user looks at the fresh provider tab briefly, then goes back.
    setTimeout(() => origin.bringToFront().catch(() => {}), hideAfterMs);
  }

  const result = await running;
  const log = await worker.evaluate(() => self.jcLog);
  const progress = log.filter((e) => e.kind === "progress");
  const states = log.filter((e) => e.kind === "state").map((e) => e.text);

  console.log("result.ok      :", result.ok, result.ok ? "" : `| error: ${result.error}`);
  if (result.ok) {
    console.log("answer contains:", JSON.stringify((result.answer || "").slice(0, 60)));
  }
  console.log("progress events:", progress.length,
    progress.length > 1
      ? `(streamed: first at ${progress[0].ms}ms, last at ${progress[progress.length - 1].ms}ms)`
      : "(NO streaming — arrived in one lump or not at all)");
  console.log("status line    :", states.join(" -> ") || "(none)");

  const tabState = await worker.evaluate(async () => {
    const { jcLlmTabId } = await chrome.storage.local.get(["jcLlmTabId"]);
    if (jcLlmTabId == null) return null;
    try {
      const tab = await chrome.tabs.get(jcLlmTabId);
      return { audible: !!tab.audible, muted: !!(tab.mutedInfo && tab.mutedInfo.muted), active: tab.active };
    } catch (_) { return null; }
  });
  console.log("provider tab   :", JSON.stringify(tabState));

  const surface = await worker.evaluate(async () => {
    const st = await chrome.storage.local.get(["jcLlmWindowId", "jcLlmTabId"]);
    if (st.jcLlmWindowId == null) return { kind: "tab (fallback)", tabId: st.jcLlmTabId };
    try {
      const w = await chrome.windows.get(st.jcLlmWindowId);
      return { kind: "popup window", id: w.id, type: w.type, state: w.state,
               bounds: [w.left, w.top, w.width, w.height], focused: w.focused };
    } catch (e) { return { kind: "window gone" }; }
  });
  console.log("surface        :", JSON.stringify(surface));

  const deliver = await worker.evaluate(() => ({ rows: self.jcDeliver, originId: self.jcOriginId }));
  const okCount = deliver.rows.filter((r) => r.ok).length;
  const failed = deliver.rows.filter((r) => !r.ok);
  const finalRow = deliver.rows.filter((r) => r.done).pop();
  console.log(
    "delivery       :", `origin tab ${deliver.originId} | ${okCount}/${deliver.rows.length} reached the page`,
    failed.length ? `| FIRST FAILURE: ${failed[0].reason}` : "",
  );
  console.log("final delivered:", finalRow ? (finalRow.ok ? "YES" : `NO — ${finalRow.reason}`) : "no done event");
  return { result, progress, surface, deliver: deliver.rows, finalDelivered: !!(finalRow && finalRow.ok) };
}

// Ask 1 — fresh tab, URL fast path, user watches briefly then leaves.
const one = await ask("ASK 1 (fresh tab, ?q= fast path, user leaves mid-answer)",
  "What is a quokka?", { hideAfterMs: 1200 });

// Did the MAIN-world scripts survive the page's CSP and actually run?
const providerPage = context.pages().find((p) => p.url().includes("/chat"));
let netWrapped = false;
let domReplyLen = null;
if (providerPage) {
  const patch = await providerPage.evaluate(() => ({
    rafPatched: !String(window.requestAnimationFrame).includes("[native code]"),
    fetchWrapped: !String(window.fetch).includes("[native code]"),
    stamped: document.documentElement.dataset.jcDrive === "1",
    replyLen: (document.querySelector(".reply") || {}).textContent
      ? document.querySelector(".reply").textContent.length
      : 0,
  }));
  netWrapped = patch.fetchWrapped;
  domReplyLen = patch.replyLen;
  console.log("\nMAIN-world on provider page:",
    patch.rafPatched ? "rAF PATCHED" : "rAF native",
    "|", patch.fetchWrapped ? "fetch WRAPPED (llm-net ran)" : "fetch native (llm-net did NOT run)",
    "| stamped:", patch.stamped,
    "| .reply DOM chars:", patch.replyLen);
}

// Ask 2 — the reported failure: same tab, typed path, tab hidden throughout.
const two = await ask("ASK 2 (existing tab, typed path, tab hidden the whole time)",
  "Tell me about wombats instead.");

// Ask 3 — again, to catch anything ask 2 leaves broken.
const three = await ask("ASK 3 (typed path again)",
  "And now hummingbirds.");

const finalSurface = three.surface || two.surface || one.surface || {};
console.log("\n" + "=".repeat(64));
const checks = [
  ["ask1 answered its own question", one.result.ok && (one.result.answer || "").includes("quokka")],
  ["ask1 streamed progressively (>3 progress events)", one.progress.length > 3],
  ["ask2 answered WOMBATS, not the first question", !!two.result.ok && (two.result.answer || "").includes("wombats")],
  ["ask2 streamed progressively", two.progress.length > 3],
  ["ask3 answered hummingbirds", !!three.result.ok && (three.result.answer || "").includes("hummingbirds")],
  // THE LAST HOP. Everything above can pass while the user sees nothing.
  ["ask1 final answer REACHED the origin page", one.finalDelivered],
  ["ask2 final answer REACHED the origin page", two.finalDelivered],
  ["ask3 final answer REACHED the origin page", three.finalDelivered],
  // THE NETWORK PATH. llm-net.js must have wrapped fetch on the driven tab.
  ["llm-net wrapped fetch on the driven tab", netWrapped],
  // THE POPUP SURFACE. It must be a real popup window, never minimised, and
  // fully inside the display — Chrome throws outright if it is not.
  ["the provider ran in a popup window", finalSurface.kind === "popup window"],
  ["the popup window is type 'popup'", finalSurface.type === "popup"],
  ["the popup window is not minimised", finalSurface.state === "normal"],
  ["the popup window never stole focus", finalSurface.focused === false],
  [
    "the popup window sits fully inside the display",
    !!finalSurface.bounds &&
      finalSurface.bounds[0] >= display.availLeft &&
      finalSurface.bounds[1] >= display.availTop &&
      finalSurface.bounds[0] + finalSurface.bounds[2] <= display.availLeft + display.availWidth + 1 &&
      finalSurface.bounds[1] + finalSurface.bounds[3] <= display.availTop + display.availHeight + 1,
  ],
];

// NODOM: the decisive proof. The provider page never wrote the answer to the
// DOM, so a correct answer on the origin page can ONLY have come through the
// network interceptor. If this passes, the whole point of the rewrite holds:
// the answer no longer depends on the page rendering anything.
if (process.env.NODOM === "1") {
  checks.push([
    "NODOM: answer arrived though the DOM stayed empty (net-only)",
    one.result.ok && (one.result.answer || "").includes("quokka") && (domReplyLen === 0),
  ]);
}
let bad = 0;
for (const [label, pass] of checks) {
  if (!pass) bad++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
}
console.log("=".repeat(64));
console.log(bad === 0 ? "ALL GREEN" : `${bad} FAILURE(S) — the bug reproduces here`);

await context.close();
server.close();
process.exit(bad === 0 ? 0 : 1);
