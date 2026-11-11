"use client";

// The pieces the interview page is built from. They follow the anatomy of
// shadcn/ui's AI chat components (Button, Message, PromptInput, Suggestion,
// Shimmer) so the page reads as one of those, and their styling lives in
// interview.css, scoped under `.iv`. See the top of that file for why they are
// ported rather than installed, and for the motion rules they all follow.

import { useEffect, useRef, useState } from "react";

export function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

// --- icons (lucide's paths, inlined so the page adds no dependency) ----------

function Svg({ size = 16, children, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const MicIcon = (props) => (
  <Svg {...props}>
    <path d="M12 19v3" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <rect x="9" y="2" width="6" height="13" rx="3" />
  </Svg>
);
export const ArrowUpIcon = (props) => (
  <Svg {...props}>
    <path d="m5 12 7-7 7 7" />
    <path d="M12 19V5" />
  </Svg>
);
export const ArrowDownIcon = (props) => (
  <Svg {...props}>
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </Svg>
);
export const CheckIcon = (props) => (
  <Svg {...props}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);
export const BotIcon = (props) => (
  <Svg {...props}>
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </Svg>
);

export function Diamond({ size = 18 }) {
  return (
    <span className="inline-flex" style={{ color: "var(--accent, oklch(0.56 0.10 28))" }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <rect x="5" y="5" width="14" height="14" rx="3.5" transform="rotate(45 12 12)" fill="currentColor" />
        <rect x="9" y="9" width="6" height="6" rx="1.6" transform="rotate(45 12 12)" fill="#fff" />
      </svg>
    </span>
  );
}

// --- primitives --------------------------------------------------------------

export function Button({ variant = "primary", size, pill, className, type = "button", ...props }) {
  return (
    <button
      type={type}
      className={cn(
        "iv-btn",
        `iv-btn--${variant}`,
        size && `iv-btn--${size}`,
        pill && "iv-btn--pill",
        className,
      )}
      {...props}
    />
  );
}

export function Checkbox({ checked, onChange, children }) {
  return (
    <label className="iv-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="iv-check-box">
        <CheckIcon size={12} strokeWidth={3} />
      </span>
      <span>{children}</span>
    </label>
  );
}

// Six small segments rather than "2 of 6": progress at a glance, with the
// words kept for screen readers.
export function Progress({ value, max, label }) {
  return (
    <div className="iv-progress" role="img" aria-label={label}>
      {Array.from({ length: max }, (_, index) => (
        <span key={index} data-on={index < value} />
      ))}
    </div>
  );
}

export function Message({ from, children }) {
  return (
    <div className={cn("iv-msg", from === "user" ? "iv-msg--user" : "iv-msg--assistant")}>
      <div className="iv-msg-content">{children}</div>
    </div>
  );
}

// Muted text with a highlight sweeping across it: "something is happening".
export function Shimmer({ children, className }) {
  const text = String(children);
  return (
    <span className={cn("iv-shimmer", className)} style={{ "--iv-spread": `${text.length * 2}px` }} role="status">
      {text}
    </span>
  );
}

// One line of text that crossfades, with a touch of blur, whenever it changes.
export function Swap({ text, className }) {
  const [shown, setShown] = useState({ current: text, previous: null });
  if (shown.current !== text) {
    // Adjusting state during render is React's way to react to a changed prop
    // without an extra effect and an extra paint.
    setShown({ current: text, previous: shown.current });
  }
  return (
    <span className={cn("iv-swap", className)} role="status">
      {shown.previous ? (
        <span key={`out-${shown.previous}`} className="iv-swap-out" aria-hidden="true">
          {shown.previous}
        </span>
      ) : null}
      <span key={`in-${shown.current}`} className="iv-swap-in">
        {shown.current}
      </span>
    </span>
  );
}

// --- typed starters ------------------------------------------------------------
//
// Sentence openers that type themselves into the empty answer box, one after
// another, so a blank box is never just a blank box.
//
// The typing writes straight to the DOM through a ref. It runs about thirty
// times a second, and sending each character through React state would
// re-render the composer that often for no visible gain.
//
// Timing, deliberately uneven: characters arrive at a slightly irregular
// pace, as typing does; the finished line holds long enough to read; and it is
// erased about three times faster than it was written, because leaving should
// be quicker than arriving.
//
// With reduced motion nothing types. The starters fade from one to the next.

const TYPE_MS = 34;
const TYPE_JITTER_MS = 22;
const ERASE_MS = 12;
const HOLD_MS = 1900;
const GAP_MS = 320;

export function TypedStarters({ starters, fallback }) {
  const textRef = useRef(null);
  const [reduced, setReduced] = useState(false);
  const [staticIndex, setStaticIndex] = useState(0);
  const list = starters && starters.length ? starters : [fallback];
  const key = list.join("|");

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reduced) {
      const timer = setInterval(() => setStaticIndex((i) => i + 1), 4200);
      return () => clearInterval(timer);
    }
    const node = textRef.current;
    if (!node) return undefined;
    const lines = key.split("|");
    let timer = null;
    let line = 0;
    let at = 0;
    let erasing = false;

    function step() {
      // A tab nobody is looking at does not need a typewriter running in it.
      if (document.hidden) {
        timer = setTimeout(step, 600);
        return;
      }
      const full = lines[line % lines.length];
      if (!erasing) {
        at += 1;
        node.textContent = full.slice(0, at);
        if (at >= full.length) {
          erasing = true;
          timer = setTimeout(step, HOLD_MS);
        } else {
          timer = setTimeout(step, TYPE_MS + Math.random() * TYPE_JITTER_MS);
        }
        return;
      }
      at -= 1;
      node.textContent = full.slice(0, Math.max(0, at));
      if (at <= 0) {
        erasing = false;
        line += 1;
        timer = setTimeout(step, GAP_MS);
      } else {
        timer = setTimeout(step, ERASE_MS);
      }
    }

    node.textContent = "";
    timer = setTimeout(step, 500);
    return () => clearTimeout(timer);
  }, [key, reduced]);

  if (reduced) {
    const text = list[staticIndex % list.length];
    return (
      <div className="iv-typed" aria-hidden="true" key={text}>
        {text}
      </div>
    );
  }
  return (
    <div className="iv-typed" aria-hidden="true">
      <span ref={textRef} />
      <span className="iv-caret" />
    </div>
  );
}

// --- waveform ------------------------------------------------------------------
//
// The last few seconds of microphone level as bars, newest on the right. Each
// bar is one element whose `transform` is set directly: no layout, no paint,
// and no CSS variable whose change would restyle the whole row.

const BARS = 40;

export function Waveform({ level }) {
  const [bars, setBars] = useState(() => new Array(BARS).fill(0));
  const latest = useRef(0);

  useEffect(() => {
    latest.current = level;
  }, [level]);

  useEffect(() => {
    const timer = setInterval(() => {
      setBars((current) => [...current.slice(1), latest.current]);
    }, 110);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="iv-wave" aria-hidden="true">
      {bars.map((value, index) => (
        <span
          key={index}
          style={{
            transform: `scaleY(${Math.max(0.1, Math.min(1, value)).toFixed(3)})`,
            // Older bars fade, so the eye is drawn to the live end.
            opacity: 0.25 + 0.75 * (index / (BARS - 1)),
          }}
        />
      ))}
    </div>
  );
}
