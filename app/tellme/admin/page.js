"use client";

// The tellme control room. Everything here rides POST /api/tellme/admin with
// the JC_ADMIN_KEY — the key lives in sessionStorage for the tab and nowhere
// else. From here: flip reports red/green, delete them, and switch voting on
// or off for the whole board.

import { useEffect, useState } from "react";
import Link from "next/link";

const RUN_TONE = {
  queued: "bg-[#171717]/10 text-[#171717]",
  running: "bg-blue-600 text-white",
  succeeded: "bg-green-600 text-white",
  blocked: "bg-amber-500 text-white",
  failed: "bg-red-600 text-white",
};

// One button whose label is the honest state of the run. "Blocked" is a
// first-class, frequently-correct outcome here rather than a failure: it is
// what a sensitive report or an unreproducible one is supposed to produce.
function AgentButton({ run, onRun }) {
  const busy = run && (run.status === "queued" || run.status === "running");
  if (busy) {
    return (
      <span className="rounded-full bg-blue-600 px-3 py-1 text-white">
        Agent {run.status}…
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onRun}
      className="rounded-full border border-[#171717]/30 px-3 py-1 hover:bg-[#171717]/5"
    >
      {run ? "Run the agent again" : "Send to agent"}
    </button>
  );
}

function RunPanel({ run, open, onToggle }) {
  const log = Array.isArray(run.log) ? run.log : [];
  return (
    <div className="mt-2 rounded-lg border border-[#171717]/15 bg-white/70 p-2.5 text-xs">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${RUN_TONE[run.status] || ""}`}>
          {run.status}
        </span>
        {run.category && <span className="opacity-70">{run.category}</span>}
        {run.pr_url && <span className="opacity-70">· pull request open</span>}
        <span className="ml-auto opacity-50">{open ? "hide" : "details"}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {log.length > 0 && (
            <ol className="space-y-0.5 opacity-70">
              {log.map((line, i) => (
                <li key={i}>· {line.message}</li>
              ))}
            </ol>
          )}
          {run.summary && (
            <p className="whitespace-pre-wrap rounded bg-[#171717]/[0.04] p-2">{run.summary}</p>
          )}
          {Array.isArray(run.files) && run.files.length > 0 && (
            <p className="opacity-70">Files: {run.files.join(", ")}</p>
          )}
          {run.error && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-red-50 p-2 font-mono text-[11px] text-red-800">
              {run.error}
            </pre>
          )}
          {run.diff && (
            <details>
              <summary className="cursor-pointer opacity-70">The diff</summary>
              <pre className="mt-1 max-h-80 overflow-auto whitespace-pre rounded bg-[#171717]/[0.04] p-2 font-mono text-[11px]">
                {run.diff}
              </pre>
            </details>
          )}
          {run.pr_url && (
            <a
              href={run.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-full bg-[#171717] px-3 py-1 text-white hover:bg-black"
            >
              Review the pull request
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function TellmeAdminPage() {
  const [key, setKey] = useState("");
  const [entered, setEntered] = useState("");
  const [authed, setAuthed] = useState(false);
  const [reports, setReports] = useState([]);
  const [votingEnabled, setVotingEnabled] = useState(true);
  const [note, setNote] = useState("");
  const [runs, setRuns] = useState({}); // reportId -> newest run
  const [openRun, setOpenRun] = useState(null); // reportId whose detail is expanded

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("jcTellmeAdminKey");
      if (saved) {
        setKey(saved);
        probe(saved);
      }
    } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function call(body) {
    const res = await fetch("/api/tellme/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function probe(candidate) {
    setNote("");
    try {
      await call({ key: candidate, action: "check" });
      setKey(candidate);
      setAuthed(true);
      try {
        sessionStorage.setItem("jcTellmeAdminKey", candidate);
      } catch (_) {}
      refresh(candidate);
    } catch (error) {
      setAuthed(false);
      setNote(String(error.message || error));
    }
  }

  function refresh(withKey) {
    const adminKey = withKey || key;
    fetch("/api/tellme")
      .then((r) => r.json())
      .then((data) => {
        setReports(Array.isArray(data.reports) ? data.reports : []);
        setVotingEnabled(data.votingEnabled !== false);
      })
      .catch(() => {});
    if (adminKey) refreshRuns(adminKey);
  }

  // Newest run per report, so each row can show live progress.
  function refreshRuns(adminKey) {
    fetch(`/api/tellme/agent?key=${encodeURIComponent(adminKey)}`)
      .then((r) => r.json())
      .then((data) => {
        const newest = {};
        for (const run of data.runs || []) {
          if (!newest[run.report_id]) newest[run.report_id] = run;
        }
        setRuns(newest);
      })
      .catch(() => {});
  }

  // Poll only while something is actually moving, so an idle dashboard is not
  // hammering the database.
  useEffect(() => {
    if (!authed) return undefined;
    const live = Object.values(runs).some(
      (r) => r.status === "queued" || r.status === "running",
    );
    if (!live) return undefined;
    const timer = setInterval(() => refreshRuns(key), 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, runs, key]);

  async function sendToAgent(id) {
    setNote("");
    try {
      const res = await fetch("/api/tellme/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, reportId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote(data.error || `HTTP ${res.status}`);
        return;
      }
      setRuns((prev) => ({
        ...prev,
        [id]: { id: data.runId, report_id: id, status: "queued", log: [] },
      }));
      setOpenRun(id);
    } catch (error) {
      setNote(String(error.message || error));
    }
  }

  async function setStatus(id, status) {
    try {
      await call({ key, action: "status", id, status });
      setReports((list) => list.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (error) {
      setNote(String(error.message || error));
    }
  }

  async function remove(id) {
    if (!window.confirm("Delete this report for everyone? There is no undo.")) return;
    try {
      await call({ key, action: "delete", id });
      setReports((list) => list.filter((r) => r.id !== id));
    } catch (error) {
      setNote(String(error.message || error));
    }
  }

  // The human end of the fix-target loop: the agent records WHERE a fix
  // landed, but only a person knows WHEN it reached users' hands (for the
  // extension, that is the store review clearing). Until this is pressed the
  // board holds the "did this fix it?" vote on extension fixes.
  async function markShipped(r) {
    const suggestion = r.fix_shipped_in || (r.fix_target === "site" ? "live" : "v0.0.0");
    const version = window.prompt(
      r.fix_shipped_in
        ? "Shipped in… (clear the box to take it back)"
        : "Shipped in… (the store version for extension fixes, or just 'live' for site fixes)",
      suggestion,
    );
    if (version === null) return;
    try {
      const data = await call({ key, action: "shipped", id: r.id, version: version.trim() });
      setReports((list) =>
        list.map((x) => (x.id === r.id ? { ...x, fix_shipped_in: data.version } : x)),
      );
    } catch (error) {
      setNote(String(error.message || error));
    }
  }

  async function toggleVoting() {
    try {
      const data = await call({ key, action: "voting", enabled: !votingEnabled });
      setVotingEnabled(data.enabled);
    } catch (error) {
      setNote(String(error.message || error));
    }
  }

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6 text-[#171717]">
        <div className="w-full max-w-sm">
          <h1 className="mb-4 text-xl font-semibold">Tellme admin</h1>
          <input
            type="password"
            value={entered}
            onChange={(e) => setEntered(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && probe(entered.trim())}
            placeholder="Admin key"
            className="w-full rounded-xl border border-[#171717]/20 p-3 text-sm outline-none focus:border-[#FF0000]"
          />
          <button
            type="button"
            onClick={() => probe(entered.trim())}
            className="mt-3 w-full rounded-full bg-[#171717] py-2.5 text-sm text-white hover:bg-black"
          >
            Open
          </button>
          {note && <p className="mt-3 text-sm text-red-700">{note}</p>}
          <p className="mt-6 text-xs opacity-50">
            The key is JC_ADMIN_KEY in the site&apos;s environment.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-[#171717]">
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">
            Tellme admin{" "}
            <Link href="/tellme" className="ml-2 text-xs font-normal underline underline-offset-4">
              view the public board
            </Link>
          </h1>
          <button
            type="button"
            onClick={toggleVoting}
            className={`rounded-full px-4 py-2 text-sm text-white ${
              votingEnabled ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
            }`}
          >
            Voting is {votingEnabled ? "ON. Click to hide the buttons" : "OFF. Click to bring them back"}
          </button>
        </div>

        {note && <p className="mb-4 text-sm text-red-700">{note}</p>}

        {reports.length === 0 ? (
          <p className="text-sm opacity-60">No reports yet.</p>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li
                key={r.id}
                className={`rounded-xl border p-4 ${
                  r.status === "fixed"
                    ? "border-green-300 bg-green-50"
                    : "border-red-200 bg-red-50"
                }`}
              >
                <p className="whitespace-pre-wrap text-[14px]">{r.body}</p>
                {r.gist && <p className="mt-1.5 text-[12px] italic opacity-70">{r.gist}</p>}
                {r.context && (
                  <pre className="mt-1.5 whitespace-pre-wrap break-words rounded bg-white/60 p-2 font-mono text-[11px] opacity-80">
                    {r.context}
                  </pre>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="opacity-60">
                    ▲ {r.ups} · ▼ {r.downs} · {r.source} ·{" "}
                    {new Date(r.created_at).toLocaleString()}
                    {r.fix_state !== "none" && ` · fix: yes ${r.fix_ups}/no ${r.fix_downs}`}
                    {r.fix_target && ` · ${r.fix_target} fix`}
                    {r.fix_shipped_in && ` · shipped in ${r.fix_shipped_in}`}
                  </span>
                  <span className="ml-auto flex flex-wrap gap-2">
                    <AgentButton run={runs[r.id]} onRun={() => sendToAgent(r.id)} />
                    {r.fix_state && r.fix_state !== "none" && (
                      <button
                        type="button"
                        onClick={() => markShipped(r)}
                        className={`rounded-full px-3 py-1 ${
                          r.fix_shipped_in
                            ? "border border-[#171717]/30 hover:bg-[#171717]/5"
                            : "bg-[#171717] text-white hover:bg-black"
                        }`}
                      >
                        {r.fix_shipped_in ? "Change shipped mark" : "Mark fix shipped"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setStatus(r.id, r.status === "fixed" ? "open" : "fixed")}
                      className={`rounded-full px-3 py-1 text-white ${
                        r.status === "fixed"
                          ? "bg-red-600 hover:bg-red-700"
                          : "bg-green-600 hover:bg-green-700"
                      }`}
                    >
                      {r.status === "fixed" ? "Reopen (back to red)" : "Mark fixed (turn green)"}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(r.id)}
                      className="rounded-full border border-[#171717]/30 px-3 py-1 hover:bg-[#171717]/5"
                    >
                      Delete
                    </button>
                  </span>
                </div>

                {runs[r.id] && (
                  <RunPanel
                    run={runs[r.id]}
                    open={openRun === r.id}
                    onToggle={() => setOpenRun(openRun === r.id ? null : r.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
