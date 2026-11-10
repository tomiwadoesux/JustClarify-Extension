"use client";

// The student interview. Built for a phone held in one hand.
//
// Four screens: a gate (what this is, what is kept, two ticks), the chat, an
// ending, and "closed". All the decisions are made on the server; this file
// shows what the server says and never decides when an interview is over.
//
// Layout notes, because each one is a bug that was designed out:
//   The page is a fixed-height column and the message list is the ONLY thing
//     that scrolls. It carries data-lenis-prevent so the site-wide smooth
//     scroll (components/smooth-scroll.js) leaves it alone on desktop.
//   The height follows window.visualViewport, not 100dvh. On iOS the on-screen
//     keyboard does not shrink dvh, so without this the answer box sits under
//     the keyboard.
//   The answer box is 16px. Anything smaller makes iOS zoom the whole page on
//     focus.
//   No analytics component here. The consent screen says what is collected,
//     and the honest way to keep that true is to add nothing else.

import { useEffect, useRef, useState } from "react";
import { GATE, ERRORS, UI, CONTACT_EMAIL } from "@/lib/interview/copy.mjs";
import { LIMITS } from "@/lib/interview/config.mjs";
import { recordingSupported, startRecording, fileNameFor } from "./recorder";

const STORE_KEY = "jcInterview";

function loadSaved() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved && typeof saved === "object") return saved;
  } catch (_) {}
  return null;
}

function save(state) {
  try {
    if (state) sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(STORE_KEY);
  } catch (_) {}
}

function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function Diamond() {
  return (
    <span className="inline-flex" style={{ color: "var(--accent, oklch(0.56 0.10 28))" }} aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect x="5" y="5" width="14" height="14" rx="3.5" transform="rotate(45 12 12)" fill="currentColor" />
        <rect x="9" y="9" width="6" height="6" rx="1.6" transform="rotate(45 12 12)" fill="#fff" />
      </svg>
    </span>
  );
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function InterviewPage() {
  const [phase, setPhase] = useState("loading"); // loading | closed | gate | chat | end
  const [closedNote, setClosedNote] = useState(GATE.closed);
  const [link, setLink] = useState("");
  const [consent, setConsent] = useState(false);
  const [adult, setAdult] = useState(false);
  const [hp, setHp] = useState("");
  const [starting, setStarting] = useState(false);

  const [session, setSession] = useState(null); // { token, turn, maxTurns, deadlineAt }
  const [messages, setMessages] = useState([]); // { role: 'ai' | 'me', text }
  const [draft, setDraft] = useState("");
  const [draftVia, setDraftVia] = useState("typed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ending, setEnding] = useState(null); // { kind, message, ref }
  const [confirmStop, setConfirmStop] = useState(false);

  const [canRecord, setCanRecord] = useState(false);
  const [rec, setRec] = useState("idle"); // idle | recording | transcribing
  const [recSeconds, setRecSeconds] = useState(0);
  const [recLevel, setRecLevel] = useState(0);
  const [now, setNow] = useState(0);

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const recorderRef = useRef(null);
  const rootRef = useRef(null);

  // First load: pick up the invite code, resume a session if this tab has
  // one, otherwise ask the server whether the interview is open.
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const code = new URLSearchParams(window.location.search).get("c") || "";
      const saved = loadSaved();
      const supported = recordingSupported();
      if (saved?.ending) {
        if (cancelled) return;
        setCanRecord(supported);
        setMessages(saved.messages || []);
        setEnding(saved.ending);
        setPhase("end");
        return;
      }
      if (saved?.session?.token) {
        if (cancelled) return;
        setCanRecord(supported);
        setLink(code);
        setSession(saved.session);
        setMessages(saved.messages || []);
        setNow(Date.now());
        setPhase("chat");
        return;
      }
      let open = false;
      try {
        const res = await fetch("/api/interview/start", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        open = res.ok && data.open === true;
      } catch (_) {}
      if (cancelled) return;
      setCanRecord(supported);
      setLink(code);
      setPhase(open ? "gate" : "closed");
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the column the height of what is actually visible, keyboard included.
  useEffect(() => {
    const viewport = window.visualViewport;
    function fit() {
      const height = viewport ? viewport.height : window.innerHeight;
      if (rootRef.current) rootRef.current.style.height = `${Math.round(height)}px`;
      // iOS scrolls the page up to reveal a focused field; put it back.
      if (window.scrollY) window.scrollTo(0, 0);
    }
    fit();
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    return () => {
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, []);

  // One clock for the countdown, only while there is something to count.
  useEffect(() => {
    if (phase !== "chat") return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // Survive a reload: the token and what has been said so far.
  useEffect(() => {
    if (phase === "chat" && session) save({ session, messages });
    if (phase === "end" && ending) save({ ending, messages });
  }, [phase, session, messages, ending]);

  // Newest message in view. scrollTop on the list, never scrollIntoView, which
  // would scroll the page and fight the keyboard handling above.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, busy, rec, error, phase]);

  // Never leave a microphone open behind a closed page.
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
    };
  }, []);

  function finish(kind, message, ref) {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRec("idle");
    setEnding({ kind, message, ref: ref || null });
    setSession(null);
    setPhase("end");
  }

  async function start() {
    if (starting) return;
    setError("");
    setStarting(true);
    try {
      const res = await fetch("/api/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent, adult, link, hp }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        setSession({
          token: data.token,
          turn: data.turn,
          maxTurns: data.maxTurns,
          deadlineAt: data.deadlineAt,
        });
        setMessages([{ role: "ai", text: data.question.text }]);
        setNow(Date.now());
        setPhase("chat");
      } else if (data.closed) {
        setClosedNote(data.error || GATE.closed);
        setPhase("closed");
      } else {
        setError(data.error || ERRORS.generic);
      }
    } catch (_) {
      setError(ERRORS.generic);
    } finally {
      setStarting(false);
    }
  }

  // The server said which turn it is on. Trust it over what this tab thinks.
  function resync(data) {
    setSession((current) => (current ? { ...current, turn: data.turn } : current));
    setMessages((current) => {
      const lastAi = [...current].reverse().find((m) => m.role === "ai");
      if (lastAi?.text === data.question?.text) return current;
      return [...current, { role: "ai", text: data.question.text }];
    });
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy || !session) return;
    const via = draftVia;
    setError("");
    setBusy(true);
    setDraft("");
    setDraftVia("typed");
    setMessages((current) => [...current, { role: "me", text }]);

    // Put the answer back in the box if it was not taken.
    const giveBack = (message) => {
      setMessages((current) => {
        const index = current.map((m) => m.role).lastIndexOf("me");
        return index < 0 ? current : current.filter((_, i) => i !== index);
      });
      setDraft(text);
      setDraftVia(via);
      setError(message);
    };

    try {
      const res = await fetch("/api/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: session.token, turn: session.turn, text, via }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === "question") {
        setSession((current) => (current ? { ...current, turn: data.turn } : current));
        setMessages((current) => [...current, { role: "ai", text: data.question.text }]);
      } else if (res.ok && data.status) {
        finish(data.status, data.message, data.ref);
      } else if (res.status === 409 && data.question) {
        resync(data);
      } else if (res.status === 401) {
        finish("ended", data.error || ERRORS.session, null);
      } else if (res.status === 503 && data.closed) {
        finish("ended", data.error || GATE.full, null);
      } else {
        giveBack(data.error || ERRORS.generic);
      }
    } catch (_) {
      giveBack(ERRORS.generic);
    } finally {
      setBusy(false);
    }
  }

  async function stopInterview() {
    setConfirmStop(false);
    if (!session) return;
    setBusy(true);
    try {
      const res = await fetch("/api/interview/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: session.token, end: true }),
      });
      const data = await res.json().catch(() => ({}));
      finish("ended", data.message || ERRORS.session, data.ref);
    } catch (_) {
      setError(ERRORS.generic);
    } finally {
      setBusy(false);
    }
  }

  async function upload(blob) {
    recorderRef.current = null;
    if (!session) return;
    if (!blob || blob.size < 1500) {
      setRec("idle");
      setError(ERRORS.audioBad);
      return;
    }
    setRec("transcribing");
    try {
      const form = new FormData();
      form.append("token", session.token);
      form.append("turn", String(session.turn));
      form.append("audio", blob, fileNameFor(blob));
      const res = await fetch("/api/interview/transcribe", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.text) {
        setDraft((current) => (current.trim() ? `${current.trim()} ${data.text}` : data.text));
        setDraftVia("voice");
        setError("");
        setTimeout(() => inputRef.current?.focus(), 0);
      } else if (res.status === 409 && data.question) {
        resync(data);
      } else if (res.status === 401) {
        finish("ended", data.error || ERRORS.session, null);
      } else {
        setError(data.error || ERRORS.audioBad);
      }
    } catch (_) {
      setError(ERRORS.audioBad);
    } finally {
      setRec("idle");
    }
  }

  async function record() {
    if (rec !== "idle" || busy) return;
    setError("");
    setRecSeconds(0);
    setRecLevel(0);
    try {
      recorderRef.current = await startRecording({
        maxSeconds: LIMITS.maxNoteSeconds,
        onTick: setRecSeconds,
        onLevel: setRecLevel,
        onAutoStop: upload,
      });
      setRec("recording");
    } catch (_) {
      recorderRef.current = null;
      setRec("idle");
      setError(UI.micBlocked);
    }
  }

  async function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const blob = await recorder.stop();
    upload(blob);
  }

  function cancelRecording() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRec("idle");
  }

  const remaining = session ? new Date(session.deadlineAt).getTime() - now : 0;
  const nearlyUp = phase === "chat" && now > 0 && remaining <= 30_000;
  const canStart = consent && adult && !starting;

  return (
    <div
      ref={rootRef}
      className="fixed inset-x-0 top-0 flex h-[100dvh] flex-col bg-[#faf9f7] text-[#14110f]"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#ece7e3] px-4 py-3">
        <div className="flex items-center gap-2">
          <Diamond />
          <span className="text-[15px] font-bold tracking-[-0.01em]">JustClarify</span>
          <span className="rounded-full bg-[#14110f]/[0.06] px-2 py-0.5 text-[11px] font-semibold text-[#6d645d]">
            {UI.brandTag}
          </span>
        </div>
        {phase === "chat" && session ? (
          <div className="flex items-center gap-3 text-[12px] font-semibold text-[#6d645d]">
            <span>{UI.progress(Math.min(session.turn, session.maxTurns), session.maxTurns)}</span>
            <span
              className={`tabular-nums ${nearlyUp ? "text-[#b3261e]" : ""}`}
              aria-label="Time left"
            >
              {now > 0 ? clock(remaining) : ""}
            </span>
          </div>
        ) : null}
      </header>

      {phase === "loading" ? (
        <main className="flex flex-1 items-center justify-center text-[14px] text-[#6d645d]">
          {UI.loading}
        </main>
      ) : null}

      {phase === "closed" ? (
        <main className="flex flex-1 items-center justify-center px-6">
          <p className="max-w-sm text-center text-[16px] leading-relaxed text-[#3d3731]">{closedNote}</p>
        </main>
      ) : null}

      {phase === "gate" ? (
        <main className="flex-1 overflow-y-auto overscroll-contain px-5 py-6" data-lenis-prevent>
          <div className="mx-auto max-w-md">
            <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">{GATE.title}</h1>
            <p className="mt-3 text-[16px] leading-relaxed text-[#3d3731]">{GATE.intro}</p>

            <p className="mt-5 rounded-xl border border-[#14110f]/10 bg-white px-4 py-3 text-[15px] font-medium leading-relaxed">
              {GATE.aiNotice}
            </p>

            <ul className="mt-5 space-y-2.5">
              {GATE.kept.map((line) => (
                <li key={line} className="flex gap-2.5 text-[14px] leading-relaxed text-[#3d3731]">
                  <span
                    className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: "var(--accent)" }}
                    aria-hidden="true"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="mt-6 space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#14110f]/10 bg-white px-4 py-3.5">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0"
                  style={{ accentColor: "var(--accent)" }}
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span className="text-[15px] font-medium">{GATE.consent}</span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#14110f]/10 bg-white px-4 py-3.5">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0"
                  style={{ accentColor: "var(--accent)" }}
                  checked={adult}
                  onChange={(event) => setAdult(event.target.checked)}
                />
                <span className="text-[15px] font-medium">{GATE.adult}</span>
              </label>
            </div>

            {/* A field no person sees or fills in. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute left-[-9999px] h-0 w-0 opacity-0"
              value={hp}
              onChange={(event) => setHp(event.target.value)}
            />

            {error ? (
              <p className="mt-4 text-[14px] font-medium text-[#b3261e]" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={start}
              disabled={!canStart}
              // Near-black, not the accent. The accent is a random colour on
              // every load and white text on its lighter end is hard to read.
              className="mt-6 h-12 w-full rounded-xl bg-[#14110f] text-[16px] font-semibold text-white transition-opacity disabled:opacity-40"
            >
              {starting ? UI.loading : GATE.start}
            </button>

            <p className="mt-4 pb-4 text-center text-[13px] text-[#6d645d]">
              <a className="underline underline-offset-2" href="/privacy-policy" target="_blank" rel="noopener noreferrer">
                {UI.privacy}
              </a>
            </p>
          </div>
        </main>
      ) : null}

      {phase === "chat" || phase === "end" ? (
        <main
          ref={listRef}
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-5"
          data-lenis-prevent
          aria-live="polite"
        >
          <div className="mx-auto flex max-w-xl flex-col gap-3">
            {messages.map((message, index) =>
              message.role === "ai" ? (
                <div
                  key={index}
                  className="max-w-[88%] self-start rounded-2xl rounded-bl-md border border-[#ece7e3] bg-white px-4 py-3 text-[16px] leading-relaxed"
                >
                  {message.text}
                </div>
              ) : (
                <div
                  key={index}
                  className="max-w-[88%] self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-4 py-3 text-[16px] leading-relaxed"
                  style={{ background: "var(--accent-soft)" }}
                >
                  {message.text}
                </div>
              ),
            )}

            {busy && phase === "chat" ? (
              <div
                className="flex items-center gap-1.5 self-start rounded-2xl rounded-bl-md border border-[#ece7e3] bg-white px-4 py-4"
                role="status"
                aria-label={UI.thinking}
              >
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    className="h-1.5 w-1.5 rounded-full bg-[#14110f]/40 motion-safe:animate-pulse"
                    style={{ animationDelay: `${dot * 180}ms` }}
                  />
                ))}
              </div>
            ) : null}

            {phase === "end" && ending ? (
              <div
                className={`mt-2 rounded-2xl border px-5 py-5 ${
                  ending.kind === "support" ? "border-[#14110f]/20 bg-white" : "border-[#ece7e3] bg-white"
                }`}
                role="status"
              >
                <p className="text-[16px] leading-relaxed">{ending.message}</p>
                {ending.ref ? (
                  <div className="mt-4 border-t border-[#ece7e3] pt-4">
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-[#6d645d]">
                      {UI.refLabel}
                    </p>
                    <p className="mt-1 select-all font-mono text-[20px] font-bold tracking-[0.12em]">
                      {ending.ref}
                    </p>
                    <p className="mt-2 text-[13px] leading-relaxed text-[#6d645d]">
                      {UI.deleteNote}{" "}
                      <a className="underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
                        {CONTACT_EMAIL}
                      </a>
                      .
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </main>
      ) : null}

      {phase === "chat" && session ? (
        <footer className="shrink-0 border-t border-[#ece7e3] bg-[#faf9f7] px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2.5">
          <div className="mx-auto max-w-xl">
            {nearlyUp ? (
              <p className="mb-2 px-1 text-[13px] font-medium text-[#b3261e]">{UI.lastAnswer}</p>
            ) : null}
            {error ? (
              <p className="mb-2 px-1 text-[13px] font-medium text-[#b3261e]" role="alert">
                {error}
              </p>
            ) : null}
            {draftVia === "voice" && draft && rec === "idle" ? (
              <p className="mb-2 px-1 text-[13px] text-[#6d645d]">{UI.review}</p>
            ) : null}

            {rec === "recording" ? (
              <div className="rounded-2xl border border-[#14110f]/15 bg-white px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-3 w-3 shrink-0">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-[#b3261e] opacity-60 motion-safe:animate-ping" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-[#b3261e]" />
                  </span>
                  <span className="text-[14px] font-semibold tabular-nums" role="status">
                    {UI.recording} {clock(recSeconds * 1000)}
                  </span>
                  {/* The level bar gets the rest of the row to itself, so on a
                      narrow phone it is still wide enough to read. */}
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#14110f]/10" aria-hidden="true">
                    <span
                      className="block h-full rounded-full transition-[width] duration-100"
                      style={{ width: `${Math.round(recLevel * 100)}%`, background: "var(--accent)" }}
                    />
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={cancelRecording}
                    className="h-11 rounded-xl border border-[#14110f]/15 px-4 text-[14px] font-semibold text-[#3d3731]"
                  >
                    {UI.cancelRecording}
                  </button>
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="h-11 flex-1 rounded-xl bg-[#14110f] px-4 text-[14px] font-semibold text-white"
                  >
                    {UI.stopRecording}
                  </button>
                </div>
              </div>
            ) : rec === "transcribing" ? (
              <div
                className="rounded-2xl border border-[#14110f]/15 bg-white px-4 py-3.5 text-[14px] font-medium text-[#6d645d] motion-safe:animate-pulse"
                role="status"
              >
                {UI.transcribing}
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value.slice(0, LIMITS.maxAnswerChars));
                    if (!event.target.value) setDraftVia("typed");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send();
                  }}
                  rows={draft.length > 90 || draft.includes("\n") ? 4 : 2}
                  placeholder={UI.placeholder}
                  aria-label={UI.placeholder}
                  disabled={busy}
                  className="min-h-[52px] flex-1 resize-none rounded-2xl border border-[#14110f]/15 bg-white px-4 py-3 text-[16px] leading-snug outline-none placeholder:text-[#6d645d]/70 focus:border-[#14110f]/40 disabled:opacity-60"
                />
                {canRecord && !draft.trim() ? (
                  <button
                    type="button"
                    onClick={record}
                    disabled={busy}
                    aria-label={UI.record}
                    title={UI.record}
                    className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl text-white disabled:opacity-40"
                    style={{ background: "var(--accent)" }}
                  >
                    <MicIcon />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={send}
                    disabled={busy || !draft.trim()}
                    aria-label={UI.send}
                    title={UI.send}
                    className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl text-white disabled:opacity-40"
                    style={{ background: "var(--accent)" }}
                  >
                    <SendIcon />
                  </button>
                )}
              </div>
            )}

            <div className="mt-2 flex h-8 items-center justify-center text-[12px] text-[#6d645d]">
              {confirmStop ? (
                <span className="flex items-center gap-3">
                  <span>{UI.stopConfirm}</span>
                  <button type="button" onClick={stopInterview} className="font-semibold text-[#b3261e] underline underline-offset-2">
                    {UI.stopYes}
                  </button>
                  <button type="button" onClick={() => setConfirmStop(false)} className="font-semibold underline underline-offset-2">
                    {UI.stopNo}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmStop(true)}
                  disabled={busy || rec !== "idle"}
                  className="underline underline-offset-2 disabled:opacity-40"
                >
                  {UI.stopLink}
                </button>
              )}
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
