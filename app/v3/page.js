"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Header from "@/components/header";
import GoldenRatio from "@/components/golden-ratio";
import UpDown from "@/components/updown";
import Abt from "@/components/abt";
import Why from "@/components/why";

gsap.registerPlugin(ScrollTrigger);

// Scrubbed hand-off: phase A (golden ratio draws OUT) overlaps phase B (the
// up/down figures draw IN). HANDOFF starts B partway through A so they overlap.
const HANDOFF = 0.15;
const DUR = 0.9;
// Phase A (the opening figure LEAVING) runs quicker than the draw-in, so the
// first section clears out fast at the very start of the scroll. HANDOFF starts
// the draw-in just before A finishes, so there's no blank gap between them.
const DUR_OUT = 0.22;

// Text reveal — runs on its OWN clock (seconds), not the scroll. It auto-plays
// once the second figure has finished drawing in.
//
// Every line starts wiping at the SAME instant; what differs is each line's
// SPEED, so they finish at staggered moments and the block reveals organically
// instead of marching top-to-bottom one line at a time.
// per-line wipe durations for the NON-red lines — different speeds, indexed by
// line, giving the block its organic (not top-to-bottom) reveal. Bigger = slower.
// The two RED-accent lines (indexes 1 & 4 — the 2nd & 5th) ignore these: they run
// on a fixed FAST speed in the reveal loop so they lead the rest under scroll.
const LINE_DURS = [0.62, 0.26, 0.72, 0.5, 0.28, 0.6];

// One continuous paragraph, reflowed into balanced lines for a centered block.
const PARAGRAPH_LINES = [
  "I have a lot of fun exploring new interactivity patterns in",
  "my React Three Fiber projects by coupling Physics with",
  "standard UX patterns like resizing / moving a window or",
  "dragging a cursor across the screen. I believe there's a huge",
  "untapped potential to surprise and engage the viewer on",
  "the web by combining new and old tools / APIs.",
];

// the gray skeleton rectangle, plus a thin accent band that rides the gray's
// receding edge ON the gray side — so it reads as a second rectangle drawing
// behind it, but never bleeds over the revealed text.
const BAR_COLOR = "#363636"; // dark skeleton placeholder bg
const ACCENT_COLOR = "#ff0000";

// the accent band's resting width, plus the wider width it grows to on the few
// lines that "stretch" as they travel (just some, for a touch of life).
const BAND_WIDTH = 3;
const BAND_WIDTH_GROWN = 48;
const GROWING_LINES = new Set([1, 4]); // which lines stretch their accent band

// During the outro, one phrase gets "selected" with a browser-style text
// highlight that fills IN from the right. It lives on line 1 of the paragraph.
const HIGHLIGHT_LINE = 1;
const HIGHLIGHT_PHRASE = "React Three Fiber projects";
const SELECTION_COLOR = "#b4d5fe"; // the pale blue of a browser text selection

export default function HomeV3() {
  const pinContainerRef = useRef(null);
  const goldenRatioRef = useRef(null);
  const figuresRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    // Only apply the scroll transition on desktop/tablet screens
    const media = window.matchMedia("(min-width: 768px)");
    if (!media.matches) return;

    const gr = goldenRatioRef.current;
    const fig = figuresRef.current;
    const txt = textRef.current;

    // lock/unlock page scroll by swallowing wheel / touch / scroll-key input —
    // used to freeze the page while the one-shot outro plays (below).
    const swallow = (e) => e.preventDefault();
    const SCROLL_KEYS = new Set([
      " ", "Spacebar", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End",
    ]);
    const swallowKeys = (e) => {
      if (SCROLL_KEYS.has(e.key)) e.preventDefault();
    };
    const lockScroll = () => {
      window.addEventListener("wheel", swallow, { passive: false });
      window.addEventListener("touchmove", swallow, { passive: false });
      window.addEventListener("keydown", swallowKeys, { passive: false });
    };
    const unlockScroll = () => {
      window.removeEventListener("wheel", swallow);
      window.removeEventListener("touchmove", swallow);
      window.removeEventListener("keydown", swallowKeys);
    };

    const ctx = gsap.context(() => {
      // The whole sequence — figure draw-out (A), figure draw-in (B), then the
      // quote reveal — lives on ONE scroll-scrubbed timeline, so the reveal is
      // driven directly BY the scroll position (not its own clock). Scrolling
      // forward reveals it; it settles once you scroll past. No auto-replay.
      const play = new URLSearchParams(window.location.search).has("play");
      // the outro (attribution fade + phrase highlight) is a ONE-SHOT that plays
      // on its own clock with the page scroll LOCKED — NOT scrubbed. It's fired
      // from the pin trigger's progress via this closure, assigned further below.
      let onOutro = null;
      const ab = gsap.timeline(
        play
          ? {} // preview: no scroll, just auto-play the whole sequence once
          : {
              scrollTrigger: {
                trigger: pinContainerRef.current,
                start: "top top",
                end: "+=150%", // range covers draw-in, reveal, and the outro
                scrub: 0.5, // tighter scrub → snappier response to the wheel
                pin: true,
                anticipatePin: 1,
                onUpdate: (self) => onOutro && onOutro(self),
              },
            }
      );

      // Phase A: the v2 GoldenRatio figure draws OUT (erases), exactly like /v2.
      const grPaths = gr.querySelectorAll("path[stroke]");
      grPaths.forEach((path) => {
        const length = path.getTotalLength();
        gsap.set(path, { strokeDasharray: length });
        ab.fromTo(
          path,
          { strokeDashoffset: 0 },
          { strokeDashoffset: length, duration: DUR_OUT, ease: "none" },
          0
        );
      });
      const wu = gr.querySelector("#wipe-understand");
      if (wu) {
        ab.to(
          wu,
          { attr: { x: +wu.dataset.x1, width: +wu.dataset.w1 }, duration: DUR_OUT, ease: "none" },
          0
        );
      }
      const wl = gr.querySelector("#wipe-leaving");
      if (wl) {
        ab.to(wl, { attr: { width: +wl.dataset.w1 }, duration: DUR_OUT, ease: "none" }, 0);
      }

      // Phase B: the up/down figures draw IN at full opacity (no fade).
      ab.set(fig, { autoAlpha: 1 }, HANDOFF);
      const figStrokes = fig.querySelectorAll("[stroke]");
      figStrokes.forEach((el) => {
        const length = el.getTotalLength();
        gsap.set(el, { strokeDasharray: length, strokeDashoffset: length });
        ab.to(el, { strokeDashoffset: 0, duration: DUR, ease: "none" }, HANDOFF);
      });

      // the endpoint dots & diamonds stay hidden until the drawing front has
      // PASSED THROUGH them — each carries a data-reveal fraction (0..1) of the
      // draw-in marking where along the sweep it gets reached, so it pops in then.
      const figDots = fig.querySelectorAll(".js-fade");
      figDots.forEach((dot) => {
        const f = parseFloat(dot.dataset.reveal);
        const at = HANDOFF + (isNaN(f) ? 1 : f) * DUR;
        gsap.set(dot, { autoAlpha: 0 });
        ab.to(dot, { autoAlpha: 1, duration: 0.06, ease: "none" }, at);
      });

      // ── Quote reveal: appended to the SAME scrubbed timeline, so it tracks the
      // scroll. It's mapped onto the second SVG's draw-in (Phase B): the lines
      // START wiping only once that figure is ~45% drawn and FINISH exactly when
      // it lands, so the text resolves over the figure's second half.
      const B_START = HANDOFF; // Phase B (second SVG) begins drawing
      const B_END = B_START + DUR; // ...and finishes
      const TEXT_START = B_START + DUR * 0.45; // text holds until the SVG is 45% in
      const TEXT_END = B_END; // ...and finishes together WITH the SVG
      const TEXT_SPAN = TEXT_END - TEXT_START;

      // the container snaps visible instantly at TEXT_START — no fade. The text
      // itself stays hidden under the gray covers, so it only "appears in" via
      // the wipe reveal below, never through an opacity fade.
      ab.set(txt, { autoAlpha: 1 }, TEXT_START);

      // Two speeds keyed to the accent lines:
      //  • the RED lines (GROWING_LINES) respond to scroll FASTEST — they start
      //    the instant the block appears and finish by RED_END of the span, so a
      //    little scroll pops them open ahead of everything else.
      //  • the REST hold under the black cover until REST_HOLD of the span, then
      //    reveal with their own organic per-line variety, finishing at TEXT_END.
      // Net: at low scroll the black still covers almost everything; the red lines
      // lead, the rest catch up as you keep scrolling.
      const RED_END = 0.42; // red lines are done at 42% of the reveal span
      const REST_HOLD = 0.14; // the rest stay covered until 14% in
      const restMax = Math.max(
        ...LINE_DURS.filter((_, i) => !GROWING_LINES.has(i))
      );
      const restScale = (TEXT_SPAN * (1 - REST_HOLD)) / restMax;
      const lines = txt.querySelectorAll(".reveal-line");
      lines.forEach((line, i) => {
        const cover = line.querySelector(".line-cover");
        const band = line.querySelector(".accent-band");
        const isRed = GROWING_LINES.has(i);
        // red → early + fast; rest → slightly delayed + slower (organic variety)
        const start = isRed ? TEXT_START : TEXT_START + TEXT_SPAN * REST_HOLD;
        const dur = isRed ? TEXT_SPAN * RED_END : LINE_DURS[i] * restScale;

        // the gray rectangle recedes right → left, leaving NO bg behind. fromTo
        // keeps both ends as explicit 4-value insets so GSAP interpolates them
        // (a bare inset(0%) normalizes to 1 value and won't tween into 4-value).
        ab.fromTo(
          cover,
          { clipPath: "inset(0% 0.001% 0% 0%)" },
          { clipPath: "inset(0% 100% 0% 0%)", duration: dur, ease: "power3.out" },
          start
        );

        // a thin accent band rides the gray's receding edge. xPercent:-100 keeps
        // its RIGHT edge ON the boundary, so it stays over the still-gray side and
        // never touches the revealed text.
        gsap.set(band, { xPercent: -100, left: "100%", width: BAND_WIDTH, autoAlpha: 0 });
        // appears the instant the line starts revealing (no fade-in lag)
        ab.set(band, { autoAlpha: 1 }, start);
        ab.to(band, { left: "0%", duration: dur, ease: "power3.out" }, start);
        // the red lines stretch their band as it sweeps across (right edge stays
        // pinned via xPercent:-100, so it grows back over the gray side). It
        // snaps to full length FAST early in the sweep, then holds.
        if (isRed) {
          ab.to(band, { width: BAND_WIDTH_GROWN, duration: dur * 0.4, ease: "expo.out" }, start);
        }
        ab.to(band, { autoAlpha: 0, duration: 0.08, ease: "none" }, start + dur * 0.85);
      });

      // ── "Highlight the text…" label (bottom-left, above the connector line).
      // It simply FADES IN — text + diamond together — as the FINAL scrubbed
      // beat, a moment after the quote lands and finishing just as the outro
      // (blue selection) begins. No wipe; fading the container fades its children.
      const hiw = document.getElementById("hiw-label");
      if (hiw) {
        const HIW_FADE_START = B_END + 0.35; // hold a beat after the quote finishes
        const HIW_FADE_DUR = 0.45;
        gsap.set(hiw, { autoAlpha: 0 });
        ab.to(hiw, { autoAlpha: 1, duration: HIW_FADE_DUR, ease: "power2.out" }, HIW_FADE_START);
      }

      // the scroll fraction at which the whole draw-in + reveal is complete —
      // captured BEFORE appending the tail hold below, so it maps to that moment.
      const revealEnd = ab.duration();

      // a short hold so the reveal isn't pinned exactly at the scroll's end,
      // leaving a little scroll room after the one-shot outro unlocks.
      ab.to({}, { duration: 0.3 });

      // ── Outro (ONE-SHOT, scroll LOCKED): once the quote is fully revealed, the
      // quote mark + author line fade away and, as they do, a browser-style
      // selection highlight sweeps across the phrase from the RIGHT. This plays
      // on its OWN clock — NOT scrubbed — and the page scroll is disabled for its
      // duration so it can't be scrubbed through.
      const quoteMark = txt.querySelector(".quote-mark");
      const attribution = txt.querySelector(".attribution");
      const hlBg = txt.querySelector(".rtf-bg");

      const outroTl = gsap.timeline({
        paused: true,
        onComplete: unlockScroll,
        onReverseComplete: unlockScroll,
      });
      outroTl
        // quote mark + author line fade away
        .to([quoteMark, attribution], { autoAlpha: 0, duration: 0.5, ease: "power2.out" }, 0)
        // ...and the selection highlight fills IN from the right as they go
        // (inset clips 100% off the left, then recedes → grows right→left).
        .fromTo(
          hlBg,
          { clipPath: "inset(0% 0% 0% 100%)" },
          { clipPath: "inset(0% 0% 0% 0%)", duration: 0.55, ease: "power2.inOut" },
          0.12
        );

      if (play) {
        // preview: fire the outro right after the auto-played reveal finishes.
        ab.eventCallback("onComplete", () => outroTl.play());
      } else {
        // fire once the scroll has driven the reveal to completion: lock scroll,
        // play the one-shot, unlock when done. Scrolling back up rewinds it.
        const outroAt = revealEnd / ab.duration();
        let fired = false;
        onOutro = (self) => {
          if (!fired && self.progress >= outroAt) {
            fired = true;
            lockScroll();
            outroTl.play();
          } else if (fired && self.progress < outroAt - 0.02) {
            fired = false;
            outroTl.reverse();
          }
        };
      }
    });

    return () => {
      unlockScroll();
      ctx.revert();
    };
  }, []);

  return (
    <div className="relative bg-white overflow-x-hidden">
      {/* Desktop view: pinned hand-off transition */}
      <div
        ref={pinContainerRef}
        className="relative w-full h-screen overflow-hidden hidden md:block"
      >
        {/* Header stays visible and pinned during the transition */}
        <Header />

        {/* v2 figure — visible first, draws OUT on scroll */}
        <div
          ref={goldenRatioRef}
          id="golden-ratio-container"
          className="absolute inset-0 w-full h-full z-0 pointer-events-none"
        >
          <GoldenRatio />
        </div>

        {/* up + down figures — hidden first, draw IN after the v2 figure clears.
            opacity-0 keeps them invisible from first paint (no flash). */}
        <div
          ref={figuresRef}
          id="updown-container"
          className="absolute inset-0 w-full h-full z-10 opacity-0 pointer-events-none"
        >
          <UpDown />
        </div>

        {/* centred paragraph — one block, centre-aligned, revealed line-by-line
            right → left over gray skeleton bars with a flashing 2-colour edge.
            opacity-0 keeps it invisible until the reveal auto-plays. */}
        <div
          ref={textRef}
          id="text-reveal-container"
          className="absolute inset-0 z-20 flex items-center justify-center px-6 opacity-0 pointer-events-none"
        >
          <div className="quote-block w-[880px] max-w-[94vw] text-[#000000] text-base md:text-xl leading-relaxed">
            {/* quote mark sits to the LEFT of the paragraph, top-aligned */}
            <div className="flex items-start justify-center gap-3 md:gap-4">
              <span
                className="quote-mark shrink-0 font-serif leading-none select-none"
                style={{ color: ACCENT_COLOR, fontSize: "3.25rem", marginTop: "-0.08em" }}
                aria-hidden="true"
              >
                &ldquo;
              </span>
              <div className="quote-lines text-center">
                {PARAGRAPH_LINES.map((ln, i) => {
                  // one line "selects" a phrase during the outro: split it so the
                  // phrase can carry its own highlight bg that reveals right→left.
                  const isHl = i === HIGHLIGHT_LINE && ln.includes(HIGHLIGHT_PHRASE);
                  const [before, after] = isHl ? ln.split(HIGHLIGHT_PHRASE) : [ln, ""];
                  return (
                    // block wrapper forces each line onto its own row, centred
                    <div key={i} className="block">
                      {/* inline-block hugs the line's text → the rectangle is one bar
                          per line, sized to that line. overflow-hidden clips the accent
                          band to the bar so the red ends AT the bar's left edge. */}
                      <span className="reveal-line relative inline-block align-top overflow-hidden">
                        {/* the real text sits underneath, fully drawn */}
                        <span>
                          {isHl ? (
                            <>
                              {before}
                              {/* isolate + relative → own stacking context, so the
                                  gray cover still paints over it during the reveal,
                                  but the bg sits BEHIND the phrase text (z:-1). */}
                              <span className="rtf-highlight relative inline-block isolate align-baseline">
                                <span
                                  className="rtf-bg absolute"
                                  style={{
                                    top: "0.12em",
                                    bottom: "0.12em",
                                    left: 0,
                                    right: 0,
                                    background: SELECTION_COLOR,
                                    zIndex: -1,
                                    clipPath: "inset(0% 0% 0% 100%)",
                                  }}
                                  aria-hidden="true"
                                />
                                {HIGHLIGHT_PHRASE}
                              </span>
                              {after}
                            </>
                          ) : (
                            ln
                          )}
                        </span>
                        {/* opaque gray rectangle on top of the text — recedes to reveal
                            it, leaving no bg behind */}
                        <span
                          className="line-cover absolute left-0 right-0"
                          style={{
                            top: "0.18em",
                            bottom: "0.18em",
                            background: BAR_COLOR,
                          }}
                          aria-hidden="true"
                        />
                        {/* thin accent band rides the gray's receding edge, kept on the
                            gray side (translateX) so it never shows over revealed text */}
                        <span
                          className="accent-band absolute"
                          style={{
                            top: "0.18em",
                            bottom: "0.18em",
                            width: "3px",
                            background: ACCENT_COLOR,
                          }}
                          aria-hidden="true"
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* attribution — short accent line separator, the author's name, and
                a small external-link icon, centered under the whole block.
                pointer-events re-enabled since the reveal container is inert. */}
            <div className="attribution mt-8 flex items-center justify-center gap-3">
              <span
                className="h-px w-5"
                style={{ background: ACCENT_COLOR }}
                aria-hidden="true"
              />
              <a
                href="https://maximeheckel.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="group pointer-events-auto inline-flex items-center gap-1.5 text-sm tracking-wide text-black/50 transition-colors duration-300 hover:text-black"
              >
                Maxime Heckel
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  aria-hidden="true"
                >
                  <path d="M7 17 17 7" />
                  <path d="M7 7h10v10" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile view fallback: sections stack and scroll normally */}
      <div className="md:hidden">
        <Header />
        <GoldenRatio />
        <UpDown />
      </div>

      {/* Remaining sections temporarily disabled — focusing on the quote reveal
          scroll/animation for now. Re-enable when that's dialed in.
      <div className="relative overflow-visible">
        <Abt />
        <Why />
      </div>
      */}
    </div>
  );
}
