"use client";

// Two Figma-exported figures rendered inline so GSAP can reach their geometry.
// up.svg  -> tall figure, pinned to the TOP-RIGHT corner.
// down.svg -> wide figure, pinned to the BOTTOM-LEFT corner.
// The /v3 scroll timeline un-draws every [stroke] element (strokeDashoffset) and
// fades every .js-fade endpoint (the dots + red diamonds). The original Figma
// connector lines were *filled* shapes; they're re-authored here as <line stroke>
// so they un-draw with the arcs.

export default function UpDown() {
  return (
    <div className="min-h-[100svh] md:h-[100vh] w-full relative">
      {/* UP figure — top-right */}
      <svg
        width="100%"
        height="auto"
        viewBox="0 0 146 267"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMin meet"
        className="absolute top-[4%] right-[5%] w-[12%] h-auto pointer-events-none overflow-visible"
      >
        {/* big spiral arc */}
        <path
          id="big"
          d="M145 71.5C145 32.2878 113.212 0.5 74 0.5C34.7878 0.5 3 32.2878 3 71.5C3 110.712 34.7878 142.5 74 142.5"
          stroke="black"
          fill="none"
        />
        {/* center dot of the spiral — reached ~2/3 along the big arc's draw */}
        <circle id="small" className="js-fade" data-reveal="0.6" cx="3" cy="71.5" r="3" fill="black" />
        {/* inner circle */}
        <circle id="ellipse40" cx="74" cy="71.5" r="15.5" stroke="black" fill="none" />
        {/* pendulum: dot (fade) + vertical line (un-draw). dot is the junction at
            the foot of the big arc — appears once the arc has drawn down to it. */}
        <circle className="js-fade" data-reveal="0.88" cx="73.5" cy="142.5" r="2.67" fill="black" />
        <line
          id="pendulum-line"
          x1="73.5"
          y1="142.5"
          x2="73.5"
          y2="263.5"
          stroke="black"
        />
        {/* red diamond endpoint — at the very bottom of the pendulum line */}
        <rect
          className="js-fade"
          data-reveal="0.98"
          x="73.5464"
          y="260.5"
          width="4.23803"
          height="4.44951"
          transform="rotate(45 73.5464 260.5)"
          className="fill-accent"
        />
      </svg>

      {/* DOWN figure — bottom-left. Wrapped so the "How it Works" label can ride
          the connector line in figure-relative coordinates (it tracks the SVG). */}
      <div className="absolute bottom-[10%] left-[3%] w-[26%] pointer-events-none overflow-visible">
        <svg
          width="100%"
          height="auto"
          viewBox="0 0 344 83"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMinYMax meet"
          className="w-full h-auto overflow-visible"
        >
          {/* big circle */}
          <circle id="ellipse41" cx="38" cy="44.8574" r="37.5" stroke="black" fill="none" />
          {/* small top circle (white fill, stroked) */}
          <circle id="ellipse42" cx="38" cy="7" r="6.5" fill="white" stroke="black" />
          {/* inner arc */}
          <path
            id="ellipse16"
            d="M57 45C57 34.5066 48.4934 26 38 26C27.5066 26 19 34.5066 19 45C19 55.4934 27.5066 64 38 64"
            stroke="black"
            fill="none"
          />
          {/* horizontal connector: dot (fade) + line (un-draw). dot sits at the
              line's origin, so it appears right as the connector starts drawing. */}
          <circle className="js-fade" data-reveal="0.06" cx="38" cy="45" r="2.67" fill="black" />
          <line id="line37" x1="38" y1="45" x2="341" y2="45" stroke="black" />
          {/* mid dot — ~3/4 along the horizontal connector */}
          <circle id="ellipse44" className="js-fade" data-reveal="0.72" cx="268" cy="45" r="3" fill="black" />
          {/* red diamond endpoint — at the far right end of the connector.
              revealed a touch earlier (0.85) so it's clearly visible as the
              drawing front reaches the end, not only at the very last moment. */}
          <rect
            className="js-fade"
            data-reveal="0.85"
            x="340.5"
            y="41"
            width="5"
            height="5.2"
            transform="rotate(45 340.5 41)"
            className="fill-accent"
          />
        </svg>

        {/* Feature label — its start (left edge) sits ON the black mid-dot of the
            connector line, lifted above the line, extending right into the open
            canvas. It simply FADES IN as the final scrubbed beat of the /v3
            timeline, just before the outro. opacity-0 keeps it hidden until then.
            The first letter is a touch bigger. NB: no overflow-hidden and a
            comfortable line-height so descenders (g/p/y) aren't clipped.
            left:77.9% == the mid-dot's x (cx 268 of the 344-wide viewBox). */}
        <div
          id="hiw-label"
          className="absolute opacity-0"
          style={{ left: "77.9%", bottom: "66%" }}
        >
          <span
            className="relative inline-block whitespace-nowrap font-medium text-black"
            style={{ fontSize: "clamp(0.95rem, 1.4vw, 1.55rem)", lineHeight: 1.2 }}
          >
            {/* leading capital, a little larger than the rest */}
            <span style={{ fontSize: "1.18em" }}>H</span>ighlight the text from any
            webpage.
          </span>
          {/* JustClarify diamond — under the bottom-right of the text. Same mark
              as the header logo. Fades in with the label. */}
          <svg
            className="hiw-diamond absolute"
            style={{ right: 0, top: "100%", marginTop: "0.15em", width: "0.6em", height: "0.6em", fontSize: "clamp(0.95rem, 1.4vw, 1.55rem)" }}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path d="M12 0L24 12L12 24L0 12Z" fill="#3B4290" />
          </svg>
        </div>
      </div>
    </div>
  );
}
