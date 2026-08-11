"use client";

// /tellme — where anyone tells JustClarify what went wrong, in their own words.
//
// The rules of the board, all user-set:
//   - The textbox asks one thing: "Tell us what happened."
//   - A tidy-up button paraphrases their words for clarity — same meaning,
//     same length, their call to keep it or undo it. Nothing posts un-chosen.
//   - Every report carries "what the agent understood" — readers must open
//     that line before the vote buttons appear, so a vote is always a vote on
//     the meaning, not the spelling.
//   - The first time anyone ever votes, one question, right at the button:
//     did you actually test it? Asked once, never again.
//   - Red means not fixed yet. Green means fixed. Flipped from the admin
//     panel, never from here.

import { useEffect, useRef, useState, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function voterId() {
  try {
    let id = localStorage.getItem("jcTellmeVoter");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("jcTellmeVoter", id);
    }
    return id;
  } catch (_) {
    return null;
  }
}

// Two independent ballots, kept in separate buckets because they answer
// different questions: "is this problem real" and "did the proposed fix work".
function myVotes(kind = "jcTellmeVotes") {
  try {
    return JSON.parse(localStorage.getItem(kind) || "{}");
  } catch (_) {
    return {};
  }
}

function rememberVote(id, dir, kind = "jcTellmeVotes") {
  try {
    const votes = myVotes(kind);
    if (dir) votes[id] = dir;
    else delete votes[id];
    localStorage.setItem(kind, JSON.stringify(votes));
  } catch (_) {}
}

// Mirrors CATEGORIES in lib/agent/policy.js. Shown so a reader can see how the
// report was triaged, and so "Sensitive" visibly explains why no agent touched
// it rather than looking like neglect.
const CATEGORY_LABEL = {
  copy: "Wording",
  ui: "Look and layout",
  logic: "Behaviour",
  sensitive: "Sensitive, handled by a human",
  unclear: "Needs more detail",
};

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// The candidate-fix strip, shown only once an agent run has opened a pull
// request for this report. Its vote is NOT the same vote as the one on the
// report: this one asks whether the fix worked, and enough yeses turn the
// whole card green.
// One line of a unified diff, coloured by what it does. Added lines green,
// removed lines red, everything else plain, which is the convention people
// already read on GitHub without being taught it.
function DiffView({ diff }) {
  return (
    <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-[#171717] p-3 font-mono text-[11px] leading-relaxed text-[#e6e6e6]">
      {diff.split("\n").map((line, i) => {
        const tone = line.startsWith("+++") || line.startsWith("---")
          ? "text-[#9aa0a6]"
          : line.startsWith("+")
            ? "text-[#7ee787]"
            : line.startsWith("-")
              ? "text-[#ff7b72]"
              : line.startsWith("@@")
                ? "text-[#79c0ff]"
                : "text-[#c9d1d9]";
        return (
          <div key={i} className={tone}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

function FixStrip({ report, votingEnabled, onFixCounts }) {
  const [mine, setMine] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [fix, setFix] = useState(null); // the loaded diff, once asked for
  const [showing, setShowing] = useState(false);
  const [loadingFix, setLoadingFix] = useState(false);

  useEffect(() => {
    setMine(myVotes("jcTellmeFixVotes")[report.id] || 0);
  }, [report.id]);

  // Loaded on demand, not with the board: a diff is large and most readers
  // scrolling past a report will never open one.
  async function toggleCode() {
    if (showing) {
      setShowing(false);
      return;
    }
    setShowing(true);
    if (fix || loadingFix) return;
    setLoadingFix(true);
    try {
      const res = await fetch(`/api/tellme/fix?id=${report.id}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setFix(data);
      else setFix({ error: data.error || "Couldn't load the code." });
    } catch (_) {
      setFix({ error: "Couldn't load the code." });
    }
    setLoadingFix(false);
  }

  async function vote(dir) {
    const voter = voterId();
    if (!voter || busy) return;
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/tellme/fix-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: report.id, voter, dir }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.ups === "number") {
        const next = mine === dir ? 0 : dir;
        setMine(next);
        rememberVote(report.id, next, "jcTellmeFixVotes");
        onFixCounts(report.id, data.ups, data.downs, data.status);
      } else {
        setNote(data.error || "That didn't go through.");
      }
    } catch (_) {
      setNote("That didn't go through.");
    }
    setBusy(false);
  }

  return (
    <div className="mt-3 rounded-lg border border-current/20 bg-white/60 p-3">
      <p className="text-[13px] font-medium">
        A fix has been written for this{report.fix_state === "verified" ? " and confirmed" : ""}.
      </p>
      <p className="mt-1 text-[12px] opacity-75">
        {report.fix_state === "verified"
          ? "Enough people confirmed it works."
          : "It is waiting on a human to merge it. Read the code below, and if you had this problem, try the latest build and say whether it worked."}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggleCode}
          className="text-[12px] font-medium underline decoration-dotted underline-offset-4 hover:opacity-80"
        >
          {showing ? "Hide the code" : "See exactly what changed"}
        </button>
        {report.fix_pr_url && (
          <a
            href={report.fix_pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] underline underline-offset-4 opacity-70 hover:opacity-100"
          >
            Open it on GitHub
          </a>
        )}
      </div>

      {showing && (
        <div className="mt-1">
          {loadingFix && <p className="text-[12px] opacity-60">Loading the code…</p>}
          {fix?.error && <p className="text-[12px] text-red-700">{fix.error}</p>}
          {fix && !fix.error && (
            <>
              {fix.summary && (
                <p className="mt-1 whitespace-pre-wrap rounded-lg bg-white/70 p-2.5 text-[13px] leading-relaxed">
                  {fix.summary}
                </p>
              )}
              {fix.files?.length > 0 && (
                <p className="mt-1.5 font-mono text-[11px] opacity-70">
                  {fix.files.join("  ·  ")}
                </p>
              )}
              {fix.diff ? (
                <DiffView diff={fix.diff} />
              ) : (
                <p className="mt-1 text-[12px] opacity-60">No code changed.</p>
              )}
            </>
          )}
        </div>
      )}
      {votingEnabled && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[12px] opacity-70">Did this fix it?</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => vote(1)}
            className={`rounded-full border px-2.5 py-0.5 text-[12px] ${
              mine === 1 ? "border-current bg-white font-semibold" : "border-current/30 bg-white/60"
            }`}
          >
            Yes {report.fix_ups || 0}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => vote(-1)}
            className={`rounded-full border px-2.5 py-0.5 text-[12px] ${
              mine === -1 ? "border-current bg-white font-semibold" : "border-current/30 bg-white/60"
            }`}
          >
            No {report.fix_downs || 0}
          </button>
        </div>
      )}
      {note && <p className="mt-1.5 text-[12px] text-red-700">{note}</p>}
    </div>
  );
}

function ReportCard({ report, votingEnabled, onCounts, onFixCounts }) {
  const fixed = report.status === "fixed";
  const [gistOpen, setGistOpen] = useState(false);
  const [asking, setAsking] = useState(null); // 1 | -1 while the one-time question is up
  const [mine, setMine] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMine(myVotes()[report.id] || 0);
  }, [report.id]);

  // The gate: the agent's reading must be opened before voting exists at all.
  // A report whose gist never generated has nothing to gate on — votes show.
  const votesVisible = votingEnabled && (gistOpen || !report.gist);

  async function castVote(dir) {
    const voter = voterId();
    if (!voter || busy) return;
    setBusy(true);
    setAsking(null);
    try {
      const res = await fetch("/api/tellme/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: report.id, voter, dir }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && typeof data.ups === "number") {
        const next = mine === dir ? 0 : dir; // same again = retracted
        setMine(next);
        rememberVote(report.id, next);
        onCounts(report.id, data.ups, data.downs);
      }
    } catch (_) {}
    setBusy(false);
  }

  function voteClicked(dir) {
    let asked = false;
    try {
      asked = localStorage.getItem("jcTellmeVoteAsked") === "1";
    } catch (_) {}
    if (!asked) {
      setAsking(dir); // the one-time question, anchored right here
      return;
    }
    castVote(dir);
  }

  function confirmFirstVote(dir) {
    try {
      localStorage.setItem("jcTellmeVoteAsked", "1");
    } catch (_) {}
    castVote(dir);
  }

  const tone = fixed
    ? "border-green-300 bg-green-50 text-green-900"
    : "border-red-200 bg-red-50 text-red-900";

  return (
    <li className={`rounded-xl border p-4 md:p-5 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{report.body}</p>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            fixed ? "bg-green-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {fixed ? "Fixed" : "Not fixed yet"}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-70">
        <span>{timeAgo(report.created_at)}</span>
        {report.source === "extension" && <span>· reported from an error in the extension</span>}
        {report.category && <span>· {CATEGORY_LABEL[report.category] || report.category}</span>}
      </div>

      {report.context && (
        <details className="mt-2 text-xs opacity-80">
          <summary className="cursor-pointer select-none">The error that came with it</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-white/60 p-2 font-mono text-[11px]">
            {report.context}
          </pre>
        </details>
      )}

      {report.gist && (
        <button
          type="button"
          onClick={() => setGistOpen((v) => !v)}
          className="mt-3 block text-left text-[13px] font-medium underline decoration-dotted underline-offset-4 hover:opacity-80"
        >
          {gistOpen ? "What the agent understood ▾" : "What the agent understood ▸"}
        </button>
      )}
      {gistOpen && report.gist && (
        <p className="mt-1.5 rounded-lg bg-white/70 p-2.5 text-[13px] italic leading-relaxed">
          {report.gist}
        </p>
      )}

      {report.fix_state && report.fix_state !== "none" && (
        <FixStrip report={report} votingEnabled={votingEnabled} onFixCounts={onFixCounts} />
      )}

      {votesVisible && (
        <div className="relative mt-3 flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => voteClicked(1)}
            aria-label="This matters to me too"
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] transition-colors ${
              mine === 1
                ? "border-current bg-white font-semibold"
                : "border-current/30 bg-white/50 hover:bg-white"
            }`}
          >
            ▲ <span>{report.ups}</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => voteClicked(-1)}
            aria-label="I don't think this is right"
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] transition-colors ${
              mine === -1
                ? "border-current bg-white font-semibold"
                : "border-current/30 bg-white/50 hover:bg-white"
            }`}
          >
            ▼ <span>{report.downs}</span>
          </button>

          {asking != null && (
            <div className="absolute bottom-full left-0 z-10 mb-2 w-64 rounded-xl border border-[#171717]/15 bg-white p-3 text-[#171717] shadow-lg">
              <p className="text-[13px] leading-snug">
                Quick one, asked only once: did you test whether the extension already does this?
                If not, please try it before you vote.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => confirmFirstVote(asking)}
                  className="rounded-full bg-[#171717] px-3 py-1 text-[12px] text-white hover:bg-black"
                >
                  I tested it — vote
                </button>
                <button
                  type="button"
                  onClick={() => setAsking(null)}
                  className="rounded-full border border-[#171717]/20 px-3 py-1 text-[12px] hover:bg-[#171717]/5"
                >
                  Not yet
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function TellmeInner() {
  const params = useSearchParams();
  const [reports, setReports] = useState(null);
  const [votingEnabled, setVotingEnabled] = useState(true);
  const [text, setText] = useState("");
  const [original, setOriginal] = useState(null); // pre-tidy text, for undo
  const [ctx, setCtx] = useState("");
  const [busy, setBusy] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [note, setNote] = useState(null); // { text, ok }
  const boxRef = useRef(null);

  useEffect(() => {
    const fromError = params.get("ctx");
    if (fromError) {
      setCtx(fromError.slice(0, 1000));
      boxRef.current?.focus();
    }
  }, [params]);

  useEffect(() => {
    fetch("/api/tellme")
      .then((r) => r.json())
      .then((data) => {
        setReports(Array.isArray(data.reports) ? data.reports : []);
        setVotingEnabled(data.votingEnabled !== false);
      })
      .catch(() => setReports([]));
  }, []);

  function updateCounts(id, ups, downs) {
    setReports((list) => list.map((r) => (r.id === id ? { ...r, ups, downs } : r)));
  }

  // The fix vote can flip the card green, so it carries the status back too.
  function updateFixCounts(id, fix_ups, fix_downs, status) {
    setReports((list) =>
      list.map((r) =>
        r.id === id ? { ...r, fix_ups, fix_downs, status: status || r.status } : r,
      ),
    );
  }

  async function tidy() {
    const current = text.trim();
    if (!current || tidying) return;
    setTidying(true);
    setNote(null);
    try {
      const res = await fetch("/api/tellme/paraphrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: current }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.text) {
        setOriginal(current);
        setText(data.text);
      } else {
        setNote({ text: data.error || "Couldn't tidy that just now. Your words work as they are.", ok: false });
      }
    } catch (_) {
      setNote({ text: "Couldn't tidy that just now. Your words work as they are.", ok: false });
    }
    setTidying(false);
  }

  async function post() {
    const current = text.trim();
    if (!current || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/tellme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: current,
          context: ctx || undefined,
          source: ctx ? "extension" : "web",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.report) {
        setReports((list) => [data.report, ...(list || [])]);
        setText("");
        setOriginal(null);
        setCtx("");
        setNote({ text: "Posted. It shows red until it's fixed, then it turns green.", ok: true });
      } else {
        setNote({ text: data.error || "Couldn't post that. Try again in a moment.", ok: false });
      }
    } catch (_) {
      setNote({ text: "Couldn't post that. Try again in a moment.", ok: false });
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#171717]">
      <header className="w-full px-4 py-5 md:px-10">
        <Link href="/" className="group inline-flex items-center gap-2">
          <Image
            src="/diamond.svg"
            alt="JustClarify logo"
            width={32}
            height={32}
            priority
            className="h-5 w-5 md:h-6 md:w-6"
          />
          <span className="text-base md:text-xl">JustClarify</span>
          <span className="ml-1 text-xs text-[#000000] transition-colors group-hover:text-[#FF0000]">
            &larr; Home
          </span>
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-6 pb-24 pt-4 md:px-8">
        <h1 className="mb-2 text-2xl font-semibold text-[#FF0000] md:text-3xl">
          Tell us what happened
        </h1>
        <p className="mb-8 text-sm leading-relaxed text-[#171717]/70">
          Something broke, or got in your way? Say it however it comes out. This is a page, not an
          email. Reports sit here for everyone to see: <span className="text-red-700">red</span>{" "}
          until it&apos;s fixed, <span className="text-green-700">green</span> once it is.
        </p>

        {ctx && (
          <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-[#171717]/15 bg-[#171717]/[0.03] p-3">
            <div className="min-w-0">
              <p className="text-xs font-medium">The error you saw comes attached:</p>
              <p className="mt-1 truncate font-mono text-[11px] opacity-70">{ctx}</p>
            </div>
            <button
              type="button"
              onClick={() => setCtx("")}
              aria-label="Remove the attached error"
              className="text-sm opacity-50 hover:opacity-100"
            >
              ×
            </button>
          </div>
        )}

        <textarea
          ref={boxRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value.slice(0, 2000));
            setOriginal(null);
          }}
          placeholder="Tell us what happened"
          rows={4}
          className="w-full resize-y rounded-xl border border-[#171717]/20 bg-white p-4 text-[15px] leading-relaxed outline-none transition-colors placeholder:text-[#171717]/40 focus:border-[#FF0000]"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={post}
            disabled={busy || !text.trim()}
            className="rounded-full bg-[#FF0000] px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Posting…" : "Post it"}
          </button>
          <button
            type="button"
            onClick={tidy}
            disabled={tidying || !text.trim()}
            title="Paraphrases what you wrote so it reads clearly. Same meaning, same length, still your words."
            className="rounded-full border border-[#171717]/20 px-4 py-2 text-sm transition-colors hover:border-[#171717]/50 disabled:opacity-40"
          >
            {tidying ? "Tidying…" : "Hard to word it? Let AI tidy it up"}
          </button>
          {original != null && (
            <button
              type="button"
              onClick={() => {
                setText(original);
                setOriginal(null);
              }}
              className="text-xs underline underline-offset-4 opacity-70 hover:opacity-100"
            >
              Undo, back to my words
            </button>
          )}
          <span className="ml-auto text-xs opacity-40">{text.length}/2000</span>
        </div>

        {note && (
          <p className={`mt-3 text-sm ${note.ok ? "text-green-700" : "text-red-700"}`}>
            {note.text}
          </p>
        )}

        <h2 className="mb-3 mt-12 text-lg font-semibold">What others have said</h2>
        {reports == null ? (
          <p className="text-sm opacity-60">Loading reports…</p>
        ) : reports.length === 0 ? (
          <p className="text-sm opacity-60">Nothing reported yet — yours would be the first.</p>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <ReportCard
                key={r.id}
                report={r}
                votingEnabled={votingEnabled}
                onCounts={updateCounts}
                onFixCounts={updateFixCounts}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

export default function TellmePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <TellmeInner />
    </Suspense>
  );
}
