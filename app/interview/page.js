"use client";

// The student interview. Built for a phone held in one hand.
//
// It looks like shadcn/ui's AI chat (a conversation, messages, a prompt input
// with tools, suggestion pills) because that is a layout students already know
// how to use. The pieces are in ./ui.js and their styling in ./interview.css.
//
// Four screens: a gate (what this is, what is kept, two ticks), the chat, an
// ending, and "closed". All the decisions are made on the server; this file
// shows what the server says and never decides when an interview is over.
//
// Layout notes, because each one is a bug that was designed out:
//   The page is a fixed-height column and the conversation is the ONLY thing
//     that scrolls. It carries data-lenis-prevent so the site-wide smooth
//     scroll (components/smooth-scroll.js) leaves it alone on desktop.
//   The height follows window.visualViewport, not 100dvh. On iOS the on-screen
//     keyboard does not shrink dvh, so without this the answer box sits under
//     the keyboard.
//   The answer box is 16px. Anything smaller makes iOS zoom the whole page on
//     focus.
//   No analytics component here. The consent screen says what is collected,
//     and the honest way to keep that true is to add nothing else.
//
// Two things here exist to help a student answer, and both are deliberately
// limited so they do not answer FOR the student (see STARTERS in copy.mjs):
//   The answer box types out ways to begin a sentence, and offers the same
//     openers as buttons.
//   While a voice note records, the line under the waveform changes after a
//     few seconds to say the page is still listening.

import { useEffect, useRef, useState } from "react";
import { GATE, ERRORS, UI, CONTACT_EMAIL, listeningLine } from "@/lib/interview/copy.mjs";
import { LIMITS } from "@/lib/interview/config.mjs";
import { recordingSupported, startRecording, fileNameFor } from "./recorder";
import {
  Button,
  Checkbox,
  Progress,
  Message,
  Shimmer,
  Swap,
  TypedStarters,
  Waveform,
  Diamond,
  MicIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CheckIcon,
  BotIcon,
} from "./ui";
import "./interview.css";

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

// A starter becomes the beginning of the answer: "I pay for…" -> "I pay for ".
function starterText(starter) {
  return `${String(starter).replace(/…$/, "").trimEnd()} `;
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
  const [starters, setStarters] = useState([]);
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
  const [atBottom, setAtBottom] = useState(true);

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
        setStarters(saved.starters || []);
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
    if (phase === "chat" && session) save({ session, messages, starters });
    if (phase === "end" && ending) save({ ending, messages });
  }, [phase, session, messages, starters, ending]);

  // Newest message in view. scrollTop on the list, never scrollIntoView, which
  // would scroll the page and fight the keyboard handling above.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, busy, phase]);

  // Grow the answer box with its text, up to the cap set in the stylesheet.
  useEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, [draft, rec, phase]);

  // Never leave a microphone open behind a closed page.
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
    };
  }, []);

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    setAtBottom(list.scrollHeight - list.scrollTop - list.clientHeight < 48);
  }

  function scrollDown() {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }

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
        setStarters(data.question.starters || []);
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
    setStarters(data.question?.starters || []);
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
        setStarters(data.question.starters || []);
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

  function applyStarter(starter) {
    setDraft(starterText(starter));
    setDraftVia("typed");
    setError("");
    // After the box has the text, put the caret at the end of it.
    setTimeout(() => {
      const box = inputRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }, 0);
  }

  const remaining = session ? new Date(session.deadlineAt).getTime() - now : 0;
  const nearlyUp = phase === "chat" && now > 0 && remaining <= 30_000;
  const canStart = consent && adult && !starting;
  const showStarters = rec === "idle" && !draft && !busy && starters.length > 0;
  const turnKey = session ? session.turn : 0;

  return (
    <div ref={rootRef} className="iv fixed inset-x-0 top-0 flex h-[100dvh] flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--iv-border)] px-4">
        <div className="flex items-center gap-2">
          <Diamond />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">JustClarify</span>
          <span className="iv-badge">{UI.brandTag}</span>
        </div>
        {phase === "chat" && session ? (
          <div className="flex items-center gap-3">
            <Progress
              value={Math.min(session.turn, session.maxTurns)}
              max={session.maxTurns}
              label={UI.progress(Math.min(session.turn, session.maxTurns), session.maxTurns)}
            />
            <span className="iv-time" data-low={nearlyUp} aria-label="Time left">
              {now > 0 ? clock(remaining) : ""}
            </span>
          </div>
        ) : null}
      </header>

      {phase === "loading" ? (
        <main className="flex flex-1 items-center justify-center">
          <Shimmer>{UI.loading}</Shimmer>
        </main>
      ) : null}

      {phase === "closed" ? (
        <main className="flex flex-1 items-center justify-center px-6">
          <p className="iv-rise max-w-sm text-center text-[16px] leading-relaxed text-[var(--iv-muted-fg)]">
            {closedNote}
          </p>
        </main>
      ) : null}

      {phase === "gate" ? (
        <main className="iv-conversation px-5 py-8" data-lenis-prevent>
          <div className="mx-auto flex max-w-md flex-col gap-6">
            <div className="iv-rise" style={{ "--i": 0 }}>
              <h1 className="text-balance text-[26px] font-semibold leading-tight tracking-[-0.02em]">
                {GATE.title}
              </h1>
              <p className="mt-2 text-[16px] leading-relaxed text-[var(--iv-muted-fg)]">{GATE.intro}</p>
            </div>

            <div className="iv-alert iv-rise" style={{ "--i": 1 }}>
              <BotIcon size={18} />
              <p>{GATE.aiNotice}</p>
            </div>

            <ul className="iv-rise flex flex-col gap-2.5" style={{ "--i": 2 }}>
              {GATE.kept.map((line) => (
                <li key={line} className="flex gap-2.5 text-[14px] leading-relaxed text-[var(--iv-muted-fg)]">
                  <CheckIcon size={15} className="mt-[3px] shrink-0 text-[var(--iv-fg)]" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="iv-rise flex flex-col gap-2.5" style={{ "--i": 3 }}>
              <Checkbox checked={consent} onChange={setConsent}>
                {GATE.consent}
              </Checkbox>
              <Checkbox checked={adult} onChange={setAdult}>
                {GATE.adult}
              </Checkbox>
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

            <div className="iv-rise flex flex-col gap-3" style={{ "--i": 4 }}>
              {error ? (
                <p className="iv-notice" data-tone="error" role="alert">
                  {error}
                </p>
              ) : null}
              <Button size="lg" className="w-full" onClick={start} disabled={!canStart}>
                {starting ? UI.loading : GATE.start}
              </Button>
              <a
                className="iv-btn iv-btn--link self-center"
                href="/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
              >
                {UI.privacy}
              </a>
            </div>
          </div>
        </main>
      ) : null}

      {phase === "chat" || phase === "end" ? (
        <main ref={listRef} onScroll={onScroll} className="iv-conversation" data-lenis-prevent aria-live="polite">
          <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-6">
            {messages.map((message, index) => (
              <Message key={index} from={message.role === "ai" ? "assistant" : "user"}>
                {message.text}
              </Message>
            ))}

            {busy && phase === "chat" ? (
              <div className="iv-msg iv-msg--assistant">
                <Shimmer>{UI.thinking}</Shimmer>
              </div>
            ) : null}

            {phase === "end" && ending ? (
              <div className="iv-card" role="status">
                <p className="text-[16px] leading-relaxed">{ending.message}</p>
                {ending.ref ? (
                  <div className="mt-4 border-t border-[var(--iv-border)] pt-4">
                    <p className="text-[12px] font-medium text-[var(--iv-muted-fg)]">{UI.refLabel}</p>
                    <p className="mt-1 select-all font-mono text-[20px] font-semibold tracking-[0.12em]">
                      {ending.ref}
                    </p>
                    <p className="mt-2 text-[13px] leading-relaxed text-[var(--iv-muted-fg)]">
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

          {!atBottom && phase === "chat" ? (
            <Button
              variant="outline"
              size="icon"
              pill
              className="iv-scroll-down"
              onClick={scrollDown}
              aria-label={UI.scrollDown}
            >
              <ArrowDownIcon />
            </Button>
          ) : null}
        </main>
      ) : null}

      {phase === "chat" && session ? (
        <footer className="shrink-0 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-1">
          <div className="mx-auto max-w-2xl">
            {nearlyUp ? (
              <p className="iv-notice" data-tone="error">
                {UI.lastAnswer}
              </p>
            ) : null}
            {error ? (
              <p className="iv-notice" data-tone="error" role="alert">
                {error}
              </p>
            ) : null}
            {draftVia === "voice" && draft && rec === "idle" ? <p className="iv-notice">{UI.review}</p> : null}

            {showStarters ? (
              <div className="iv-suggestions" key={turnKey} role="group" aria-label={UI.startersLabel}>
                {starters.map((starter, index) => (
                  <Button
                    key={starter}
                    variant="outline"
                    size="sm"
                    pill
                    className="iv-suggestion"
                    style={{ "--i": index }}
                    onClick={() => applyStarter(starter)}
                  >
                    {starter}
                  </Button>
                ))}
              </div>
            ) : null}

            <div className="iv-prompt">
              {rec === "recording" ? (
                <>
                  <div className="iv-recording">
                    <div className="iv-recording-row">
                      <span className="iv-rec-dot" aria-hidden="true" />
                      <Waveform level={recLevel} />
                      <span className="iv-time" role="timer" aria-label={UI.recording}>
                        {clock(recSeconds * 1000)}
                      </span>
                    </div>
                    <Swap text={listeningLine(recSeconds, LIMITS.maxNoteSeconds)} />
                  </div>
                  <div className="iv-prompt-footer">
                    <Button variant="ghost" size="sm" onClick={cancelRecording}>
                      {UI.cancelRecording}
                    </Button>
                    <span className="iv-prompt-hint">{UI.recordingHint}</span>
                    <Button size="sm" onClick={stopRecording}>
                      <CheckIcon size={14} strokeWidth={2.5} />
                      {UI.stopRecording}
                    </Button>
                  </div>
                </>
              ) : rec === "transcribing" ? (
                <div className="iv-recording justify-center">
                  <Shimmer>{UI.transcribing}</Shimmer>
                </div>
              ) : (
                <>
                  <div className="iv-prompt-body">
                    <textarea
                      ref={inputRef}
                      className="iv-textarea"
                      value={draft}
                      onChange={(event) => {
                        setDraft(event.target.value.slice(0, LIMITS.maxAnswerChars));
                        if (!event.target.value) setDraftVia("typed");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send();
                      }}
                      rows={2}
                      aria-label={UI.placeholder}
                      disabled={busy}
                    />
                    {!draft && !busy ? (
                      <TypedStarters key={turnKey} starters={starters} fallback={UI.placeholder} />
                    ) : null}
                  </div>
                  <div className="iv-prompt-footer">
                    {canRecord ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={record}
                        disabled={busy}
                        aria-label={UI.record}
                        title={UI.record}
                      >
                        <MicIcon size={18} />
                      </Button>
                    ) : (
                      <span />
                    )}
                    <Button
                      size="icon"
                      pill
                      onClick={send}
                      disabled={busy || !draft.trim()}
                      aria-label={UI.send}
                      title={UI.send}
                    >
                      <ArrowUpIcon size={18} strokeWidth={2.4} />
                    </Button>
                  </div>
                </>
              )}
            </div>

            <div className="flex h-9 items-center justify-center gap-3 text-[12px] text-[var(--iv-muted-fg)]">
              {confirmStop ? (
                <>
                  <span>{UI.stopConfirm}</span>
                  <Button variant="link" className="iv-btn--danger" onClick={stopInterview}>
                    {UI.stopYes}
                  </Button>
                  <Button variant="link" onClick={() => setConfirmStop(false)}>
                    {UI.stopNo}
                  </Button>
                </>
              ) : (
                <Button variant="link" onClick={() => setConfirmStop(true)} disabled={busy || rec !== "idle"}>
                  {UI.stopLink}
                </Button>
              )}
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
