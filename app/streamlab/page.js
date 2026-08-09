"use client";

// STREAMING LAB
// =============
// The "Your LLM" engine drives a hidden chat tab and reads the answer out of
// its DOM. When it feels slow or non-streaming, the failure is invisible: it
// happens in a background tab, read by the service worker, with no window to
// watch. This page drags the whole mechanism into the open.
//
// The left panel is a FAKE chat that streams tokens into the DOM exactly the
// way ChatGPT does — one growing assistant node, a "stop" button that shows
// while it is generating and disappears when done. The right panel runs the
// two ways of reading it AT THE SAME TIME, against the same DOM:
//
//   A. POLL — what the extension does today: read innerText every 250ms.
//   B. OBSERVE — a MutationObserver that fires the instant the DOM changes.
//
// Each reader timestamps every change it sees, so the lag is a number on the
// screen, not a feeling. The "throttle like a background tab" switch replaces
// the stream's animation-frame pump with a 1s-clamped timer — the real Chrome
// behaviour for a hidden, silent tab — so you can watch polling fall apart and
// see whether the reader keeps up.
//
// There is also a REAL stream from the gateway (the API engine's actual pipe)
// so the smooth, instant baseline is right there to compare against.

import { useEffect, useRef, useState } from "react";

// ---- the extension's ACTUAL read function, verbatim -------------------------
// Copied from ambient-explainer-extension/llm.js so the lab tests the real
// thing. If this and the extension ever drift, that is the bug, not the lab.
function pageRead(root, selectors, baseline) {
  const replies = root.querySelectorAll(selectors.reply.join(","));
  const busy = selectors.busy.some((sel) => {
    const el = root.querySelector(sel);
    return el && el.getClientRects().length;
  });
  if (replies.length <= baseline) return { text: "", busy, replies: replies.length };
  const last = replies[replies.length - 1];
  return { text: (last.innerText || "").trim(), busy, replies: replies.length };
}

const SELECTORS = { reply: [".reply"], busy: ["#stop"] };

export default function StreamLab() {
  const chatRef = useRef(null);
  const stopRef = useRef(null);

  const [throttle, setThrottle] = useState(false);
  const [running, setRunning] = useState(false);
  const [pollLog, setPollLog] = useState([]);
  const [obsLog, setObsLog] = useState([]);
  const [summary, setSummary] = useState(null);

  const streamStateRef = useRef(null);

  // ---- the fake chat: stream tokens into the DOM like a real chat UI --------
  function startFakeAnswer() {
    const chat = chatRef.current;
    if (!chat || running) return;

    setPollLog([]);
    setObsLog([]);
    setSummary(null);
    setRunning(true);

    // Fresh assistant node, and the stop button appears — exactly ChatGPT's shape.
    const reply = document.createElement("div");
    reply.className = "reply";
    chat.appendChild(reply);
    stopRef.current.style.display = "inline-block";

    const words =
      "A quokka is a small marsupial about the size of a domestic cat found on a few islands off the coast of Western Australia and famous for appearing to smile in photographs it is a herbivore mostly nocturnal and has become an accidental icon of wildlife selfies".split(
        " ",
      );

    const tokenTimes = [];
    let i = 0;
    const emit = () => {
      if (i >= words.length) {
        stopRef.current.style.display = "none";
        streamStateRef.current.done = true;
        return;
      }
      reply.textContent += (i ? " " : "") + words[i];
      tokenTimes.push({ i, at: performance.now(), text: reply.textContent });
      i++;
      schedule();
    };

    // The pump. Un-throttled: requestAnimationFrame, ~60/s, like a foreground
    // tab. Throttled: a 1s-clamped timer, like Chrome starving a hidden tab —
    // the whole answer still arrives, just in slow, lumpy steps.
    const schedule = () => {
      if (throttle) setTimeout(emit, 1000);
      else requestAnimationFrame(emit);
    };

    streamStateRef.current = { tokenTimes, done: false, startedAt: performance.now() };
    schedule();
  }

  // ---- the two readers, running together against that same DOM -------------
  useEffect(() => {
    if (!running) return;
    const chat = chatRef.current;
    const started = performance.now();
    let baseline = chat.querySelectorAll(".reply").length - 1; // before this answer
    if (baseline < 0) baseline = 0;

    let lastPollText = "";
    const pollSeen = [];
    // A. POLL every 250ms — the current extension mechanism.
    const poller = setInterval(() => {
      const read = pageRead(chat, SELECTORS, baseline);
      if (read.text !== lastPollText) {
        lastPollText = read.text;
        pollSeen.push({ at: performance.now() - started, chars: read.text.length });
        setPollLog((l) => [...l, { at: Math.round(performance.now() - started), chars: read.text.length, busy: read.busy }]);
      }
    }, 250);

    // B. OBSERVE — fire the moment the DOM changes.
    let lastObsText = "";
    const obsSeen = [];
    const observer = new MutationObserver(() => {
      const read = pageRead(chat, SELECTORS, baseline);
      if (read.text !== lastObsText) {
        lastObsText = read.text;
        obsSeen.push({ at: performance.now() - started, chars: read.text.length });
        setObsLog((l) => [...l, { at: Math.round(performance.now() - started), chars: read.text.length, busy: read.busy }]);
      }
    });
    observer.observe(chat, { childList: true, characterData: true, subtree: true });

    // Stop both once the answer is done and settled.
    const settle = setInterval(() => {
      const st = streamStateRef.current;
      if (!st || !st.done) return;
      // Give each reader a beat to catch the final token.
      setTimeout(() => {
        clearInterval(poller);
        observer.disconnect();
        clearInterval(settle);
        setRunning(false);

        // Latency = when a reader first saw the FINAL length, minus when the
        // fake chat actually wrote it. This is the number that matters.
        const tokens = st.tokenTimes;
        const finalWrittenAt = tokens.length ? tokens[tokens.length - 1].at - st.startedAt : 0;
        const firstFull = (seen) => {
          const finalChars = tokens.length ? tokens[tokens.length - 1].text.length : 0;
          const hit = seen.find((s) => s.chars >= finalChars);
          return hit ? Math.round(hit.at) : null;
        };
        setSummary({
          tokens: tokens.length,
          finalWrittenAt: Math.round(finalWrittenAt),
          pollUpdates: pollSeen.length,
          obsUpdates: obsSeen.length,
          pollDoneAt: firstFull(pollSeen),
          obsDoneAt: firstFull(obsSeen),
        });
      }, 400);
    }, 120);

    return () => {
      clearInterval(poller);
      observer.disconnect();
      clearInterval(settle);
    };
  }, [running]);

  // ---- a real gateway stream, for the smooth baseline ----------------------
  const [realText, setRealText] = useState("");
  const [realState, setRealState] = useState("idle");
  async function realStream() {
    setRealText("");
    setRealState("streaming");
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "In two sentences, what is a quokka?" }],
          stream: true,
        }),
      });
      if (!res.ok || !res.body) {
        setRealText(`(request failed: ${res.status})`);
        setRealState("idle");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
            if (delta) setRealText((t) => t + delta);
          } catch (_) {}
        }
      }
    } catch (e) {
      setRealText(`(error: ${String(e).slice(0, 80)})`);
    }
    setRealState("idle");
  }

  return (
    <main style={S.page}>
      <h1 style={S.h1}>Streaming lab</h1>
      <p style={S.sub}>
        The exact read code from the extension, running in the open. Start an answer and watch
        the two readers race against the same streaming DOM. Flip the throttle to simulate a
        hidden background tab.
      </p>

      <div style={S.controls}>
        <button style={running ? S.btnOff : S.btn} onClick={startFakeAnswer} disabled={running}>
          {running ? "Streaming…" : "Start a fake answer"}
        </button>
        <label style={S.check}>
          <input type="checkbox" checked={throttle} onChange={(e) => setThrottle(e.target.checked)} disabled={running} />
          Throttle like a background tab (1s pump)
        </label>
      </div>

      <div style={S.grid}>
        {/* The fake chat DOM being read */}
        <section style={S.panel}>
          <h2 style={S.h2}>The chat DOM</h2>
          <div ref={chatRef} style={S.chat} />
          <button ref={stopRef} id="stop" style={S.stop}>■ stop</button>
        </section>

        {/* Poll reader */}
        <section style={S.panel}>
          <h2 style={S.h2}>A · Poll every 250ms <span style={S.tag}>current</span></h2>
          <Log rows={pollLog} />
        </section>

        {/* Observer reader */}
        <section style={S.panel}>
          <h2 style={S.h2}>B · MutationObserver <span style={{ ...S.tag, background: "#1f6f43" }}>proposed</span></h2>
          <Log rows={obsLog} />
        </section>
      </div>

      {summary && (
        <div style={S.summary}>
          <strong>Result.</strong> {summary.tokens} tokens, last one written at{" "}
          {summary.finalWrittenAt}ms.
          {" "}Polling saw <b>{summary.pollUpdates}</b> updates and reached the full answer at{" "}
          <b>{summary.pollDoneAt ?? "never"}ms</b>. The observer saw <b>{summary.obsUpdates}</b>{" "}
          updates and reached it at <b>{summary.obsDoneAt ?? "never"}ms</b>.
          {throttle && (
            <span style={{ color: "#b5651d" }}>
              {" "}With the tab throttled, polling every 250ms lands between the 1s pumps and
              re-reads the same text, so the update count collapses — exactly the “it doesn’t
              stream” report.
            </span>
          )}
        </div>
      )}

      <section style={{ ...S.panel, marginTop: 28 }}>
        <h2 style={S.h2}>The real thing · gateway SSE <span style={{ ...S.tag, background: "#333" }}>API engine</span></h2>
        <p style={S.note}>
          This is the API engine’s actual pipe — a live token stream from the gateway, no tab,
          no polling. It is what “streaming” should feel like.
        </p>
        <button style={realState === "streaming" ? S.btnOff : S.btn} onClick={realStream} disabled={realState === "streaming"}>
          {realState === "streaming" ? "Streaming…" : "Stream from the gateway"}
        </button>
        <div style={{ ...S.chat, marginTop: 12, minHeight: 60 }}>{realText}</div>
      </section>
    </main>
  );
}

function Log({ rows }) {
  return (
    <div style={S.log}>
      {rows.length === 0 && <div style={{ opacity: 0.4 }}>waiting…</div>}
      {rows.map((r, i) => (
        <div key={i} style={S.logRow}>
          <span style={{ color: "#888" }}>{String(r.at).padStart(5)}ms</span>{" "}
          <span>{r.chars} chars</span>{" "}
          {r.busy ? <span style={{ color: "#b5651d" }}>busy</span> : <span style={{ color: "#1f6f43" }}>idle</span>}
        </div>
      ))}
    </div>
  );
}

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
const S = {
  page: { maxWidth: 1100, margin: "0 auto", padding: "40px 24px", fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "#1a1a1a" },
  h1: { fontSize: 30, margin: "0 0 8px", letterSpacing: "-0.02em" },
  sub: { color: "#555", margin: "0 0 20px", maxWidth: 720, lineHeight: 1.5 },
  controls: { display: "flex", gap: 18, alignItems: "center", marginBottom: 20, flexWrap: "wrap" },
  btn: { background: "#111", color: "#fff", border: "none", borderRadius: 9, padding: "10px 18px", fontSize: 15, cursor: "pointer" },
  btnOff: { background: "#bbb", color: "#fff", border: "none", borderRadius: 9, padding: "10px 18px", fontSize: 15, cursor: "default" },
  check: { display: "flex", gap: 8, alignItems: "center", fontSize: 14, color: "#444" },
  grid: { display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr", gap: 16 },
  panel: { border: "1px solid #e3ddd6", borderRadius: 12, padding: 16, background: "#fbf9f7" },
  h2: { fontSize: 14, margin: "0 0 10px", display: "flex", gap: 8, alignItems: "center" },
  tag: { fontSize: 11, fontWeight: 600, color: "#fff", background: "#8a6d3b", borderRadius: 5, padding: "2px 6px" },
  chat: { minHeight: 120, background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: 12, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" },
  stop: { display: "none", marginTop: 10, background: "#eee", border: "1px solid #ddd", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "default" },
  log: { fontFamily: mono, fontSize: 12, maxHeight: 220, overflowY: "auto", lineHeight: 1.7 },
  logRow: { whiteSpace: "nowrap" },
  summary: { marginTop: 20, padding: 16, background: "#f3efe9", borderRadius: 10, fontSize: 14, lineHeight: 1.6 },
  note: { color: "#666", fontSize: 13, margin: "0 0 12px" },
};
