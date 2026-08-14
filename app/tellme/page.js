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
import { Analytics } from "@vercel/analytics/react";

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

const PAGE_SIZE = 9;

// Every state a card can be in, in one place, because the colour IS the
// status here and a colour defined in three files drifts.
//
// Two axes decide it. WHAT the report is (kind: a fault, or a wish) and WHERE
// it has got to (untouched, picked up, done). Two greens, deliberately: being
// given something you asked for and having something repaired that never
// should have broken are different news, and a board that paints them the same
// green tells the second story about both.
const STATES = {
  open: {
    label: "Not fixed yet",
    card: "border-red-200 bg-red-50 text-red-900",
    badge: "bg-red-600 text-white",
    dot: "bg-red-600",
    legend: "Broken, nobody on it yet",
  },
  looking: {
    label: "Being looked at",
    card: "border-orange-300 bg-orange-50 text-orange-900",
    badge: "bg-orange-500 text-white",
    dot: "bg-orange-500",
    legend: "Picked up, not done",
  },
  fixed: {
    label: "Fixed",
    card: "border-green-300 bg-green-50 text-green-900",
    badge: "bg-green-600 text-white",
    dot: "bg-green-600",
    legend: "Broken, now repaired",
  },
  idea: {
    label: "Suggestion",
    card: "border-purple-300 bg-purple-50 text-purple-900",
    badge: "bg-purple-600 text-white",
    dot: "bg-purple-600",
    legend: "Nothing broken, someone wants something",
  },
  added: {
    label: "Added",
    card: "border-teal-300 bg-teal-50 text-teal-900",
    badge: "bg-teal-600 text-white",
    dot: "bg-teal-600",
    legend: "Asked for, now built",
  },
  filtered: {
    label: "Filed away",
    card: "border-[#171717]/15 bg-[#171717]/[0.03] text-[#171717]/80",
    badge: "bg-[#171717]/40 text-white",
    dot: "bg-[#171717]/40",
    legend: "No request in it",
  },
};

// Being looked at outranks the kind: it is news, and it is the same news for a
// fault and for a wish. Everything else follows from what the report is.
function stateOf(report, fixed, looking) {
  const idea = report.kind === "suggestion";
  if (report.kind === "filtered") return "filtered";
  if (fixed) return idea ? "added" : "fixed";
  if (looking) return "looking";
  return idea ? "idea" : "open";
}

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

  // A fix that changes the extension is in nobody's hands until a new version
  // clears the store, so "did this fix it?" would be judging code nobody can
  // run. The vote stays hidden until the admin marks the release shipped.
  // Site fixes are testable as soon as they are live, so they keep the vote.
  const waitsOnRelease =
    (report.fix_target === "extension" || report.fix_target === "mixed") &&
    !report.fix_shipped_in;
  const voteOpen = votingEnabled && !waitsOnRelease;

  // What the second line should say depends on where the fix is on its way to
  // the reader, not just on whether it exists.
  const subline =
    report.fix_state === "verified"
      ? "Enough people confirmed it works."
      : waitsOnRelease
        ? report.fix_target === "mixed"
          ? "Part of it changes the extension itself, so the full fix arrives with the next extension update. You can read the code now; the vote opens once the update ships."
          : "It changes the extension itself, so it arrives with the next extension update. You can read the code now; the vote opens once the update ships."
        : report.fix_shipped_in
          ? report.fix_target === "site"
            ? "It is live on the site. If you had this problem, try again and say whether it worked."
            : `It shipped with extension update ${report.fix_shipped_in}. Update the extension, try again, and say whether it worked.`
          : "It is waiting on a human to merge it. Read the code below, and if you had this problem, try the latest build and say whether it worked.";

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
      <p className="mt-1 text-[12px] opacity-75">{subline}</p>
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
              {fix.before && fix.after && (
                <div className="mt-1.5">
                  <p className="text-[12px] font-medium">Which one is right?</p>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {[
                      ["Before", fix.before],
                      ["After the fix", fix.after],
                    ].map(([label, src]) => (
                      <a key={label} href={src} target="_blank" rel="noopener noreferrer">
                        <span className="mb-0.5 block text-[11px] uppercase tracking-wide opacity-60">
                          {label}
                        </span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={label}
                          className="w-full rounded-lg border border-current/20 bg-white"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
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
      {voteOpen && (
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

// The published outcome, once there is one. Deliberately NOT the agent's raw
// findings: those are long, full of file names, and often end mid-question.
// What lands here is the short account written after the maintainer has
// decided, because a considered "here is how this ended" is a real answer to a
// report, and a half-finished investigation shown as a verdict is not.
function AgentThread({ report }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (data) return undefined;
    setLoading(true);
    try {
      const res = await fetch(`/api/tellme/fix?id=${report.id}`);
      const body = await res.json().catch(() => ({}));
      setData(res.ok ? body : { error: body.error || "Couldn't load it." });
    } catch (_) {
      setData({ error: "Couldn't load it." });
    }
    setLoading(false);
  }

  const notes = Array.isArray(data?.notes) ? data.notes : [];

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={toggle}
        className="text-left text-[13px] font-medium underline decoration-dotted underline-offset-4 hover:opacity-80"
      >
        {report.notes > 0
          ? open
            ? "How this ended ▾"
            : "How this ended ▸"
          : open
            ? "Being looked at ▾"
            : "Being looked at ▸"}
      </button>

      {open && (
        <div className="mt-1.5 space-y-2">
          {loading && <p className="text-[12px] opacity-60">Loading…</p>}
          {data?.error && <p className="text-[12px] opacity-70">{data.error}</p>}
          {!loading && !data?.error && notes.length === 0 && (
            <p className="text-[12px] opacity-70">
              Someone is looking at this. The outcome gets posted here once it is settled.
            </p>
          )}
          {notes.map((n, i) => (
            <div key={i} className="rounded-lg bg-white/70 p-2.5">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{n.body}</p>
            </div>
          ))}
        </div>
      )}
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

  const looking = !fixed && !!report.lookedAt;
  const state = stateOf(report, fixed, looking);
  const tone = STATES[state].card;
  const badge = STATES[state].badge;

  return (
    <li className={`rounded-xl border p-4 md:p-5 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{report.body}</p>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${badge}`}
        >
          {STATES[state].label}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-70">
        <span>{timeAgo(report.created_at)}</span>
        {/* Without the date, "being looked at" reads the same on day one and
            day thirty, which is the anxiety the state is supposed to remove. */}
        {looking && <span>· picked up {timeAgo(report.lookedAt)}</span>}
        {report.source === "extension" && <span>· reported from an error in the extension</span>}
        {report.category && <span>· {CATEGORY_LABEL[report.category] || report.category}</span>}
      </div>

      {report.screenshot_url && (
        <a href={report.screenshot_url} target="_blank" rel="noopener noreferrer" className="mt-2 block w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={report.screenshot_url}
            alt="Screenshot attached to this report"
            className="max-h-40 rounded-lg border border-current/20"
            loading="lazy"
          />
        </a>
      )}

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

      {(report.notes > 0 || report.lookedAt) && <AgentThread report={report} />}

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
  const [shot, setShot] = useState(null); // { url } once uploaded
  const [uploading, setUploading] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [filteredOpen, setFilteredOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const boxRef = useRef(null);
  const fileRef = useRef(null);

  // The board proper and the drawer under it. Derived rather than stored, so a
  // report that gets reclassified from the dashboard moves between the two on
  // the next load with nothing to keep in sync.
  const live = (reports || []).filter((r) => r.kind !== "filtered");
  const filtered = (reports || []).filter((r) => r.kind === "filtered");

  useEffect(() => {
    const fromError = params.get("ctx");
    if (fromError) {
      setCtx(fromError.slice(0, 1000));
      boxRef.current?.focus();
    }
  }, [params]);

  useEffect(() => {
    // "Nothing reported yet" and "the board could not load" are opposite
    // facts, and rendering the first when the second is true is the worst
    // failure this page has: it tells everyone their reports are gone.
    fetch("/api/tellme")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.reports)) {
          setReports(data.reports);
          setVotingEnabled(data.votingEnabled !== false);
        } else {
          setLoadFailed(true);
          setReports([]);
        }
      })
      .catch(() => {
        setLoadFailed(true);
        setReports([]);
      });
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

  // The image uploads the moment it is picked, not at post time — a failed
  // upload should be known while the person is still looking at the form.
  async function attachShot(file) {
    if (!file || uploading) return;
    setUploading(true);
    setNote(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/tellme/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) setShot({ url: data.url });
      else setNote({ text: data.error || "The upload didn't stick. Try again.", ok: false });
    } catch (_) {
      setNote({ text: "The upload didn't stick. Try again.", ok: false });
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
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
          screenshot: shot?.url || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.report) {
        setReports((list) => [data.report, ...(list || [])]);
        setText("");
        setOriginal(null);
        setCtx("");
        setShot(null);
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
          <span className="ml-1 text-xs text-[#000000] transition-colors group-hover:text-accent">
            &larr; Home
          </span>
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-6 pb-24 pt-4 md:px-8">
        <h1 className="mb-2 text-2xl font-semibold text-accent md:text-3xl">
          Tell us what happened
        </h1>
        <p className="mb-3 text-sm leading-relaxed text-[#171717]/70">
          Something broke, or got in your way? Say it however it comes out. This is a page, not an
          email. Reports sit here for everyone to see: <span className="text-red-700">red</span>{" "}
          until it&apos;s fixed, <span className="text-green-700">green</span> once it is.
        </p>

        {/* The key, always on screen rather than hidden behind a "what do the
            colours mean" link. The colours ARE the status of the whole board,
            and a reader should never have to learn them twice. */}
        <ul className="mb-8 flex flex-wrap gap-x-4 gap-y-1.5">
          {["open", "looking", "fixed", "idea", "added"].map((key) => (
            <li key={key} className="flex items-center gap-1.5 text-[11.5px] text-[#171717]/60">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATES[key].dot}`} />
              <span className="font-medium text-[#171717]/80">{STATES[key].label}</span>
              <span className="opacity-70">{STATES[key].legend}</span>
            </li>
          ))}
        </ul>

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
          onPaste={(e) => {
            // Cmd+Shift+4 then Cmd+V is how most people screenshot, and making
            // them save a file first to use the picker throws that away. An
            // image on the clipboard uploads exactly as a picked file does.
            const item = [...(e.clipboardData?.items || [])].find((i) =>
              i.type.startsWith("image/"),
            );
            if (!item) return;
            const file = item.getAsFile();
            if (!file) return;
            e.preventDefault();
            attachShot(file);
          }}
          placeholder="Tell us what happened. You can paste a screenshot straight in here."
          rows={4}
          className="w-full resize-y rounded-xl border border-[#171717]/20 bg-white p-4 text-[15px] leading-relaxed outline-none transition-colors placeholder:text-[#171717]/40 focus:border-accent"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={post}
            disabled={busy || !text.trim()}
            className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
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
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => attachShot(e.target.files?.[0])}
          />
          {shot ? (
            <span className="flex items-center gap-1.5 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot.url} alt="Attached screenshot" className="h-8 w-8 rounded object-cover" />
              <button
                type="button"
                onClick={() => setShot(null)}
                className="opacity-60 underline underline-offset-2 hover:opacity-100"
              >
                remove
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title="A picture of the problem helps a lot for anything visual. It will be shown publicly with your report."
              className="rounded-full border border-[#171717]/20 px-4 py-2 text-sm transition-colors hover:border-[#171717]/50 disabled:opacity-40"
            >
              {uploading ? "Uploading…" : "Add a screenshot"}
            </button>
          )}
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

        <h2 className="mb-3 mt-12 text-lg font-semibold">
          What others have said
          {live.length ? <span className="ml-1 font-normal opacity-50">({live.length})</span> : null}
        </h2>
        {reports == null ? (
          <p className="text-sm opacity-60">Loading reports…</p>
        ) : loadFailed ? (
          <p className="text-sm text-red-700">
            The board didn&apos;t load. Nothing has been lost. Reload the page, and if it keeps
            happening it is our end, not yours.
          </p>
        ) : live.length === 0 ? (
          <p className="text-sm opacity-60">Nothing reported yet. Yours would be the first.</p>
        ) : (
          <ul className="space-y-3">
            {live.slice(0, shown).map((r) => (
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

        {/* Nine is about a screenful. Beyond that the page becomes a wall
            nobody reads to the bottom of, and every card below the fold is
            still costing an image fetch. */}
        {live.length > shown && (
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE_SIZE)}
            className="mt-4 w-full rounded-xl border border-[#171717]/20 py-2.5 text-sm transition-colors hover:border-[#171717]/50"
          >
            Show more ({live.length - shown} left)
          </button>
        )}

        {/* Messages with no request inside them: praise, abuse, jokes, spam.
            Kept and countable rather than deleted, because a board that
            silently drops what it does not like is a board you cannot check.
            One quiet line at the very bottom, closed by default, so the count
            is honest without the noise sharing space with the work. */}
        {reports != null && !loadFailed && (
          <div className="mt-8 border-t border-[#171717]/10 pt-4">
            <button
              type="button"
              onClick={() => setFilteredOpen((v) => !v)}
              disabled={filtered.length === 0}
              className="text-[13px] text-[#171717]/50 underline decoration-dotted underline-offset-4 transition-colors hover:text-[#171717]/80 disabled:no-underline disabled:hover:text-[#171717]/50"
            >
              Filtered ({filtered.length}){filtered.length > 0 && (filteredOpen ? " ▾" : " ▸")}
            </button>
            {filtered.length > 0 && !filteredOpen && (
              <p className="mt-1 text-[11.5px] text-[#171717]/40">
                Messages with nothing to fix or build in them. Nothing is deleted.
              </p>
            )}
            {filteredOpen && filtered.length > 0 && (
              <ul className="mt-3 space-y-3">
                {filtered.map((r) => (
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
          </div>
        )}
      </main>
    </div>
  );
}

export default function TellmePage() {
  return (
    <>
      <Suspense fallback={<div className="min-h-screen bg-white" />}>
        <TellmeInner />
      </Suspense>
      {/* On the page, not the layout — see layout.js for why the admin panel
          is deliberately left out of the numbers. */}
      <Analytics />
    </>
  );
}
