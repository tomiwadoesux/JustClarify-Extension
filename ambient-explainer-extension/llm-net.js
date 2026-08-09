// llm-net.js — read the answer from the NETWORK, not the screen.
//
// The problem this finally solves: a hidden tab does not render. Chrome starves
// its timers and freezes its paint, so the chat page never WRITES the streamed
// answer into the DOM until you look at it — and no amount of reading the DOM
// harder can read text that was never written. Every earlier fix was fighting
// the browser's power management and losing.
//
// This stops watching the screen. When a chat page generates an answer, its tab
// holds an open HTTP stream to the provider's servers and tokens flow down it
// continuously. That network delivery is NOT throttled the way rendering is —
// an in-flight response keeps arriving whether the tab is hidden, collapsed,
// unpainted or frozen, because the data was already requested and the socket is
// already open. So we tee that stream and read the tokens ourselves, before the
// page has done anything with them. It never matters again whether the page
// draws.
//
// This is the same idea the "Claude" browser extension uses via chrome.debugger
// — read the data, not the pixels — minus the permanent "started debugging this
// browser" banner, because we do it from inside the page instead of from the
// devtools protocol.
//
// Runs in the MAIN world at document_start (so it wraps fetch BEFORE the page
// grabs its own reference), on the provider hosts, and is INERT on any tab that
// is not the one JustClarify is driving — the same jcDrive stamp the keepalive
// script gates on. A user's own ChatGPT tab is never touched.
//
// The trigger is format-agnostic: any Server-Sent-Events stream on the driven
// tab. Only the token EXTRACTION is provider-shaped, and it covers the shapes
// ChatGPT, Claude and OpenAI-compatible endpoints use, with a longest-wins
// safety so a misread can only ever show less, never wrong.

(function () {
  const html = document.documentElement;
  // Read at call time, never cached: the stamp is applied a moment after this
  // script runs. On a non-driven tab this is forever false, so fetch is a pure
  // passthrough and nothing here changes the page's behaviour at all.
  const driving = () => html && html.dataset && html.dataset.jcDrive === "1";

  const origFetch = window.fetch;
  if (typeof origFetch !== "function") return;

  function post(text, done) {
    try {
      window.postMessage({ __jcNet: true, text: text || "", done: !!done }, "*");
    } catch (_) {}
  }

  // Pull readable text out of one parsed SSE event. Two families:
  //   append  — a delta to add on (OpenAI chat, Anthropic content_block_delta)
  //   replace — the whole answer so far (ChatGPT web `parts`, older `completion`)
  // Returning both and letting the reader take the longer means that even if a
  // provider changes which family it uses, the worst case is we show what we
  // can rather than something wrong.
  function extract(obj) {
    if (!obj || typeof obj !== "object") return null;

    let append = null;
    const choice = obj.choices && obj.choices[0];
    if (choice && choice.delta && typeof choice.delta.content === "string") {
      append = choice.delta.content;
    } else if (obj.delta && typeof obj.delta.text === "string") {
      append = obj.delta.text; // Anthropic content_block_delta
    } else if (obj.type === "text" && typeof obj.text === "string" && obj.stream) {
      append = obj.text;
    }

    let replace = null;
    const parts = obj.message && obj.message.content && obj.message.content.parts;
    // Assistant messages only. A brand-new ?q= conversation streams the USER
    // message down the same pipe first, complete with its parts — and taking
    // those echoed the entire prompt into the answer card on the first ask.
    const author = obj.message && obj.message.author && obj.message.author.role;
    if (Array.isArray(parts) && (!author || author === "assistant")) {
      replace = parts.filter((p) => typeof p === "string").join("");
    } else if (typeof obj.completion === "string") {
      replace = obj.completion; // older claude.ai: cumulative
    } else if (!append && typeof obj.text === "string") {
      replace = obj.text;
    }

    return append || replace ? { append, replace } : null;
  }

  // ChatGPT's web client stopped streaming whole-message snapshots. It now
  // streams a JSON-patch delta: an initial `{"o":"add","v":{message…}}`, then a
  // run of `{"o":"append","p":"/message/content/parts/0","v":"…"}`, and — once a
  // path has been named — BARE `{"v":"…"}` continuations that inherit it.
  // `extract` above recognises none of those shapes, so it returned null for
  // every single event and the network read (the PRIMARY answer source)
  // silently produced nothing: measured as netChars:0 for a whole run while the
  // answer streamed normally on screen.
  //
  // Stateful, because those bare continuations only make sense against the last
  // path seen. Anything not aimed at the answer's own text — metadata, thoughts,
  // tool calls — is ignored rather than guessed at, so a misread shows less and
  // never shows something wrong.
  function makeDeltaReader() {
    let path = "";
    // Whose message the stream is currently building. On a brand-new ?q=
    // conversation the FIRST snapshot down the pipe is the user's own message —
    // prompt and all — and reading its parts is what made the first ask render
    // the prompt back as the answer. Only assistant text is ever ours to take;
    // an unknown role is allowed through so a shape change degrades to the old
    // behaviour rather than to silence.
    let role = "";
    const isAnswerPath = (p) => /\/message\/content\/parts\/\d+$/.test(p || "");

    return function apply(obj) {
      if (!obj || typeof obj !== "object") return "";

      // A batch of ops delivered as one event. Each carries its own path, and
      // the batch is ATOMIC: a metadata op sitting last inside it must not
      // become the path that the next bare {"v":"…"} continuation inherits.
      // Letting it leak truncated the answer at whatever token preceded the
      // batch, which is a silent, partial, entirely plausible-looking result —
      // the worst kind to ship.
      if (obj.o === "patch" && Array.isArray(obj.v)) {
        const outer = path;
        const text = obj.v.map(apply).join("");
        path = outer;
        return text;
      }

      if (typeof obj.p === "string") path = obj.p;

      // The opening snapshot carries the message itself. Usually its parts are
      // empty at this point, but taking them costs nothing and covers a stream
      // we joined late.
      if (obj.v && typeof obj.v === "object" && !Array.isArray(obj.v)) {
        const message = obj.v.message || obj.v;
        const author = message && message.author && message.author.role;
        if (typeof author === "string" && author) role = author;
        if (role && role !== "assistant") return "";
        const parts = message && message.content && message.content.parts;
        return Array.isArray(parts) ? parts.filter((p) => typeof p === "string").join("") : "";
      }

      if (typeof obj.v !== "string") return "";
      if (role && role !== "assistant") return "";
      if (!isAnswerPath(path)) return "";
      // An explicit op other than append (replace, remove) is not ours to guess at.
      if (obj.o && obj.o !== "append") return "";
      return obj.v;
    };
  }

  async function readStream(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let appended = "";
    let replaced = "";
    const best = () => (appended.length >= replaced.length ? appended : replaced);
    const delta = makeDeltaReader();

    try {
      for (;;) {
        // This await resolves on NETWORK arrival, not a timer — which is why it
        // keeps advancing in a backgrounded tab where setTimeout is clamped to
        // once a second. That is the whole trick.
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop();
        let grew = false;
        for (const raw of lines) {
          const line = raw.trim();
          if (!line || line.startsWith(":")) continue; // SSE comment/keepalive
          const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
          if (!payload || payload === "[DONE]") continue;
          let obj;
          try {
            obj = JSON.parse(payload);
          } catch (_) {
            continue; // not JSON — some providers send bare tokens; ignored
          }
          const got = extract(obj);
          if (!got) {
            // None of the classic shapes matched — try the delta protocol.
            // Only ever reached when `extract` found nothing, so the two can
            // never both count the same token.
            const added = delta(obj);
            if (added) {
              appended += added;
              grew = true;
            }
            continue;
          }
          if (got.append) {
            appended += got.append;
            grew = true;
          }
          if (got.replace && got.replace.length > replaced.length) {
            replaced = got.replace;
            grew = true;
          }
        }
        if (grew) post(best(), false);
      }
    } catch (_) {
      // A read error just ends our copy; the page still has its own branch, and
      // the worker's DOM poll is still there as the backstop.
    }
    post(best(), true);
  }

  window.fetch = function (...args) {
    const pending = origFetch.apply(this, args);
    if (!driving()) return pending;
    return pending.then((res) => {
      try {
        const ct =
          (res.headers && res.headers.get && res.headers.get("content-type")) || "";
        // Any streamed event feed on the driven tab is a candidate. No URL
        // patterns to keep up to date — SSE is SSE.
        if (!/text\/event-stream|application\/x-ndjson/i.test(ct) || !res.body) {
          return res;
        }
        // Tee: one branch flows back to the page exactly as before, the other
        // is ours. The page never notices.
        const [toPage, toUs] = res.body.tee();
        readStream(toUs);
        return new Response(toPage, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        });
      } catch (_) {
        return res; // anything unexpected: leave the page's fetch untouched
      }
    });
  };
})();
