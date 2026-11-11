"use client";

// The interview board: open or close the interview, hand out share links, and
// read what students said.
//
// The headline is one table: for each topic, how many students raised it and
// how many raised it WITHOUT being asked. That second number is the reason the
// interview exists, so it is the default sort and it sits next to the quotes
// that back it up.
//
// Same sign-in as the tellme board (JC_ADMIN_KEY, kept in sessionStorage and
// sent in the request body). If you are already signed in there, this picks
// the key up.

import { useEffect, useState } from "react";

const KEY_STORE = "jcInterviewAdminKey";
const TELLME_KEY_STORE = "jcTellmeAdminKey";

const STATUS_LABEL = {
  active: "In progress",
  done: "Finished",
  support: "Support shown",
  ended: "Stopped",
  abandoned: "Abandoned",
};

function ago(iso) {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function Card({ title, children, right }) {
  return (
    <section className="rounded-2xl border border-[#ece7e3] bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Pill({ tone = "plain", children }) {
  const tones = {
    plain: "bg-[#14110f]/[0.06] text-[#3d3731]",
    good: "bg-[#1a7f37]/10 text-[#1a7f37]",
    bad: "bg-[#b3261e]/10 text-[#b3261e]",
    accent: "bg-accent-soft text-[#14110f]",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export default function InterviewAdminPage() {
  const [key, setKey] = useState("");
  const [entered, setEntered] = useState("");
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState(null);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState("");
  const [openTopic, setOpenTopic] = useState(null);
  const [openSession, setOpenSession] = useState(null); // { id, session, turns, ref }
  const [linkForm, setLinkForm] = useState({ label: "", max: "60", days: "" });
  const [copied, setCopied] = useState("");

  async function call(body, withKey) {
    const res = await fetch("/api/interview/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: withKey || key, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  async function refresh(withKey) {
    try {
      setData(await call({ action: "overview" }, withKey));
      setNote("");
    } catch (error) {
      setNote(String(error.message || error));
    }
  }

  async function signIn(candidate) {
    setNote("");
    try {
      await call({ action: "check" }, candidate);
      setKey(candidate);
      setAuthed(true);
      try {
        sessionStorage.setItem(KEY_STORE, candidate);
      } catch (_) {}
      refresh(candidate);
    } catch (error) {
      setAuthed(false);
      setNote(String(error.message || error));
    }
  }

  useEffect(() => {
    let saved = "";
    try {
      saved = sessionStorage.getItem(KEY_STORE) || sessionStorage.getItem(TELLME_KEY_STORE) || "";
    } catch (_) {}
    if (saved) signIn(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(label, body) {
    setWorking(label);
    setNote("");
    try {
      const result = await call(body);
      await refresh();
      return result;
    } catch (error) {
      setNote(String(error.message || error));
      return null;
    } finally {
      setWorking("");
    }
  }

  async function showSession(id) {
    if (openSession?.id === id) {
      setOpenSession(null);
      return;
    }
    try {
      const result = await call({ action: "session", id });
      setOpenSession({ id, ...result });
    } catch (error) {
      setNote(String(error.message || error));
    }
  }

  async function copyLink(code) {
    const url = `${window.location.origin}/interview?c=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(code);
      setTimeout(() => setCopied(""), 1500);
    } catch (_) {
      setNote(url);
    }
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#faf9f7] px-5 py-16 text-[#14110f]">
        <form
          className="mx-auto max-w-sm rounded-2xl border border-[#ece7e3] bg-white p-6"
          onSubmit={(event) => {
            event.preventDefault();
            signIn(entered);
          }}
        >
          <h1 className="text-[20px] font-bold">Interview board</h1>
          <p className="mt-1 text-[13px] text-[#6d645d]">Sign in with the admin key.</p>
          <input
            type="password"
            value={entered}
            onChange={(event) => setEntered(event.target.value)}
            placeholder="Admin key"
            autoComplete="current-password"
            className="mt-4 h-11 w-full rounded-xl border border-[#14110f]/15 px-3 text-[15px] outline-none focus:border-[#14110f]/40"
          />
          {note ? <p className="mt-3 text-[13px] font-medium text-[#b3261e]">{note}</p> : null}
          <button
            type="submit"
            className="mt-4 h-11 w-full rounded-xl bg-[#14110f] text-[14px] font-semibold text-white"
          >
            Sign in
          </button>
        </form>
      </div>
    );
  }

  const stats = data?.stats;
  const usage = data?.usage;
  const caps = data?.caps;
  const beatAt = data?.heartbeat?.at;
  const beatStale = !beatAt || Date.now() - new Date(beatAt).getTime() > 48 * 3_600_000;
  const topicLabel = Object.fromEntries((data?.topics || []).map((t) => [t.key, t.label]));

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-8 text-[#14110f] md:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-bold tracking-[-0.02em]">Interview board</h1>
            <p className="text-[13px] text-[#6d645d]">
              What students said, and what they raised without being asked.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => refresh()}
              className="h-9 rounded-lg border border-[#14110f]/15 bg-white px-3 text-[13px] font-semibold"
            >
              Refresh
            </button>
            <a href="/interview" className="h-9 rounded-lg px-2 text-[13px] font-semibold leading-9 underline underline-offset-2">
              Open the page
            </a>
          </div>
        </header>

        {note ? (
          <p className="rounded-xl border border-[#b3261e]/30 bg-[#b3261e]/5 px-4 py-3 text-[13px] font-medium text-[#b3261e]">
            {note}
          </p>
        ) : null}

        {!data ? (
          <p className="text-[14px] text-[#6d645d]">Loading.</p>
        ) : (
          <>
            <div className="grid gap-5 md:grid-cols-3">
              <Card
                title="Interview"
                right={<Pill tone={data.enabled && !data.hardDisabled ? "good" : "bad"}>{data.enabled && !data.hardDisabled ? "Open" : "Closed"}</Pill>}
              >
                <p className="text-[13px] leading-relaxed text-[#6d645d]">
                  {data.hardDisabled
                    ? "Switched off by the JC_INTERVIEW environment variable."
                    : data.enabled
                      ? "Students with a valid link can take part."
                      : "Nobody can start an interview."}
                </p>
                <button
                  type="button"
                  disabled={!!working || data.hardDisabled}
                  onClick={() => act("enabled", { action: "enabled", on: !data.enabled })}
                  className="mt-3 h-9 rounded-lg bg-[#14110f] px-3 text-[13px] font-semibold text-white disabled:opacity-40"
                >
                  {data.enabled ? "Close the interview" : "Open the interview"}
                </button>
              </Card>

              <Card title="Today">
                <dl className="space-y-1.5 text-[13px]">
                  <div className="flex justify-between"><dt className="text-[#6d645d]">Sessions</dt><dd className="font-semibold tabular-nums">{usage.sessions} / {caps.sessionsPerDay}</dd></div>
                  <div className="flex justify-between"><dt className="text-[#6d645d]">Model calls</dt><dd className="font-semibold tabular-nums">{usage.llm_calls} / {caps.llmCallsPerDay}</dd></div>
                  <div className="flex justify-between"><dt className="text-[#6d645d]">Voice minutes</dt><dd className="font-semibold tabular-nums">{Math.round(usage.stt_seconds / 60)} / {Math.round(caps.sttSecondsPerDay / 60)}</dd></div>
                </dl>
              </Card>

              <Card title="Database keep-alive" right={<Pill tone={beatStale ? "bad" : "good"}>{beatStale ? "Stale" : "Healthy"}</Pill>}>
                <p className="text-[13px] leading-relaxed text-[#6d645d]">
                  Last heartbeat: <span className="font-semibold text-[#14110f]">{ago(beatAt)}</span>. A job writes it every six hours so Supabase does not pause the project.
                </p>
                {beatStale ? (
                  <p className="mt-2 text-[13px] font-medium text-[#b3261e]">
                    No heartbeat in the last 48 hours. Check the cron job in Vercel.
                  </p>
                ) : null}
              </Card>
            </div>

            <Card
              title="What students raised"
              right={
                <span className="text-[12px] text-[#6d645d]">
                  {stats.withSummary} summarised of {stats.total} sessions
                  {stats.pending ? `, ${stats.pending} waiting` : ""}
                </span>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-[13px]">
                  <thead className="text-[11px] uppercase tracking-wide text-[#6d645d]">
                    <tr>
                      <th className="py-2 pr-3 font-semibold">Topic</th>
                      <th className="py-2 pr-3 font-semibold">Unprompted</th>
                      <th className="py-2 pr-3 font-semibold">Raised at all</th>
                      <th className="py-2 pr-3 font-semibold">Strong pain</th>
                      <th className="py-2 pr-3 font-semibold">Avg severity</th>
                      <th className="py-2 font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topics.map((topic) => (
                      <TopicRows
                        key={topic.key}
                        topic={topic}
                        total={stats.withSummary}
                        open={openTopic === topic.key}
                        onToggle={() => setOpenTopic(openTopic === topic.key ? null : topic.key)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {stats.pending ? (
                <button
                  type="button"
                  disabled={!!working}
                  onClick={() => act("pending", { action: "extract-pending" })}
                  className="mt-3 h-9 rounded-lg border border-[#14110f]/15 bg-white px-3 text-[13px] font-semibold disabled:opacity-40"
                >
                  {working === "pending" ? "Summarising" : `Summarise ${Math.min(5, stats.pending)} waiting`}
                </button>
              ) : null}
            </Card>

            <div className="grid gap-5 md:grid-cols-2">
              <Card title="Problems outside our list">
                {stats.other.length ? (
                  <ul className="space-y-3">
                    {stats.other.map((item, index) => (
                      <li key={index} className="text-[13px] leading-relaxed">
                        <p className="font-semibold">{item.problem}</p>
                        <p className="text-[#6d645d]">&ldquo;{item.quote}&rdquo; <span className="font-mono text-[11px]">{item.ref}</span></p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-[#6d645d]">Nothing yet. This is where surprises show up.</p>
                )}
              </Card>
              <Card title="Tools students named">
                {stats.tools.length ? (
                  <div className="flex flex-wrap gap-2">
                    {stats.tools.map((tool) => (
                      <Pill key={tool.name}>{tool.name} {tool.count}</Pill>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-[#6d645d]">Nothing yet.</p>
                )}
              </Card>
            </div>

            <Card title="Share links" right={<Pill>{data.linkRequired ? "Link required" : "Open to anyone"}</Pill>}>
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const made = await act("link", { action: "link-create", ...linkForm });
                  if (made) setLinkForm({ label: "", max: "60", days: "" });
                }}
              >
                <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[12px] font-semibold text-[#6d645d]">
                  Who it is for
                  <input
                    value={linkForm.label}
                    onChange={(event) => setLinkForm({ ...linkForm, label: event.target.value })}
                    placeholder="BIO201 group chat"
                    className="h-9 rounded-lg border border-[#14110f]/15 px-3 text-[13px] font-normal text-[#14110f] outline-none"
                  />
                </label>
                <label className="flex w-24 flex-col gap-1 text-[12px] font-semibold text-[#6d645d]">
                  Max students
                  <input
                    value={linkForm.max}
                    onChange={(event) => setLinkForm({ ...linkForm, max: event.target.value })}
                    inputMode="numeric"
                    className="h-9 rounded-lg border border-[#14110f]/15 px-3 text-[13px] font-normal text-[#14110f] outline-none"
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-[12px] font-semibold text-[#6d645d]">
                  Expires in days
                  <input
                    value={linkForm.days}
                    onChange={(event) => setLinkForm({ ...linkForm, days: event.target.value })}
                    inputMode="numeric"
                    placeholder="never"
                    className="h-9 rounded-lg border border-[#14110f]/15 px-3 text-[13px] font-normal text-[#14110f] outline-none"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!!working || !linkForm.label.trim()}
                  className="h-9 rounded-lg bg-[#14110f] px-3 text-[13px] font-semibold text-white disabled:opacity-40"
                >
                  Create link
                </button>
              </form>

              <ul className="mt-4 divide-y divide-[#ece7e3]">
                {data.links.length === 0 ? (
                  <li className="py-2 text-[13px] text-[#6d645d]">No links yet. Create one, then open the interview.</li>
                ) : null}
                {data.links.map((row) => (
                  <li key={row.code} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]">
                    <div className="min-w-0">
                      <p className="font-semibold">{row.label}</p>
                      <p className="truncate font-mono text-[11px] text-[#6d645d]">/interview?c={row.code}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums text-[#6d645d]">{row.sessions_used} / {row.max_sessions}</span>
                      <Pill tone={row.active ? "good" : "bad"}>{row.active ? "Active" : "Off"}</Pill>
                      <button type="button" onClick={() => copyLink(row.code)} className="h-8 rounded-lg border border-[#14110f]/15 px-2.5 text-[12px] font-semibold">
                        {copied === row.code ? "Copied" : "Copy link"}
                      </button>
                      <button
                        type="button"
                        disabled={!!working}
                        onClick={() => act("link-set", { action: "link-set", code: row.code, active: !row.active })}
                        className="h-8 rounded-lg border border-[#14110f]/15 px-2.5 text-[12px] font-semibold disabled:opacity-40"
                      >
                        {row.active ? "Turn off" : "Turn on"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card
              title="Sessions"
              right={
                <span className="flex flex-wrap gap-1.5">
                  {Object.entries(stats.byStatus).map(([status, count]) => (
                    <Pill key={status}>{STATUS_LABEL[status] || status} {count}</Pill>
                  ))}
                  {stats.degraded ? <Pill tone="bad">Safety check degraded {stats.degraded}</Pill> : null}
                </span>
              }
            >
              <ul className="divide-y divide-[#ece7e3]">
                {data.sessions.length === 0 ? <li className="py-2 text-[13px] text-[#6d645d]">No sessions yet.</li> : null}
                {data.sessions.map((row) => (
                  <li key={row.id} className="py-3 text-[13px]">
                    <button type="button" onClick={() => showSession(row.id)} className="flex w-full flex-wrap items-center gap-2 text-left">
                      <span className="font-mono text-[12px] font-bold">{row.ref}</span>
                      <Pill tone={row.status === "done" ? "good" : row.status === "support" ? "bad" : "plain"}>
                        {STATUS_LABEL[row.status] || row.status}
                      </Pill>
                      <span className="text-[#6d645d]">reached Q{row.reached}</span>
                      <span className="text-[#6d645d]">{ago(row.created_at)}</span>
                      {row.link_code ? <span className="font-mono text-[11px] text-[#6d645d]">{row.link_code}</span> : null}
                      {row.extract_error ? <Pill tone="bad">Summary failed</Pill> : null}
                      {row.topics.map((t) => (
                        <Pill key={t.topic} tone={t.unprompted ? "accent" : "plain"}>
                          {topicLabel[t.topic] || t.topic}{t.unprompted ? " (unprompted)" : ""}
                        </Pill>
                      ))}
                    </button>
                    {row.gist ? <p className="mt-1.5 leading-relaxed text-[#3d3731]">{row.gist}</p> : null}

                    {openSession?.id === row.id ? (
                      <div className="mt-3 rounded-xl border border-[#ece7e3] bg-[#faf9f7] p-4">
                        <ol className="space-y-3">
                          {openSession.turns.map((turn) => (
                            <li key={turn.idx} className="leading-relaxed">
                              <p className="font-semibold">
                                Q{turn.idx}. {turn.question}{" "}
                                <span className="font-mono text-[10px] font-normal text-[#6d645d]">
                                  {turn.question_topic} / {turn.question_via}
                                </span>
                              </p>
                              <p className="whitespace-pre-wrap text-[#3d3731]">
                                {turn.answer}{" "}
                                <span className="font-mono text-[10px] text-[#6d645d]">
                                  {turn.answer_via}{turn.redactions ? `, ${turn.redactions} redacted` : ""}
                                </span>
                              </p>
                            </li>
                          ))}
                          {openSession.turns.length === 0 ? <li className="text-[#6d645d]">No answers were given.</li> : null}
                        </ol>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={!!working}
                            onClick={() => act("extract", { action: "extract", id: row.id })}
                            className="h-8 rounded-lg border border-[#14110f]/15 bg-white px-2.5 text-[12px] font-semibold disabled:opacity-40"
                          >
                            {working === "extract" ? "Summarising" : "Summarise again"}
                          </button>
                          <button
                            type="button"
                            disabled={!!working}
                            onClick={async () => {
                              const done = await act("delete", { action: "delete", id: row.id });
                              if (done) setOpenSession(null);
                            }}
                            className="h-8 rounded-lg border border-[#b3261e]/40 bg-white px-2.5 text-[12px] font-semibold text-[#b3261e] disabled:opacity-40"
                          >
                            Delete this session
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function TopicRows({ topic, total, open, onToggle }) {
  const share = total ? Math.round((topic.unprompted / total) * 100) : 0;
  return (
    <>
      <tr className="border-t border-[#ece7e3]">
        <td className="py-2.5 pr-3 font-semibold">{topic.label}</td>
        <td className="py-2.5 pr-3">
          <span className="font-bold tabular-nums">{topic.unprompted}</span>
          {total ? <span className="text-[#6d645d]"> ({share}%)</span> : null}
        </td>
        <td className="py-2.5 pr-3 tabular-nums">{topic.raised}</td>
        <td className="py-2.5 pr-3 tabular-nums">{topic.severe}</td>
        <td className="py-2.5 pr-3 tabular-nums">{topic.avgSeverity || ""}</td>
        <td className="py-2.5 text-right">
          {topic.quotes.length ? (
            <button type="button" onClick={onToggle} className="text-[12px] font-semibold underline underline-offset-2">
              {open ? "Hide quotes" : `Quotes (${topic.quotes.length})`}
            </button>
          ) : null}
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={6} className="pb-3">
            <ul className="space-y-2 rounded-xl bg-[#faf9f7] p-3">
              {topic.quotes.map((quote, index) => (
                <li key={index} className="text-[13px] leading-relaxed">
                  <span>&ldquo;{quote.quote}&rdquo;</span>{" "}
                  {quote.unprompted ? <Pill tone="accent">unprompted</Pill> : null}{" "}
                  <Pill>severity {quote.severity}</Pill>{" "}
                  <span className="font-mono text-[11px] text-[#6d645d]">{quote.ref}</span>
                  {quote.note ? <span className="block text-[12px] text-[#6d645d]">{quote.note}</span> : null}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}
