"use client";
import { useRef, useEffect, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const PADDING_X = 6;
const HEIGHT = 30;
const RIGHT_EDGE = 1180 + PADDING_X;

export default function Abt() {
  const textRef = useRef(null);
  const groupRef = useRef(null);
  const containerRef = useRef(null);
  const [textWidth, setTextWidth] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      setIsTablet(window.innerWidth >= 768 && window.innerWidth <= 1024);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const rectWidth = textWidth + PADDING_X * 1;
  const rectX = RIGHT_EDGE - rectWidth;

  useEffect(() => {
    if (textRef.current) {
      setTextWidth(textRef.current.getComputedTextLength());
    }
  }, []);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: isMobile ? containerRef.current : groupRef.current,
          start: isMobile ? "top top" : "center center",
          end: "+=4000",
          scrub: 1,
          pin: containerRef.current,
          snap: {
            snapTo: (progress) => {
              // Timeline is 4s long:
              // 0-1s: Phase 1
              // 1-2s: Pause 1
              // 2-3s: Phase 2
              // 3-4s: Pause 2
              // Snap points: 0, 0.25 (1s), 0.75 (3s), 1 (4s)

              if (progress < 0.125) return 0;
              if (progress < 0.5) return 0.25; // Snap to End of Phase 1
              if (progress < 0.875) return 0.75; // Snap to End of Phase 2
              return 1;
            },
            duration: { min: 0.5, max: 1 },
            delay: 0,
            ease: "power1.inOut",
          },
        },
      });

      const phase1Duration = 1;
      const phase2Duration = 1;
      const pauseDuration = 1;

      // Ensure timeline has total duration of 4 (Phase 1 + Pause 1 + Phase 2 + Pause 2)
      // We do this by adding a dummy tween at the very end
      const totalDuration =
        phase1Duration + pauseDuration + phase2Duration + pauseDuration;
      tl.to({}, { duration: 0 }, totalDuration); // Extends timeline to 4s

      // --- PHASE 1 (Time 0 -> 1) ---

      // Rotate v-line to 45
      tl.to(
        "#v-line",
        {
          rotation: 45,
          svgOrigin: "756.75 975.75",
          ease: "none",
          duration: phase1Duration,
        },
        0,
      );

      // Rotate h-line to 45
      tl.to(
        "#h-line",
        {
          rotation: 45,
          svgOrigin: "756.75 975.75",
          ease: "none",
          duration: phase1Duration,
        },
        0,
      );

      // Move Group_12 up (-25)
      tl.to(
        "#Group_12",
        {
          y: -25,
          ease: "power1.inOut",
          duration: phase1Duration,
        },
        0,
      );

      // Move Group_null down (25)
      tl.to(
        "#Group_null",
        {
          y: 25,
          ease: "power1.inOut",
          duration: phase1Duration,
        },
        0,
      );

      // Text Switch 1 (Digital clock)
      const textSwitch1Start = 0.55;
      const textSwitchDuration = 0.45;

      // Top Switch 1
      tl.to(
        "#text-top-old",
        {
          y: -30,
          opacity: 0,
          ease: "power1.inOut",
          duration: textSwitchDuration,
        },
        textSwitch1Start,
      );
      tl.to(
        "#text-top-new",
        {
          y: 0,
          opacity: 1,
          ease: "power1.inOut",
          duration: textSwitchDuration,
        },
        textSwitch1Start,
      );

      // Bottom Switch 1
      tl.to(
        "#text-bottom-old",
        {
          y: isMobile ? 60 : isTablet ? 50 : 30,
          opacity: 0,
          ease: "power1.inOut",
          duration: textSwitchDuration,
        },
        textSwitch1Start,
      );
      tl.to(
        "#text-bottom-new",
        {
          y: 0,
          opacity: 1,
          ease: "power1.inOut",
          duration: textSwitchDuration,
        },
        textSwitch1Start,
      );

      // --- PAUSE (Time 1 -> 2) ---
      // Nothing happens here. User scrolls through "dead space".

      // --- PHASE 2 (Time 2 -> 3) ---
      const phase2Start = phase1Duration + pauseDuration;

      // Rotate v-line to 90
      tl.to(
        "#v-line",
        {
          rotation: 90,
          svgOrigin: "756.75 975.75",
          ease: "none",
          duration: phase2Duration,
        },
        phase2Start,
      );

      // Rotate h-line to 90
      tl.to(
        "#h-line",
        {
          rotation: 90,
          svgOrigin: "756.75 975.75",
          ease: "none",
          duration: phase2Duration,
        },
        phase2Start,
      );

      // Move Group_12 further up (-50)
      tl.to(
        "#Group_12",
        {
          y: -50,
          ease: "power1.inOut",
          duration: phase2Duration,
        },
        phase2Start,
      );

      // Move Group_null further down (50)
      tl.to(
        "#Group_null",
        {
          y: 50,
          ease: "power1.inOut",
          duration: phase2Duration,
        },
        phase2Start,
      );

      // Text Switch 2
      const textSwitch2Start = phase2Start + 0.55;

      // Top Switch 2
      tl.to(
        "#text-top-new",
        {
          y: -30,
          opacity: 0,
          ease: "power1.inOut",
          duration: textSwitchDuration,
        },
        textSwitch2Start,
      );
      tl.to(
        "#text-top-final",
        {
          y: 0,
          opacity: 1,
          ease: "power1.inOut",
          duration: textSwitchDuration,
        },
        textSwitch2Start,
      );

      // Bottom Switch 2
      tl.to(
        "#text-bottom-new",
        {
          y: isMobile ? 60 : isTablet ? 50 : 30,
          opacity: 0,
          ease: "power1.inOut",
          duration: textSwitchDuration,
        },
        textSwitch2Start,
      );
      tl.to(
        "#text-bottom-final",
        {
          y: 0,
          opacity: 1,
          ease: "power1.inOut",
          duration: textSwitchDuration,
        },
        textSwitch2Start,
      );

      // Number Switch 1
      tl.to(
        "#number-1",
        {
          y: -30,
          opacity: 0,
          ease: "power1.inOut",
          duration: textSwitchDuration,
        },
        textSwitch1Start,
      );
      tl.to(
        "#number-2",
        {
          y: 0,
          opacity: 1,
          ease: "power1.inOut",
          duration: textSwitchDuration,
        },
        textSwitch1Start,
      );

      // Number Switch 2
      tl.to(
        "#number-2",
        {
          y: -30,
          opacity: 0,
          ease: "power1.inOut",
          duration: textSwitchDuration,
        },
        textSwitch2Start,
      );
      tl.to(
        "#number-3",
        {
          y: 0,
          opacity: 1,
          ease: "power1.inOut",
          duration: textSwitchDuration,
        },
        textSwitch2Start,
      );
    });

    return () => ctx.revert();
  }, [rectWidth, rectX, isMobile]);
  return (
    <div>
      <div className={isMobile ? "h-screen" : ""} ref={containerRef}>
        <svg
          width="100%"
          height={isMobile ? "100%" : "auto"}
          viewBox={
            isMobile
              ? "506 -24 500 2000"
              : isTablet
                ? "256 476 1000 1000"
                : "0 600 1512 900"
          }
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio={isMobile ? "xMidYMid slice" : "xMidYMid meet"}
        >
          <defs>
            <clipPath id="abt-clip-top">
              <rect x="567" y="991" width="160" height="28" />
            </clipPath>
            <clipPath id="abt-clip-bottom">
              <rect
                x={rectX}
                y="938"
                width="600"
                height={isTablet ? 60 : HEIGHT}
              />
            </clipPath>
            <clipPath id="abt-clip-bottom-mobile">
              <rect x="770" y="925" width="250" height="100" />
            </clipPath>
            <clipPath id="abt-clip-number">
              <rect x="730" y="715" width="40" height="30" />
            </clipPath>
          </defs>
          <g id="Group 23">
            <g id="Group_12">
              <g id="Group 9">
                <rect x="567" y="991" width="160" height="28" className="fill-accent" />

                <path
                  id="highlight-anything"
                  d="M565.761 1004.43 H1200"
                  fill="none"
                />

                {/* Text Group Top */}
                <g clipPath="url(#abt-clip-top)">
                  <g id="text-top-old">
                    <text
                      ref={textRef}
                      fill="white"
                      fontSize="18"
                      dx="10"
                      dy="7"
                    >
                      <textPath
                        href="#highlight-anything"
                        startOffset="0%"
                        textAnchor="start"
                      >
                        Highlight Anything{" "}
                      </textPath>
                    </text>
                  </g>
                  <g id="text-top-new" transform="translate(0, 30)" opacity={0}>
                    <text fill="white" fontSize="18" dx="10" dy="7">
                      <textPath
                        href="#highlight-anything"
                        startOffset="0%"
                        textAnchor="start"
                      >
                        Get instant clarity
                      </textPath>
                    </text>
                  </g>
                  <g
                    id="text-top-final"
                    transform="translate(0, 30)"
                    opacity={0}
                  >
                    <text fill="white" fontSize="18" dx="10" dy="7">
                      <textPath
                        href="#highlight-anything"
                        startOffset="0%"
                        textAnchor="start"
                      >
                        Follow-up buttons
                      </textPath>
                    </text>
                  </g>
                </g>
              </g>
            </g>
            <line
              id="v-line"
              x1="756.75"
              y1="-2000"
              x2="756.75"
              y2="4000"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <line
              id="h-line"
              x1="-2000"
              y1="975.75"
              x2="4000"
              y2="975.75"
              stroke="#000000"
              strokeWidth="1.5"
            />
            {/* <line
              id="h-line_2"
              y1="600.75"
              x2="1512"
              y2="600.75"
              stroke="#000000"
              strokeWidth="1.5"
            /> */}
            <g id="Group_13" ref={groupRef}>
              <line
                id="Line 9"
                x1="756.75"
                y1="960.5"
                x2="756.75"
                y2="992.5"
                className="stroke-accent"
                strokeWidth="1.5"
              />
              <line
                id="Line 10"
                x1="740"
                y1="975.75"
                x2="772"
                y2="975.75"
                className="stroke-accent"
                strokeWidth="1.5"
              />
            </g>
            <circle
              id="Ellipse 4"
              cx="756"
              cy="976.5"
              r="233.25"
              stroke="#000000"
              strokeWidth="1.5"
            />
            {/* background */}
            <g id="Group_null">
              <rect
                x={rectX}
                y="938"
                width={rectWidth}
                height={isMobile ? 50 : isTablet ? 60 : HEIGHT}
                rx="0"
              />

              {/* path */}
              <path id="From-blogs" d="M772.761 941 H 2000" fill="none" />

              {/* Text Group Bottom */}
              <g
                clipPath={
                  isMobile
                    ? "url(#abt-clip-bottom-mobile)"
                    : "url(#abt-clip-bottom)"
                }
              >
                <g id="text-bottom-old">
                  {/* APPROACH: 
         If mobile, we render two separate text blocks referencing the same path.
         The second one is pushed down using dy.
      */}

                  {isMobile ? (
                    <>
                      {/* Mobile Line 1 */}
                      <text
                        fill="#000000"
                        fontSize="18"
                        x="1" // This relies on the path start, but usually ignored in favor of startOffset if referencing path
                        dy="3"
                      >
                        <textPath
                          href="#From-blogs"
                          startOffset="0%"
                          textAnchor="start"
                        >
                          From blogs, long articles…
                        </textPath>
                      </text>

                      {/* Mobile Line 2 - Pushed down by 20px (approx 1 line height) */}
                      <text
                        fill="#000000"
                        fontSize="18"
                        x="1"
                        dy="23" // 19 + 20 = 39 (Manual Line Break)
                      >
                        <textPath
                          href="#From-blogs"
                          startOffset="0%"
                          textAnchor="start"
                        >
                          Whatever you're reading
                        </textPath>
                      </text>
                    </>
                  ) : isTablet ? (
                    <>
                      <text fill="#000000" fontSize="18" x="12" dy="10">
                        <textPath
                          href="#From-blogs"
                          startOffset="0%"
                          textAnchor="start"
                        >
                          From blogs, long articles…
                        </textPath>
                      </text>
                      <text fill="#000000" fontSize="18" x="12" dy="31">
                        <textPath
                          href="#From-blogs"
                          startOffset="0%"
                          textAnchor="start"
                        >
                          Whatever you're reading
                        </textPath>
                      </text>
                    </>
                  ) : (
                    // Desktop: Standard Single Line
                    <text
                      ref={textRef}
                      fill="#000000"
                      fontSize="18"
                      x="12"
                      dy="19"
                    >
                      <textPath
                        href="#From-blogs"
                        startOffset="0%"
                        textAnchor="start"
                      >
                        From blogs, long articles… Whatever you're reading
                      </textPath>
                    </text>
                  )}
                </g>

                {/* Text 2: text-bottom-new */}
                <g
                  id="text-bottom-new"
                  transform={
                    isMobile
                      ? "translate(0, -60)"
                      : isTablet
                        ? "translate(0, -50)"
                        : "translate(0, -30)"
                  }
                  opacity={0}
                >
                  {isMobile ? (
                    <>
                      {/* Mobile Line 1 */}
                      <text fill="#000000" fontSize="18" x="1" dy="19">
                        <textPath
                          href="#From-blogs"
                          startOffset="0%"
                          textAnchor="start"
                        >
                          The explanations stay tied
                        </textPath>
                      </text>

                      {/* Mobile Line 2 */}
                      <text fill="#000000" fontSize="18" x="1" dy="39">
                        <textPath
                          href="#From-blogs"
                          startOffset="0%"
                          textAnchor="start"
                        >
                          to the highlighted text
                        </textPath>
                      </text>

                      {/* Mobile Line 3 */}
                      <text fill="#000000" fontSize="18" x="1" dy="59">
                        <textPath
                          href="#From-blogs"
                          startOffset="0%"
                          textAnchor="start"
                        >
                          and its context.
                        </textPath>
                      </text>
                    </>
                  ) : isTablet ? (
                    <>
                      <text fill="#000000" fontSize="18" x="12" dy="19">
                        <textPath
                          href="#From-blogs"
                          startOffset="0%"
                          textAnchor="start"
                        >
                          The explanations stay tied
                        </textPath>
                      </text>
                      <text fill="#000000" fontSize="18" x="12" dy="43">
                        <textPath
                          href="#From-blogs"
                          startOffset="0%"
                          textAnchor="start"
                        >
                          to the highlighted text and its context.
                        </textPath>
                      </text>
                    </>
                  ) : (
                    <text fill="#000000" fontSize="18" x="12" dy="19">
                      <textPath
                        href="#From-blogs"
                        startOffset="0%"
                        textAnchor="start"
                      >
                        The explanations stay tied to the highlighted text and
                        its context.
                      </textPath>
                    </text>
                  )}
                </g>

                {/* Text 3: text-bottom-final */}
                <g
                  id="text-bottom-final"
                  transform={
                    isMobile
                      ? "translate(0, -60)"
                      : isTablet
                        ? "translate(0, -50)"
                        : "translate(0, -30)"
                  }
                  opacity={0}
                >
                  {isMobile ? (
                    <>
                      {/* Mobile Line 1 */}
                      <text fill="#000000" fontSize="18" x="1" dy="19">
                        <textPath
                          href="#From-blogs"
                          startOffset="0%"
                          textAnchor="start"
                        >
                          One click for a simpler or
                        </textPath>
                      </text>

                      {/* Mobile Line 2 */}
                      <text fill="#000000" fontSize="18" x="1" dy="39">
                        <textPath
                          href="#From-blogs"
                          startOffset="0%"
                          textAnchor="start"
                        >
                          Deeper explanation and
                        </textPath>
                      </text>

                      {/* Mobile Line 3 */}
                      <text fill="#000000" fontSize="18" x="1" dy="59">
                        <textPath
                          href="#From-blogs"
                          startOffset="0%"
                          textAnchor="start"
                        >
                          generated follow-ups
                        </textPath>
                      </text>
                    </>
                  ) : isTablet ? (
                    <>
                      <text fill="#000000" fontSize="18" x="12" dy="19">
                        <textPath
                          href="#From-blogs"
                          startOffset="0%"
                          textAnchor="start"
                        >
                          One click for simpler or deeper explanation and
                        </textPath>
                      </text>
                      <text fill="#000000" fontSize="18" x="12" dy="43">
                        <textPath
                          href="#From-blogs"
                          startOffset="0%"
                          textAnchor="start"
                        >
                          generated follow-ups
                        </textPath>
                      </text>
                    </>
                  ) : (
                    <text fill="#000000" fontSize="18" x="12" dy="19">
                      <textPath
                        href="#From-blogs"
                        startOffset="0%"
                        textAnchor="start"
                      >
                        One click for simpler or deeper explanation and
                        generated follow-ups
                      </textPath>
                    </text>
                  )}
                </g>
              </g>
            </g>
            <g clipPath="url(#abt-clip-number)">
              <text
                id="number-1"
                x="745"
                y="738"
                fill="#000000"
                fontSize="18"
                textAnchor="middle"
              >
                1
              </text>
              <text
                id="number-2"
                x="745"
                y="738"
                fill="#000000"
                fontSize="18"
                textAnchor="middle"
                transform="translate(0, 30)"
                opacity={0}
              >
                2
              </text>
              <text
                id="number-3"
                x="745"
                y="738"
                fill="#000000"
                fontSize="18"
                textAnchor="middle"
                transform="translate(0, 30)"
                opacity={0}
              >
                3
              </text>
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
