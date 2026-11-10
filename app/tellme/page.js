"use client";

// /tellme — where anyone tells JustClarify what went wrong, in their own words.
//
// The rules of the board, all user-set:
//   - The textbox asks one thing: "Tell me what happened."
//   - "Make it read better" paraphrases their words for clarity — same
//     meaning, same length, their call to keep it or undo it. Nothing posts
//     un-chosen.
//   - Every report carries "what the agent understood" — readers must open
//     that line before the vote buttons appear, so a vote is always a vote on
//     the meaning, not the spelling.
//   - The first time anyone ever votes, one question, right at the button:
//     did you actually test it? Asked once, never again.
//   - Red means not fixed yet. Green means fixed. Flipped from the admin
//     panel, never from here.

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Analytics } from "@vercel/analytics/react";
import SiteHeader from "@/components/site-header";
import "./card.css";

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
//
// The colour lives in the words, and in nothing else. It was a tinted pill with
// a ring round it and a dot inside, which is three containers deep for a fact
// that is already written out in full: the dot restated the label, the fill
// restated the dot, and the ring drew a box round the restatement.
//
// The extension settled this argument first. The fact-check panel used to hang
// its verdicts on white pills and took them off — "these now carry 15px text
// rather than sitting on a white pill, so they have to hold contrast against
// #fff at weight 600" — which is why these hexes are its hexes rather than a
// palette's default 700s. Set in the state's own colour at 600, the status is
// the only coloured thing in a grey line and needs no shape around it to be
// found. Purple and teal are mixed to the same recipe: darkened until they
// hold at 11.5px on white, not lifted off a ramp.
const STATES = {
  open: { label: "Not fixed yet", tone: "#c00000" },
  looking: { label: "Being looked at", tone: "#9a600b" },
  fixed: { label: "Fixed", tone: "#0a7b38" },
  idea: { label: "Suggestion", tone: "#5f3d9e" },
  added: { label: "Added", tone: "#0b6c92" },
  filtered: { label: "Filed away", tone: "#6b645e" },
};

/* A state is two things: what to call it, and what colour it is. The name is
   for the key and for screen readers; the colour is what a card actually
   shows. There is no Tailwind class here any more because nothing on a card
   writes a state out in coloured text — the chip takes the raw value through a
   CSS variable, where a utility class could not reach it anyway.

   These six hexes are not off a ramp. The extension settled the argument
   first: its fact-check panel took its verdicts off white pills — "these now
   carry 15px text rather than sitting on a white pill, so they have to hold
   contrast against #fff at weight 600" — so each was darkened by eye until it
   held at 11.5px on white, rather than lifted from a palette's 700s. Doing it
   that way landed all six within a few points of the same perceptual
   lightness, and that is worth keeping: it is why a column of chips reads as
   one family rather than six unrelated inks.

   Three of them were re-cut once the chip started showing them at full
   strength rather than faded to a wash, which is a much less forgiving place
   for a colour to be.

     looking  #8a5d00 -> #9a600b   The old one was dark enough to read brown
                                   at a glance, and brown is not a state, it
                                   is a colour that failed to be amber.
     fixed    #0b6b2d -> #0a7b38   Lifted and cleaned. The old green was so
                                   dark that the dither's white gaps did most
                                   of the talking and it came out grey-green.
     added    #0a6a68 -> #0b6c92   Was teal, 43 degrees of hue from the fixed
                                   green — two greens on one board, and the
                                   two happiest states at that. Blue puts 82
                                   degrees between them, so "we built the
                                   thing you asked for" and "we repaired the
                                   thing that broke" stop looking like news of
                                   the same kind.

   If a seventh state ever needs a colour: match the weight of these on white
   first, then pick a hue with room around it. */

/* --- Depth ------------------------------------------------------------------
   Two shadows doing two different jobs, which is the whole trick to a card
   that looks placed rather than drawn. The 1px contact shadow sits the card ON
   the paper; the wide, heavily-negative-spread one lifts it OFF. Because the
   depth is carried by shadow, the outline only has to stop white-on-white from
   dissolving — hence a hairline at 9% rather than a drawn border.

   Hover adds lift, never a colour: the card rises about six more pixels of
   apparent height and nothing about it changes hue, so pointing at a report
   never reads as having changed its status. */
const CARD_SURFACE =
  "border-[#171717]/[0.09] bg-white " +
  "shadow-[0_1px_2px_rgba(23,23,23,0.05),0_8px_24px_-14px_rgba(23,23,23,0.18)] " +
  "hover:shadow-[0_1px_2px_rgba(23,23,23,0.05),0_16px_36px_-16px_rgba(23,23,23,0.24)]";

// Filed-away reports stay legible but sit back INTO the page rather than off
// it: no lift at all, so the drawer at the bottom never competes with the live
// board above it even when it is longer than the board.
const CARD_QUIET = "border-[#171717]/[0.07] bg-[#171717]/[0.015]";

// A popover is a layer above the card, so it gets a visibly deeper version of
// the same two-part shadow rather than a different kind of edge.
//
// Nothing renders one at the moment. Its only user was the one-time "did you
// actually test it" question anchored to the report vote, which is off the card
// but not out of the file — see the note where it used to sit.
const POPOVER_SURFACE =
  "border border-[#171717]/10 bg-white shadow-[0_2px_6px_rgba(23,23,23,0.06),0_18px_40px_-12px_rgba(23,23,23,0.28)]";

/* Every disclosure on a card is this: the card's own state colour, a chevron,
   and a hairline rule that darkens with the label on hover. Colour and rule
   live in .jc-disclosure in card.css, because both are alpha mixes off a
   variable set per card and neither survives as a utility class.

   12px, under the 15px of the report itself and under the 13.5px of the
   category above it. It was 13px, close enough to the writing to compete with
   it, and a card that offers you a control at nearly the size of the thing
   the control is about has its emphasis backwards — you read the report first,
   and the ways of asking it for more are what you find afterwards. The
   underline offset comes in to 3px with the text, so the rule stays the same
   distance from the letters rather than drifting away as they shrink.

   The underline came off once, on the grounds that three dotted ones stacked
   down a card put the page's heaviest texture under the three lines nobody had
   opened, and that dotted-underlined text on white reads as a broken link. All
   true of a DOTTED rule at full strength. A solid hairline at 20%, offset four
   pixels clear of the descenders, does the opposite job: it is barely visible
   as a line and completely visible as a boundary, which is what tells a
   half-attentive reader that this grey sentence is a thing to press and the
   grey sentence in the stamp line below is not. Without it the only thing
   marking a control was a chevron the width of six pixels. */
const DISCLOSURE = "jc-disclosure text-left text-[12px] font-medium underline underline-offset-[3px]";

/* Every vote on the board is this pill, in one of two states.
   Cast reads as filled and darker; uncast reads as a hairline outline. The old
   pair was outline-white against outline-translucent-white, which on a tinted
   card was just about legible and on a white one is not a difference at all.
   The press-scale is here rather than on hover because the answer to "did that
   register" has to arrive on pointer-down, before the round trip. */
function votePill(on, small = false) {
  const size = small ? "px-2.5 py-[3px] text-[12px]" : "px-2.5 py-1 text-[13px]";
  return `inline-flex items-center gap-1.5 rounded-full border tabular-nums transition-[background-color,border-color,transform] duration-150 active:scale-[0.97] disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100 ${size} ${
    on
      ? "border-[#171717]/20 bg-[#171717]/[0.07] font-semibold text-[#171717]"
      : "border-[#171717]/[0.13] text-[#171717]/65 hover:border-[#171717]/25 hover:bg-[#171717]/[0.04] hover:text-[#171717]"
  }`;
}

// Being looked at outranks the kind: it is news, and it is the same news for a
// fault and for a wish. Everything else follows from what the report is.
// Seven ways in, one per load. None of them is a real request or a real
// correction, on purpose: an example that names a feature gets copied, and then
// the board fills with the placeholder's idea instead of the reader's. These
// name nothing. They only show the register — half-formed, unpolished, said out
// loud — which is the one thing the page has to prove is allowed.
const PROMPTS = [
  "e.g. it worked yesterday, now it doesn't, no idea what I did",
  "e.g. I clicked the thing and nothing happened, twice",
  "e.g. not broken exactly, just annoying",
  "e.g. this part confuses me every single time",
  "e.g. would it be mad if it just... didn't do that?",
  "e.g. small thing, but it has bugged me for weeks",
  "e.g. I can't explain it properly, it just feels off",
];

// Shown on an attachment, so a 4MB screenshot is visibly a 4MB screenshot.
function fileSize(bytes) {
  if (!bytes) return "Image";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

  // No box and no headline of its own. It used to be a bordered, tinted panel
  // that opened with "A fix has been written for this." — which is now the
  // label on the disclosure you press to get here, and a box drawn inside the
  // gist's own box is two frames around one thought. What is left is the part
  // that was always the content: what state the fix is in, the code, the vote.
  return (
    <div className="w-full">
      <p className="text-[12px] leading-relaxed opacity-75">{subline}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggleCode}
          className="text-[12px] font-medium text-[#171717]/60 transition-colors hover:text-[#171717]"
        >
          {showing ? "Hide the code ▾" : "See exactly what changed ▸"}
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
                          className="w-full rounded-lg border border-[#171717]/10 bg-white"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {fix.summary && (
                <p className="mt-1 whitespace-pre-wrap rounded-lg border border-[#171717]/[0.07] bg-white p-2.5 text-[13px] leading-relaxed">
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
            className={votePill(mine === 1, true)}
          >
            Yes {report.fix_ups || 0}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => vote(-1)}
            className={votePill(mine === -1, true)}
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
function AgentThread({ report, label, tone }) {
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

  // A fragment, not a wrapper: the trigger has to sit in the same flex row as
  // the other disclosure on the card, and the panel has to break out onto a
  // line of its own underneath. One box around both could not do both.
  return (
    <>
      <button type="button" onClick={toggle} className={DISCLOSURE} style={{ "--jc-tone": tone }}>
        {label}
        {open ? " ▾" : " ▸"}
      </button>

      {open && (
        <div className="w-full space-y-2">
          {loading && <p className="text-[12px] opacity-60">Loading…</p>}
          {data?.error && <p className="text-[12px] opacity-70">{data.error}</p>}
          {!loading && !data?.error && notes.length === 0 && (
            <p className="text-[12px] opacity-70">
              Someone is looking at this. The outcome gets posted here once it is settled.
            </p>
          )}
          {notes.map((n, i) => (
            <div key={i} className="rounded-xl bg-[#171717]/[0.035] p-2.5">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{n.body}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// The four ways the field can move, straight from /dither.
//
//   both   the ramp orbits AND the level pumps — the full effect
//   orbit  only the gradient travels; dot density holds
//   pump   the gradient is nailed down and the whole field walks up and down
//          through the 64 thresholds, which boils in place
//   sweep  the blobs are replaced by one bright band crossing left to right
//
// Which one a card gets is drawn from its id, not from Math.random(). A random
// draw at render time would deal a card a new motion on every keystroke in the
// filter box and every page of the list, so the same report would move
// differently each time you looked at it — which is not variety, it is noise.
// Hashing the id fixes each report's motion for the life of the report while
// still spreading the four evenly across a board. When the poster starts
// choosing a motion at submit time, report.motion takes over and this becomes
// the fallback for everything already on the board.
const MOTIONS = ["both", "orbit", "pump", "sweep"];

function motionFor(report) {
  if (MOTIONS.includes(report.motion)) return report.motion;
  const id = String(report.id || "");
  // FNV-1a. Four lines, and unlike a length- or charCode-sum it does not
  // clump when the ids are sequential, which most of these are.
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return MOTIONS[(h >>> 0) % MOTIONS.length];
}

// The chip on the stamp line of every card: an 80x20 window onto the
// ordered-dither stack documented at /dither.
//
// It does two jobs at once, which is the only reason it earns the space. It IS
// the status — since the state word came off the card, the colour of this
// chip is the whole of what a card says about where it has got to. And it
// is the one thing on a page of white cards with any texture in it, which is
// how the board says something is running here without writing that down. So
// it idles, quickens while the pointer is on the card, and eases back down
// when it leaves.
//
// The rate is ramped through the Web Animations API rather than by swapping
// animation-duration on hover. Re-declaring a duration re-derives the phase
// from elapsed time, which snaps the field to a new position the instant you
// point at it; updatePlaybackRate keeps the current time and only changes how
// fast it advances from here, so the speed-up is seamless. The ramp itself is
// a short exponential chase — stepping straight to 3.4x reads as a jolt, and
// the whole point of the gesture is that it never announces itself.
function DitherChip({ hot, quiet, tone, motion, size }) {
  const ref = useRef(null);
  const rate = useRef(1);
  const frame = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.getAnimations !== "function") return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const anims = el.getAnimations({ subtree: true });
    if (!anims.length) return;

    // 1.7x, not the 3.4x this started at. Against a 9s orbit, 3.4 was a chip
    // that lunged when you pointed at it — which announces the gesture instead
    // of rewarding it. Under 2x the chip is recognisably the same chip going a
    // little faster, which is the whole effect.
    const target = hot ? 1.7 : 1;
    cancelAnimationFrame(frame.current);

    const step = () => {
      const gap = target - rate.current;
      rate.current = Math.abs(gap) < 0.015 ? target : rate.current + gap * 0.13;
      for (const a of anims) {
        // Safari kept updatePlaybackRate behind a flag longer than the rest;
        // the plain setter jumps nothing at these rates, it just is not seamless.
        if (typeof a.updatePlaybackRate === "function") a.updatePlaybackRate(rate.current);
        else a.playbackRate = rate.current;
      }
      if (rate.current !== target) frame.current = requestAnimationFrame(step);
    };
    step();

    return () => cancelAnimationFrame(frame.current);
  }, [hot]);

  return (
    <span
      ref={ref}
      className="jc-dither"
      data-hot={hot ? "true" : "false"}
      data-quiet={quiet ? "true" : "false"}
      data-motion={motion}
      data-size={size}
      /* The chip is 1-bit: a pixel is either the tone or the paper, with
         nothing in between to carry a tint. So the status colour goes in as
         the dark end of the ramp itself and the dots come out in it. */
      style={{ "--jc-lo": tone }}
      aria-hidden="true"
    >
      <span className="jc-dither-cut">
        <span className="jc-dither-ramp" />
        <span className="jc-dither-lift" />
        <span className="jc-dither-sink" />
      </span>
      <span className="jc-dither-tint" />
    </span>
  );
}

function ReportCard({ report, votingEnabled, onCounts, onFixCounts }) {
  const fixed = report.status === "fixed";
  const [gistOpen, setGistOpen] = useState(false);
  const [hot, setHot] = useState(false); // pointer or focus is inside this card
  const [fixOpen, setFixOpen] = useState(false);
  const [asking, setAsking] = useState(null); // 1 | -1 while the one-time question is up
  const [mine, setMine] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMine(myVotes()[report.id] || 0);
  }, [report.id]);

  // The gate: the agent's reading must be opened before voting exists at all.
  // A report whose gist never generated has nothing to gate on — votes show.
  const votesVisible = votingEnabled && (gistOpen || !report.gist);

  /* --- The report vote, kept wired but not rendered ------------------------
     Nothing on the card calls into any of this right now. It stays because the
     two hard parts are here and would have to be rebuilt from nothing: the
     gate that refuses to show a vote until the agent's reading has been opened
     — so a vote is always a vote on the meaning rather than the spelling — and
     the one-time question that asks, once ever, whether the person actually
     tested it. Both are user-set rules of the board, not decoration.

     Re-rendering the pills is the whole of putting it back. Everything below
     already works: the round trip, the retraction-on-repeat, the per-voter
     bucket in localStorage. */
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

  // Something has actually been DONE about this report — code written for it,
  // or a note posted saying how it went. Either one is an outcome and gets the
  // same door; nothing has been done is the third case and gets no door at all.
  const hasFix = !!report.fix_state && report.fix_state !== "none";
  const outcome = report.notes > 0 || hasFix;
  const state = stateOf(report, fixed, looking);
  const quiet = state === "filtered";

  // Both doors to what was done, in the order a reader would ask for them:
  // what was written, then how it went. Built once and placed twice, because
  // they belong at the foot of the gist panel and have to fall back into the
  // row above it on the rare report that has no gist to open.
  //
  // The fix used to render as a bordered panel on the card itself, outside
  // this chain entirely — so the loudest thing on a fixed report was a box
  // announcing a fix, sitting above an unopened line saying what the agent
  // thought the report was about. Behind the same kind of disclosure as
  // everything else, it takes its turn.
  // A report that was looked at and NOT taken forward has an outcome too, and
  // "How this ended" is the wrong door for it: it promises a conclusion to work
  // that was never started. What a reader wants there is the reason it was set
  // down, so the label says that instead. Two labels, because there are two
  // genuinely different things behind this button and one word for both would
  // make the honest half sound evasive.
  const outcomeLabel = state === "filtered" ? "Why this was not taken forward" : "How this ended";

  // One colour for the whole card: the chip is dithered in it and every control
  // is written in it. Read once here so a card can never disagree with itself.
  const tone = STATES[state].tone;

  const outcomeControls = (
    <>
      {hasFix && (
        <button
          type="button"
          onClick={() => setFixOpen((v) => !v)}
          className={DISCLOSURE}
          style={{ "--jc-tone": tone }}
        >
          A fix has been written{report.fix_state === "verified" ? " and confirmed" : ""}
          {fixOpen ? " ▾" : " ▸"}
        </button>
      )}
      {hasFix && fixOpen && (
        <FixStrip report={report} votingEnabled={votingEnabled} onFixCounts={onFixCounts} />
      )}
      {report.notes > 0 && (
        <AgentThread report={report} label={outcomeLabel} tone={tone} />
      )}
    </>
  );

  // Square. The marker radius this ran on - 16/4 on opposing corners - was
  // doing the work of separating one report from the next, and the hatch band
  // now does that job better and at the top of the card rather than around its
  // edges. Two devices for one purpose left the corners reading as styling; a
  // right angle reads as a sheet of paper, which is what a report is.
  //
  // The frame is 14/12, not the 16/20 a card usually gets. These hold two or
  // three lines of writing each and stack nine to a page, so padding that
  // would look considered around a single card compounds down a column into a
  // board that is mostly white space between things you are trying to compare.
  // Slightly less vertical than horizontal, because the stamp line and the
  // title already carry their own gaps and the frame is stacked on top of them.
  return (
    <li
      className={`jc-card rounded-none border px-3.5 pb-3 pt-5 transition-shadow duration-200 motion-reduce:transition-none md:px-4 md:pb-3.5 md:pt-[22px] ${
        quiet ? CARD_QUIET : CARD_SURFACE
      }`}
      /* The hatch band across the head of the card is drawn in the report's own
         state colour, so --jc-tone is set on the card itself rather than on each
         control; the disclosures below inherit it from here. */
      style={{ "--jc-tone": tone }}
      data-quiet={quiet ? "true" : "false"}
      /* Focus counts as hover for the chip, so tabbing down the board gets the
         same signal a pointer does rather than a column of dead marks. */
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
    >
      {/* The band across the head of the card: the same dithered field as the
          chip on the stamp line, in the same state colour, run the width of the
          card. It replaced ruled hatching, which was a second texture doing the
          first one's job. Same motion as this card's chip, so the two ends of a
          card move together rather than reading as two separate things
          running. */}
      <DitherChip
        hot={hot}
        quiet={quiet}
        tone={tone}
        motion={motionFor(report)}
        size="band"
      />

      {/* The triage word, promoted to the card's title. It used to be the last
          item of a grey run-in line, at 11.5px, after the status and the date
          and sometimes a pickup date — which is to say it was the smallest and
          least-placed thing on a card whose entire subject it names. At the top
          left in ink at 13.5px it does the job a title does: tells you what
          this one is about before you have read a word of it.

          Not every report has one. The classifier tags what it can and leaves
          the rest null, and there is nothing honest to invent for those, so the
          card simply starts with the writing. The stamp line at the foot is
          what makes every card end the same way; the top is allowed to vary. */}
      {report.category && (
        <h3
          className={`mb-2 text-[13.5px] font-semibold leading-snug tracking-[-0.005em] ${
            quiet ? "text-[#171717]/60" : "text-[#171717]/85"
          }`}
        >
          {CATEGORY_LABEL[report.category] || report.category}
        </h3>
      )}

      <p
        className={`whitespace-pre-wrap text-[15px] leading-relaxed ${
          quiet ? "text-[#171717]/70" : "text-[#171717]"
        }`}
      >
        {report.body}
      </p>

      {report.screenshot_url && (
        <a href={report.screenshot_url} target="_blank" rel="noopener noreferrer" className="mt-2 block w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={report.screenshot_url}
            alt="Screenshot attached to this report"
            className="max-h-40 rounded-xl border border-[#171717]/10"
            loading="lazy"
          />
        </a>
      )}

      {report.context && (
        <details className="mt-2.5 text-xs text-[#171717]/65">
          <summary className="cursor-pointer select-none hover:text-[#171717]">
            The error that came with it
          </summary>
          <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-lg bg-[#171717]/[0.035] p-2.5 font-mono text-[11px]">
            {report.context}
          </pre>
        </details>
      )}

      {/* Both disclosures on one line, both panels underneath. Stacked, they
          were two full-width rows of link that made every card look like it
          had a menu in it; side by side they read as what they are, two small
          ways to ask the card for more.

          Order is deliberate: triggers first in the DOM so they land in the
          first flex line, panels after with `w-full` so each one breaks onto a
          line of its own rather than shouldering into the row. */}
      {(report.gist || outcome) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {report.gist && (
            <button
              type="button"
              onClick={() => setGistOpen((v) => !v)}
              className={DISCLOSURE}
              style={{ "--jc-tone": tone }}
            >
              {gistOpen ? "What the agent understood ▾" : "What the agent understood ▸"}
            </button>
          )}

          {/* The outcome is reachable without the gist ONLY when there is no
              gist to open. Everywhere else it is inside the panel below, behind
              the reading — see the note there. */}
          {!report.gist && outcome && (
            <div className="flex w-full flex-col items-start gap-2">{outcomeControls}</div>
          )}

          {gistOpen && report.gist && (
            <div className="w-full rounded-xl bg-[#171717]/[0.035] p-2.5">
              <p className="text-[13px] italic leading-relaxed text-[#171717]/85">{report.gist}</p>

              {/* Where "picked up" belongs: inside the reading, not beside it.
                  Someone opening this panel is asking what is being done about
                  their report, and that a person has it is the answer to that
                  question — where a disclosure of its own was a second door to
                  one sentence. */}
              {looking && (
                <p className="mt-2 border-t border-[#171717]/[0.07] pt-2 text-[12px] leading-relaxed text-[#171717]/60">
                  Someone is looking at this. The outcome gets posted here once it is settled.
                </p>
              )}

              {/* The outcome hangs off the bottom of the reading, in the same
                  disclosure style as the control that opened it, so the two
                  read as one chain rather than as two unrelated links sitting
                  side by side above the panel.

                  Which means the gist has to be opened first, and that is the
                  point rather than a side effect. It is the rule the votes
                  already follow — you see what the agent understood before you
                  are allowed to pass judgement on it — and the same argument
                  applies harder here: "how this ended" is only worth anything
                  if you know what it thought it was ending. Someone who reads
                  the fix without the reading is judging an answer to a question
                  they never saw. */}
              {outcome && (
                <div className="mt-2 flex flex-col items-start gap-2 border-t border-[#171717]/[0.07] pt-2">
                  {outcomeControls}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* The report vote used to sit here: two pills, an up and a down, gated
          behind opening the agent's reading, with a one-time "did you actually
          test it" question anchored to the button. Taken off the card, not out
          of the file — castVote, voteClicked, confirmFirstVote, the /vote
          round trip, the per-voter localStorage buckets and the votesVisible
          gate are all still below, wired and working, waiting on the decision
          to show them again. Deleting them would mean rebuilding the gate and
          the one-time question from scratch, and those were the hard parts.

          What is left on a card is a report, what was understood of it, and
          what was done. Nothing to press an opinion into. */}

      {/* The stamp line. Every card ends with exactly this, whatever else it
          did or did not have above — no category, no screenshot, no fix, it
          still ends here — and that is the whole point of it. Chip hard left,
          date hard right, a hairline above holding them off the writing. A
          column of cards therefore has two straight rails running down it, one
          of chips and one of dates, and neither moves when a report is three
          lines instead of thirty.

          ml-auto rather than justify-between: the provenance items between the
          two vary in number, and justify-between would space THEM out too and
          then drag the date onto the wrapped line on a narrow card. Pushed off
          whatever the last left item happens to be, the date stays pinned. */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 border-t border-[#171717]/[0.07] pt-2.5 text-[11.5px] text-[#171717]/50">
        {/* The chip, and nothing written out beside it. The word — "Fixed",
            "Not fixed yet" — used to sit here and it was the same fact twice:
            the key above the board teaches the five colours once, and after
            that a coloured band is read faster than a word is, which is the
            only thing this line is for. Taking it out also gives the row back
            to the two things that vary per report rather than per state.

            sr-only, not gone: a colour is nothing at all to a screen reader,
            so the label is the whole status for anyone not looking at it. */}
        <span className="sr-only">{STATES[state].label}</span>
        <DitherChip
          hot={hot}
          quiet={quiet}
          tone={tone}
          motion={motionFor(report)}
          size="stamp"
        />
        {report.source === "extension" && <span>· reported from an error in the extension</span>}
        <span className="ml-auto shrink-0 pl-3 tabular-nums">{timeAgo(report.created_at)}</span>
      </div>
    </li>
  );
}

// The status key, in two shapes from one source: a row above the composer on
// narrow screens, a stacked rail pinned in the left margin on wide ones. The
// colours ARE the status of the whole board, so they stay on screen rather than
// hiding behind a "what do the colours mean" link.
//
// Label only. "Not fixed yet / Broken, nobody on it yet" said the same thing
// twice, and the label is the half that is already straight to the point.
const KEY_ORDER = ["open", "looking", "fixed", "idea", "added"];

function StatusKey({ stacked = false }) {
  return (
    <ul className={stacked ? "space-y-3.5" : "flex flex-wrap gap-x-4 gap-y-1.5"}>
      {KEY_ORDER.map((key) => (
        <li
          key={key}
          className={`flex items-center text-[11.5px] leading-snug ${stacked ? "gap-2.5" : "gap-1.5"}`}
        >
          {/* The key is the real thing, not a swatch of it. Now that the cards
              have stopped writing the state out in words, this is where a
              reader learns the five colours, and a flat swatch would teach
              them against a texture they never see again — they would be
              matching a solid shape to a field of dots.

              Held still, though. Five chips drifting in the margin next to a
              board of chips already drifting is a page with nothing at rest on
              it, and the key is reference material: it should sit there and be
              looked up. Still also means the pattern is identical across all
              five, so the only thing varying down the column is the one thing
              the key is about. */}
          <DitherChip tone={STATES[key].tone} motion="still" size="key" />
          <span className="font-medium text-[#171717]/80">{STATES[key].label}</span>
        </li>
      ))}
    </ul>
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
  const [dragOver, setDragOver] = useState(false);
  // Index, not the string: rolling it during render would make the prerendered
  // HTML and the first client render disagree, which React calls a hydration
  // error. Zero on the server, a real roll the moment this is interactive.
  const [prompt, setPrompt] = useState(0);
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
    setPrompt(Math.floor(Math.random() * PROMPTS.length));
  }, []);

  // Seven letters of actual words, not seven keystrokes: "asdfgh" and "??!!"
  // have nothing in them to reword, and a button that appears over them looks
  // broken the moment it is pressed. Nothing else is gated on this — a short
  // report still posts, and the classifier on the way in is what decides
  // whether gibberish, jargon or a compliment belongs on the board.
  const canReword = (text.match(/\p{L}/gu) || []).length >= 7;

  // The box grows with the writing rather than making anyone drag a corner,
  // and stops at a screenful so the board underneath never gets pushed off.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 420)}px`;
  }, [text]);

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
        setNote({ text: data.error || "Couldn't reword that just now. Your words work as they are.", ok: false });
      }
    } catch (_) {
      setNote({ text: "Couldn't reword that just now. Your words work as they are.", ok: false });
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
      if (res.ok && data.url) setShot({ url: data.url, name: file.name, size: file.size });
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
      <SiteHeader />

      {/* Three tracks, not two: equal gutters keep the writing column dead
          centre on the page while the key sits in the left one. */}
      <main className="mx-auto grid w-full max-w-[84rem] grid-cols-1 px-6 pb-24 pt-4 md:px-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,46rem)_minmax(0,1fr)] xl:gap-x-10">
        {/* Everything above the board sits in the writing column alone. */}
        <div className="mx-auto w-full min-w-0 max-w-2xl xl:col-start-2 xl:max-w-none">
          <h1 className="mb-2 text-2xl font-semibold text-accent md:text-3xl">
            Tell me what happened
          </h1>
          <p className="mb-3 text-sm leading-relaxed text-[#171717]/70">
            Something broke, or got in your way? Say it however it comes out and I send it to the
            coding agent.
          </p>

          {/* Narrow screens have no margin to pin anything to, so the key sits
              in the column the way it always did. */}
          <div className="mb-8 xl:hidden">
            <StatusKey />
          </div>

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

          {/* One surface, not three: the box, the actions and the count live
              inside a single sheet that lights up as a whole on focus, so the
              thing you are writing into reads as one object. Square,
              same as the cards it will become. */}
          <div
            onDragOver={(e) => {
              // Only images, and only when something is actually being carried.
              if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              // Crossing into a child fires dragleave on the parent. Ignore
              // those, or the overlay strobes as the cursor moves.
              if (e.currentTarget.contains(e.relatedTarget)) return;
              setDragOver(false);
            }}
            onDrop={(e) => {
              const file = e.dataTransfer?.files?.[0];
              if (!file) return;
              e.preventDefault();
              setDragOver(false);
              attachShot(file);
            }}
            className={`relative rounded-none border bg-white shadow-[0_1px_2px_rgba(23,23,23,0.05),0_10px_28px_-14px_rgba(23,23,23,0.20)] transition-[border-color,box-shadow] duration-200 focus-within:shadow-[0_1px_2px_rgba(23,23,23,0.05),0_20px_44px_-16px_rgba(23,23,23,0.26)] ${
              dragOver ? "border-accent" : "border-[#171717]/[0.09] focus-within:border-accent"
            }`}
          >
            {dragOver && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-none border-2 border-dashed border-accent bg-white/85 text-[13px] font-medium text-accent">
                Drop the image to attach it
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
              placeholder={PROMPTS[prompt]}
              rows={4}
              className="block w-full resize-none bg-transparent px-4 pb-2 pt-4 text-[15px] leading-relaxed outline-none placeholder:text-[#171717]/35"
            />

            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => attachShot(e.target.files?.[0])}
            />

            {/* The screenshot sits inside the sheet, above the actions, because
                it is part of what you are about to post rather than a setting. */}
            {shot && (
              <div className="mx-4 mb-3 flex items-center gap-3 rounded-lg border border-[#171717]/10 bg-[#171717]/[0.02] p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shot.url}
                  alt="Attached screenshot"
                  className="h-11 w-11 shrink-0 rounded-md border border-[#171717]/10 object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {shot.name || "Screenshot"}
                  </span>
                  <span className="block text-[11.5px] opacity-55">
                    {fileSize(shot.size)} · shows publicly with your report
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setShot(null)}
                  aria-label="Remove the attached image"
                  className="shrink-0 rounded-full px-2 py-1 text-[13px] opacity-50 transition-colors hover:bg-[#171717]/5 hover:opacity-100"
                >
                  Remove
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1 border-t border-[#171717]/[0.07] px-2.5 py-2">
              {!shot && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  title="A picture of the problem helps a lot for anything visual. Drag one in, paste it, or pick a file. It will be shown publicly with your report."
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] text-[#171717]/70 transition-colors hover:bg-[#171717]/5 hover:text-[#171717] disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className={uploading ? "animate-pulse" : undefined}
                  >
                    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
                    <circle cx="8.6" cy="10" r="1.4" />
                    <path d="m3.6 17.2 4.3-4.1a1.9 1.9 0 0 1 2.6 0l4.2 4.1" />
                    <path d="m14 14.4 1.6-1.5a1.9 1.9 0 0 1 2.6 0l2.2 2.1" />
                  </svg>
                  {uploading ? "Uploading…" : "Image"}
                </button>
              )}
              {canReword && (
                <button
                  type="button"
                  onClick={tidy}
                  disabled={tidying}
                  title="Rewrites what you wrote so it reads more clearly. Same meaning, same length, and one press puts your own words back."
                  className="rounded-full px-2.5 py-1.5 text-[13px] text-[#171717]/70 transition-colors hover:bg-[#171717]/5 hover:text-[#171717] disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  {tidying ? "Rewording…" : "Make it read better"}
                </button>
              )}
              {original != null && (
                <button
                  type="button"
                  onClick={() => {
                    setText(original);
                    setOriginal(null);
                  }}
                  className="rounded-full px-2.5 py-1.5 text-[13px] text-[#171717]/70 underline underline-offset-4 transition-colors hover:bg-[#171717]/5 hover:text-[#171717]"
                >
                  Back to my words
                </button>
              )}

              {/* The count only speaks up when it is about to matter. */}
              <span
                className={`ml-auto pr-1 text-[11.5px] tabular-nums transition-opacity ${
                  text.length > 1800 ? "text-red-600 opacity-100" : "opacity-0"
                }`}
              >
                {2000 - text.length} left
              </span>
              <button
                type="button"
                onClick={post}
                disabled={busy || !text.trim()}
                className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-30"
              >
                {busy ? "Posting…" : "Post it"}
              </button>
            </div>
          </div>

          {note && (
            <p className={`mt-3 text-sm ${note.ok ? "text-green-700" : "text-red-700"}`}>
              {note.text}
            </p>
          )}

        </div>

        {/* The key belongs to the board, so it starts level with it rather
            than with the headline, then pins as the cards scroll past. */}
        <aside className="hidden xl:col-start-1 xl:row-start-2 xl:block">
          <div className="sticky top-20 mt-12">
            <StatusKey stacked />
          </div>
        </aside>

        <div className="mx-auto w-full min-w-0 max-w-2xl xl:col-start-2 xl:row-start-2 xl:max-w-none">
          <h2 className="mb-3 mt-12 text-lg font-semibold">
            What others have said
            {live.length ? <span className="ml-1 font-normal opacity-50">({live.length})</span> : null}
          </h2>
          {reports == null ? (
            <p className="text-sm opacity-60">Loading reports…</p>
          ) : loadFailed ? (
            <p className="text-sm opacity-60">
              Can&apos;t reach the board right now. Nothing is lost, give it a reload.
            </p>
          ) : live.length === 0 ? (
            <p className="text-sm opacity-60">Nothing reported yet. Yours would be the first.</p>
          ) : (
            <ul className="space-y-4">
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
              className="mt-5 w-full rounded-xl border border-[#171717]/[0.12] py-2.5 text-sm text-[#171717]/70 transition-colors hover:border-[#171717]/25 hover:bg-[#171717]/[0.03] hover:text-[#171717]"
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
                className="text-[13px] font-medium text-[#171717]/50 transition-colors hover:text-[#171717] disabled:hover:text-[#171717]/50"
              >
                Filtered ({filtered.length}){filtered.length > 0 && (filteredOpen ? " ▾" : " ▸")}
              </button>
              {filtered.length > 0 && !filteredOpen && (
                <p className="mt-1 text-[11.5px] text-[#171717]/40">
                  Messages with nothing to fix or build in them. Nothing is deleted.
                </p>
              )}
              {filteredOpen && filtered.length > 0 && (
                <ul className="mt-3 space-y-3.5">
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
        </div>
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
