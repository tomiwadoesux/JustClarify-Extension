"use client";

// /dither — ordered dithering with one PNG and one CSS filter.
//
// A working document for the technique behind the site's dithered gradients,
// and a straight replacement for the WebGL version in app/test/page.js
// whenever all you need is a moving Bayer ramp behind content. That page costs
// a GL context, resize handling, a useEffect and a tab that can lose its
// context and come back blank. This costs 307 bytes and no frame loop.
//
// The whole thing is one comparison per pixel: light up if the gradient here
// is brighter than the matrix cell under it. Baking the matrix into a PNG at
// 50% alpha turns an ordinary source-over composite into an average, and
// averaging two values then asking whether the result clears one half is the
// same question as asking whether the first clears the second. contrast()
// does the asking.
//
// Two things took iteration and are easy to get wrong again:
//
//   1. contrast(64) is not a threshold. It leaves a band of four 8-bit values
//      unsaturated, so a real share of pixels come out grey instead of
//      committing and the dither turns to mud. See the accuracy section.
//   2. Movement has to come from the level, not only from the gradient's
//      position. Sliding a blob around flips dots along one travelling edge;
//      walking the whole field up and down through the 64 thresholds flips
//      them everywhere at once, which is what actually reads as motion.

import { useCallback, useState } from "react";
import "./dither.css";

// The classic recursive Bayer ordering. Cell 0 lights first, cell 63 last, and
// the sequence is arranged so any two cells filling in consecutively sit as
// far apart on the grid as possible. Kept here as data, not just baked into
// the PNG, because the page draws it out as its own legend.
const BAYER_8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

// The same matrix as the CSS uses: inverted, every cell at exactly 50% alpha.
const BAYER_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAA+klEQVR42gXBERDCYACA0f+CQTAYDIIgGAyCYBAMBkEQBMEgCIJBMAgG3TcIBkEQBEEQBEEwGAyCQTAYDAZBEASDYDDYXe+JpmnYbDa8Xi/m8zlVVbFer8nznNlshjBNkziO6Xa7nE4nDMMgDENUVeVwOCDSNGUymVCWJavViiRJGI1GfD4flsslQpZldrsd/X6f2+2GJElst1s0TeNyuSB+vx+u65JlGdPplLqu8TyPoiiwbRsxGAy43+8oisJ+v2c4HBJFEZ1Oh+PxiHg8HliWxfv9ZrFY8Hw+GY/HfL9fHMdBtFotfN+n1+txPp9pt9sEQYCu61yvV/6IVH+h/id6iQAAAABJRU5ErkJggg==";

const MARKUP_SNIPPET = `<div class="dither">
  <div class="dither-cut">
    <div class="dither-ramp"></div>
    <div class="dither-lift"></div>
    <div class="dither-sink"></div>
  </div>
  <div class="dither-tint"></div>
</div>`;

const CSS_SNIPPET = `:root {
  /* the entire asset: an inverted 8x8 Bayer matrix at 50% alpha, 307 bytes */
  --bayer8: url("${BAYER_URI}");

  --dither-lo: #14171B;    /* colour where the ramp is dark */
  --dither-hi: #F4F6F7;    /* colour where the ramp is light */
  --dither-dot: 8px;       /* tile width: 8px is one CSS px per cell */
}

/* Keep it a whole number of DEVICE pixels per cell. 8px is 1 at 1x and 2 at
   2x; 16px is 2 and 4. One device pixel per cell is too fine to read, so
   double the tile on retina rather than leaving it at 8. */
@media (min-resolution: 2dppx) { :root { --dither-dot: 16px; } }

.dither {
  position: relative;
  overflow: hidden;
  isolation: isolate;              /* keep the screen blend off the page */
  background: var(--dither-lo);
}

/* multiplies the light colour back over the 1-bit result */
.dither-tint {
  position: absolute; inset: 0;
  background: var(--dither-hi);
  mix-blend-mode: multiply;
  pointer-events: none;
}

.dither-cut {
  position: absolute; inset: 0;
  overflow: hidden;
  background: #000;                /* the floor the ramp fades toward */
  filter: contrast(2000);          /* high enough that nothing lands grey */
  mix-blend-mode: screen;
  /* no grayscale(): the ramp below is already grey, and skipping it saves an
     8-bit round trip. Feed it a grey ramp or you get RGB fringing. */
}

/* the matrix. Screen-locked, never moves, never smoothed. */
.dither-cut::after {
  content: "";
  position: absolute; inset: 0;
  background-image: var(--bayer8);
  background-size: var(--dither-dot) var(--dither-dot);
  image-rendering: pixelated;
}

/* The ramp. "lighten" takes the max of the three blobs rather than adding
   them, so each keeps its own falloff instead of washing out into a flat
   field. Stacked with no blend mode at all, the first blob's opaque black
   simply hides the other two. */
.dither-ramp {
  position: absolute; inset: -70%;
  background:
    radial-gradient(40% 58% at 17% 31%, #ffffff 0%, #000 74%),
    radial-gradient(34% 50% at 77% 67%, #e6e6e6 0%, #000 70%),
    radial-gradient(28% 42% at 51% 3%,  #c8c8c8 0%, #000 66%),
    #000;
  background-blend-mode: lighten;
  animation: dither-orbit 9s linear infinite;
  will-change: transform;
}

/* The level pump. Two flat sheets in antiphase, white fading out as black
   fades in, slide the whole field up and down through the 64 thresholds by
   roughly the same amount at every value. This is what reads as movement: it
   flips dots across the entire frame, not just along one travelling edge.

   A white sheet on its own is not enough. Its effect is a * (1 - v), which is
   nearly zero anywhere the field is already bright. */
.dither-lift, .dither-sink { position: absolute; inset: 0; will-change: opacity; }
.dither-lift { background: #fff; opacity: 0.16; animation: dither-lift 4.5s ease-in-out infinite alternate; }
.dither-sink { background: #000; opacity: 0.18; animation: dither-sink 4.5s ease-in-out infinite alternate; }

@keyframes dither-lift { from { opacity: 0.34; } to { opacity: 0.04; } }
@keyframes dither-sink { from { opacity: 0.00; } to { opacity: 0.26; } }

/* Linear, and it returns to its own start, so it never stalls at an endpoint
   the way ease-in-out + alternate does. */
@keyframes dither-orbit {
  0%   { transform: translate3d(  0%,   0%, 0) scale(1.00); }
  25%  { transform: translate3d(-15%,  -9%, 0) scale(1.20); }
  50%  { transform: translate3d( -6%, -19%, 0) scale(1.04); }
  75%  { transform: translate3d( 11%, -10%, 0) scale(1.24); }
  100% { transform: translate3d(  0%,   0%, 0) scale(1.00); }
}

/* the static opacities above are the midpoint, so this still looks right */
@media (prefers-reduced-motion: reduce) {
  .dither-ramp, .dither-lift, .dither-sink { animation: none; }
}`;

const CHECKER_SNIPPET = `.checker {
  position: absolute;
  inset: -16px;                 /* room to slide */
  background-image: repeating-conic-gradient(
    #14171B 0 25%, #F4F6F7 0 50%);
  background-size: 8px 8px;     /* 4px cells */
  animation: jitter 1.05s steps(1, jump-end) infinite;
}
@keyframes jitter {
  0%   { transform: translate3d(0, 0, 0); }
  25%  { transform: translate3d(-4px, 0, 0); }
  50%  { transform: translate3d(-4px, -4px, 0); }
  75%  { transform: translate3d(0, -4px, 0); }
  100% { transform: translate3d(0, 0, 0); }
}`;

const GRAIN_SNIPPET = `:root {
  --grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncA type='discrete' tableValues='0 1'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23g)'/%3E%3C/svg%3E");
}

.grain {
  position: absolute;
  inset: -24px;
  background: var(--accent);   /* the colour stays yours */
  mask-image: var(--grain);
  mask-size: 180px 180px;
  animation: grain 0.72s steps(1, jump-end) infinite;
}
@keyframes grain {
  0%   { transform: translate3d(0, 0, 0); }
  16%  { transform: translate3d(-13px, 7px, 0); }
  33%  { transform: translate3d(9px, -11px, 0); }
  50%  { transform: translate3d(-6px, -17px, 0); }
  66%  { transform: translate3d(14px, 5px, 0); }
  83%  { transform: translate3d(-11px, 12px, 0); }
  100% { transform: translate3d(0, 0, 0); }
}`;

// The three layers every stage on this page is made of. Kept as one component
// so the hero, the workbench and all eight comparison swatches are provably
// the same stack with different variables.
function Stage({ motion = "all", mode = "exact", className = "", style }) {
  return (
    <div
      className={`stage ${className}`.trim()}
      data-motion={motion}
      data-mode={mode}
      style={style}
      aria-hidden="true"
    >
      <div className="od">
        <div className="ramp" />
        <div className="lift" />
        <div className="sink" />
      </div>
      <div className="tint" />
    </div>
  );
}

function Snippet({ code }) {
  const [label, setLabel] = useState("Copy");

  // The clipboard can be blocked (permissions policy, insecure context), so
  // fall back to selecting the block and saying which one happened.
  const copy = useCallback(
    async (event) => {
      const node = event.currentTarget.parentElement.querySelector("code");
      const flash = (text) => {
        setLabel(text);
        setTimeout(() => setLabel("Copy"), 1600);
      };
      try {
        await navigator.clipboard.writeText(code);
        flash("Copied");
      } catch {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        flash("Selected");
      }
    },
    [code],
  );

  return (
    <div className="snip">
      <button type="button" className="cp" onClick={copy}>
        {label}
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Knob({ id, label, min, max, step, value, display, onChange }) {
  return (
    <div className="knob">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <output htmlFor={id}>{display}</output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function Segmented({ label, options, value, onChange }) {
  return (
    <div className="knob">
      <span className="label">{label}</span>
      <span />
      <div className="seg" role="group" aria-label={label}>
        {options.map(([key, text]) => (
          <button
            key={key}
            type="button"
            aria-pressed={value === key}
            onClick={() => onChange(key)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DitherPage() {
  const [dot, setDot] = useState(16);
  const [cut, setCut] = useState(2000);
  const [spin, setSpin] = useState(9);
  const [pump, setPump] = useState(4.5);
  const [motion, setMotion] = useState("all");
  const [mode, setMode] = useState("exact");
  const [frozen, setFrozen] = useState(false);

  return (
    <div className="dither-page" data-frozen={frozen}>
      <Stage
        className="band"
        motion={motion}
        style={{ "--spin": "11s", "--pump": "5.5s" }}
      />

      <div className="wrap">
        <div className="masthead">
          <span className="label">
            Ordered dithering with one PNG and one filter
          </span>
          <h1>
            Dither without
            <br />
            WebGL
          </h1>
          <p>
            The band above is a live Bayer dither. One 307-byte PNG, one CSS
            gradient, one <code>contrast()</code> filter, and three compositor
            animations. No canvas, no shader, no JavaScript in the frame loop.
          </p>
          <p>
            It moves two ways at once: the gradient <em>orbits</em>, and its
            level <em>pumps</em> up and down through the matrix. The pump is
            the part you read as movement, because it flips dots across the
            whole field at once instead of only along one travelling edge.
          </p>
          <div className="bar">
            <button
              type="button"
              className="ghost"
              aria-pressed={frozen}
              onClick={() => setFrozen((value) => !value)}
            >
              {frozen ? "Resume motion" : "Freeze motion"}
            </button>
            <span className="label">
              {frozen
                ? "Frozen. Read the still frame"
                : "Every dither on this page is live"}
            </span>
          </div>
        </div>

        {/* ============ WORKBENCH ============ */}
        <section>
          <div className="head">
            <span className="label">Workbench</span>
            <h2>Turn the knobs</h2>
            <p>
              Cut is the one that matters. Drop it below about 100 and you will
              watch the pure black and white break down into grey mud, which is
              exactly the bug the first draft of this page shipped with.
            </p>
          </div>
          <div className="bench">
            <Stage
              motion={motion}
              mode={mode}
              style={{
                "--dot": `${dot}px`,
                "--cut": cut,
                "--spin": `${spin}s`,
                "--pump": `${pump}s`,
              }}
            />
            <div className="knobs">
              <Knob
                id="dp-dot"
                label="Dot"
                min={8}
                max={40}
                step={8}
                value={dot}
                display={`${dot}px`}
                onChange={setDot}
              />
              <Knob
                id="dp-cut"
                label="Cut"
                min={4}
                max={2000}
                step={4}
                value={cut}
                display={cut}
                onChange={setCut}
              />
              <Knob
                id="dp-spin"
                label="Orbit"
                min={2}
                max={30}
                step={1}
                value={spin}
                display={`${spin}s`}
                onChange={setSpin}
              />
              <Knob
                id="dp-pump"
                label="Pump"
                min={1}
                max={20}
                step={0.5}
                value={pump}
                display={`${pump}s`}
                onChange={setPump}
              />
              <Segmented
                label="Motion"
                value={motion}
                onChange={setMotion}
                options={[
                  ["all", "Both"],
                  ["drift", "Orbit"],
                  ["boil", "Pump"],
                  ["sweep", "Sweep"],
                  ["off", "Still"],
                ]}
              />
              <Segmented
                label="Sampling"
                value={mode}
                onChange={setMode}
                options={[
                  ["exact", "Exact"],
                  ["naive", "Naive"],
                ]}
              />
            </div>
          </div>
        </section>

        {/* ============ THE MATRIX ============ */}
        <section>
          <div className="head">
            <span className="label">The asset</span>
            <h2>An 8&times;8 grid of thresholds</h2>
          </div>
          <div className="matrix-row">
            <div className="matrix" aria-hidden="true">
              {BAYER_8.flat().map((v, i) => (
                <i
                  key={i}
                  className={v >= 32 ? "d" : undefined}
                  style={{ "--v": String(v) }}
                >
                  {v}
                </i>
              ))}
            </div>
            <div className="stack">
              <p>
                Ordered dithering is one comparison per pixel:{" "}
                <strong>
                  light up if the gradient here is brighter than the matrix cell
                  under it.
                </strong>{" "}
                The matrix tiles across the screen, so each cell always asks the
                same question at the same spot, and the answers form a pattern
                instead of noise. That fixed grid is why this reads as a dither
                and not as static.
              </p>
              <p>
                The numbers are the classic recursive Bayer ordering. Cell 0
                lights first, cell 63 last, and the sequence is arranged so that
                any two cells filling in consecutively are as far apart on the
                grid as possible. Each cell is stored as{" "}
                <code>(v + 0.5) / 64</code>, which lands on the 8-bit values 2,
                6, 10 through 254.
              </p>
              <div className="math">
                <div>
                  <b>Composite</b>
                  <span>0.5 &times; matrix &nbsp;+&nbsp; 0.5 &times; ramp</span>
                </div>
                <div>
                  <b>Threshold</b>
                  <span>contrast(2000) cuts at 0.5</span>
                </div>
                <div>
                  <b>Result</b>
                  <span className="out">ramp &gt; matrix</span>
                </div>
              </div>
              <p>
                That is the whole trick. Baking the matrix at 50% alpha turns an
                ordinary <code>source-over</code> composite into an average, and
                averaging two values then asking whether the result clears one
                half is the same question as asking whether the first clears the
                second.
              </p>
            </div>
          </div>
        </section>

        {/* ============ ACCURACY ============ */}
        <section>
          <div className="head">
            <span className="label">Accuracy</span>
            <h2>Four things that make it exact</h2>
            <p>Left swatch is wrong, right swatch is right. Both are running.</p>
          </div>

          <div className="fixes">
            <div className="fix">
              <div className="pair">
                <figure className="bad">
                  <Stage
                    style={{ "--cut": 64, "--dot": "16px", "--spin": "8s", "--pump": "4s" }}
                  />
                  <figcaption>
                    <span>contrast(64)</span>
                    <span>4 grey</span>
                  </figcaption>
                </figure>
                <figure className="good">
                  <Stage
                    style={{ "--cut": 2000, "--dot": "16px", "--spin": "8s", "--pump": "4s" }}
                  />
                  <figcaption>
                    <span>contrast(2000)</span>
                    <span>0 grey</span>
                  </figcaption>
                </figure>
              </div>
              <div className="stack">
                <h3>1. The cut has to actually saturate</h3>
                <p>
                  <code>contrast(n)</code> maps a value to{" "}
                  <code>(v &minus; 0.5) &times; n + 0.5</code>. It only reaches
                  pure black or pure white outside a band of half-width{" "}
                  <code>0.5 / n</code> around the midpoint. At{" "}
                  <code>contrast(64)</code> that band still covers four 8-bit
                  values, so{" "}
                  <strong>
                    every pixel whose composite lands on 126, 127, 128 or 129
                    comes out grey instead of committing.
                  </strong>{" "}
                  The composite steps in twos, so two of the sixty-four
                  threshold levels are mud.
                </p>
                <p>
                  Push it to <code>contrast(2000)</code> and the band shrinks
                  below one 8-bit step. Nothing survives as grey and the output
                  is genuinely 1-bit. It costs the same as the low value, since
                  it is one multiply in the same shader.
                </p>
                <dl className="tally">
                  <dt>contrast(64)</dt>
                  <dd className="no">126 127 128 129 stay grey</dd>
                  <dt>contrast(2000)</dt>
                  <dd className="yes">nothing stays grey</dd>
                </dl>
              </div>
            </div>

            <div className="fix">
              <div className="pair">
                <figure className="bad">
                  <Stage
                    mode="naive"
                    style={{ "--dot": "16px", "--spin": "8s", "--pump": "4s" }}
                  />
                  <figcaption>
                    <span>smoothed</span>
                    <span>resampled</span>
                  </figcaption>
                </figure>
                <figure className="good">
                  <Stage
                    style={{ "--dot": "16px", "--spin": "8s", "--pump": "4s" }}
                  />
                  <figcaption>
                    <span>pixelated</span>
                    <span>exact</span>
                  </figcaption>
                </figure>
              </div>
              <div className="stack">
                <h3>2. The matrix must not be resampled</h3>
                <p>
                  An 8&times;8 image drawn into an 8px box gets scaled by the
                  device pixel ratio like anything else. With default smoothing
                  the browser interpolates between cells, so the thresholds
                  arriving at each pixel are blends of neighbours rather than
                  the 64 values you shipped. The dither stops being ordered and
                  starts being approximately ordered.
                </p>
                <p>
                  <strong>
                    <code>image-rendering: pixelated</code> is not a stylistic
                    choice here.
                  </strong>{" "}
                  It forces nearest-neighbour, which at an integer scale factor
                  reproduces the matrix byte for byte.
                </p>
                <p>
                  Integer is the catch. At 1&times; and 2&times; an 8px tile
                  lands on 8 and 16 device pixels, both clean. At the fractional
                  ratios Windows likes, 1.25&times; and 1.5&times;, eight cells
                  have to share ten or twelve device pixels and some come out
                  wider than others. Nearest-neighbour keeps them hard-edged but
                  unevenly sized. This is the one case where a shader still
                  wins, because it can sample the matrix per device pixel.
                </p>
              </div>
            </div>

            <div className="fix">
              <div className="pair">
                <figure className="bad">
                  <Stage
                    style={{ "--dot": "8px", "--spin": "8s", "--pump": "4s" }}
                  />
                  <figcaption>
                    <span>8px</span>
                    <span>fine</span>
                  </figcaption>
                </figure>
                <figure className="good">
                  <Stage
                    style={{ "--dot": "40px", "--spin": "8s", "--pump": "4s" }}
                  />
                  <figcaption>
                    <span>40px</span>
                    <span>coarse</span>
                  </figcaption>
                </figure>
              </div>
              <div className="stack">
                <h3>3. Dot size is a ratio, not a taste</h3>
                <p>
                  The tile is eight cells across, so{" "}
                  <code>background-size: 8px</code> gives one CSS pixel per cell
                  and <code>32px</code> gives four. On a 2&times; screen those
                  become two and eight device pixels. Under about two device
                  pixels per cell the pattern is finer than most people can
                  resolve and the whole thing reads as smooth grey, which throws
                  away the reason you dithered at all.
                </p>
                <p>
                  The WebGL version in <code>app/test/page.js</code> runs{" "}
                  <code>ditherSize: 2.0</code>. The equivalent here is a 16px
                  tile on a 2&times; screen. Set it once as a variable and let a
                  resolution query swap it, rather than picking a number that
                  only looks right on the machine you built it on.
                </p>
              </div>
            </div>

            <div className="fix">
              <div className="pair">
                <figure className="good">
                  <Stage
                    motion="boil"
                    style={{ "--dot": "16px", "--pump": "3.5s" }}
                  />
                  <figcaption>
                    <span>8&times;8</span>
                    <span>64 levels</span>
                  </figcaption>
                </figure>
                <figure className="good">
                  <Stage
                    motion="boil"
                    style={{ "--dot": "32px", "--pump": "3.5s" }}
                  />
                  <figcaption>
                    <span>8&times;8</span>
                    <span>at 32px</span>
                  </figcaption>
                </figure>
              </div>
              <div className="stack">
                <h3>4. 8&times;8 is the largest matrix this trick can carry</h3>
                <p>
                  Halving the matrix to average it also halves its resolution.
                  An 8&times;8 matrix stores 64 thresholds four 8-bit steps
                  apart; halved they are two steps apart and all 64 survive as
                  distinct values. A 16&times;16 matrix stores 256 thresholds
                  one step apart; halved, adjacent pairs round to the same
                  number and{" "}
                  <strong>only 129 of the 256 levels come through.</strong> Half
                  the matrix silently stops existing.
                </p>
                <p>
                  So 8&times;8 is not a compromise between quality and file size
                  here. It is the ceiling of what 8-bit compositing can express,
                  and going bigger costs bytes to buy levels the pipeline throws
                  away. If you need finer, you need floats, which means a
                  shader.
                </p>
                <dl className="tally">
                  <dt>8&times;8</dt>
                  <dd className="yes">64 of 64 levels survive</dd>
                  <dt>16&times;16</dt>
                  <dd className="no">129 of 256 levels survive</dd>
                </dl>
              </div>
            </div>
          </div>
        </section>

        {/* ============ THE COMPONENT ============ */}
        <section>
          <div className="head">
            <span className="label">Ship it</span>
            <h2>The whole thing</h2>
            <p>
              Five elements, one image, no script. Drop the markup anywhere and
              give the wrapper a size.
            </p>
          </div>
          <Snippet code={MARKUP_SNIPPET} />
          <Snippet code={CSS_SNIPPET} />
        </section>

        {/* ============ NOTES ============ */}
        <section>
          <div className="head">
            <span className="label">Still worth knowing</span>
            <h2>Edges of this approach</h2>
          </div>
          <div className="notes">
            <div className="note">
              <span className="label">Cost</span>
              <p>
                Per frame this is a transform, two opacities and one{" "}
                <code>contrast()</code> pass over the element. All of it is GPU
                work and none of it repaints the gradient, which rasterises
                once. Compare that with a WebGL context, which costs you the
                context, the resize handling, the <code>useEffect</code>, and a
                tab that can lose its context and come back blank.
              </p>
            </div>

            <div className="note">
              <span className="label">Gradient noise</span>
              <p>
                Chrome dithers its own gradients to hide banding, which puts
                about &plusmn;1/255 of noise into the ramp before your threshold
                sees it. Near a level boundary that flips the occasional dot, so
                the pattern is very slightly less regular than the matrix alone
                would give. On a moving background it is invisible and arguably
                helps. On a still one at a large dot size you can find it if you
                look.
              </p>
            </div>

            <div className="note">
              <span className="label">The half-step</span>
              <p>
                PNG alpha is a byte, so 50% is stored as 128/255, which is
                0.50196 rather than 0.5. The composite is therefore weighted
                0.502 to 0.498 rather than evenly, biasing the threshold by
                about four tenths of a percent toward the dark end. That is
                smaller than the 8-bit rounding sitting next to it. Worth
                knowing about, not worth correcting.
              </p>
            </div>

            <div className="note">
              <span className="label">Colour</span>
              <p>
                The threshold runs in greyscale and the result is recoloured by
                the screen-then-multiply sandwich, so the two output colours are
                ordinary tokens. That is what lets this page follow the random
                per-load accent from <code>app/layout.js</code> without touching
                the dither itself. Threshold a colour gradient directly instead
                and <code>contrast()</code> cuts each channel on its own, which
                puts red, green and blue fringes on the dot edges. Occasionally
                that is the effect you want.
              </p>
            </div>

            <div className="note">
              <span className="label">Reduced motion</span>
              <p>
                All of this is decorative, so all of it sits behind{" "}
                <code>prefers-reduced-motion</code>. The static opacities are
                the midpoint of the pump, so the frozen frame still looks
                correct rather than blown out at one end.
              </p>
            </div>

            <div className="note">
              <span className="label">When to keep WebGL</span>
              <p>
                Per-pixel control over the gradient, an image as the source,
                several dither styles switchable at runtime, or a fractional
                device pixel ratio you need exact. Outside those,{" "}
                <code>app/test/page.js</code> is a lot of machinery for a moving
                Bayer ramp behind some text.
              </p>
            </div>
          </div>
        </section>

        {/* ============ THE CHEAPER TWO ============ */}
        <section>
          <div className="head">
            <span className="label">Cheaper, if you only want texture</span>
            <h2>Two that skip the threshold</h2>
            <p>
              Neither gives you a ramp. Both are pure compositor work after
              first paint, which is cheaper still than the Bayer.
            </p>
          </div>

          <details>
            <summary>Checker drift: a flat 4px field, zero assets</summary>
            <Snippet code={CHECKER_SNIPPET} />
          </details>

          <details>
            <summary>
              Baked grain: feTurbulence rasterised once, then tiled
            </summary>
            <Snippet code={GRAIN_SNIPPET} />
          </details>

          <p style={{ marginTop: 24, fontSize: 15, color: "var(--dp-ink-soft)" }}>
            The third option, doing the whole threshold inside one SVG{" "}
            <code>&lt;filter&gt;</code> with{" "}
            <code>feComposite operator=&quot;arithmetic&quot;</code> and an{" "}
            <code>&lt;animate&gt;</code> on the turbulence seed, is the most
            flexible and by a wide margin the most expensive: the noise is
            recomputed every frame, usually on the CPU. It also gives random
            dither rather than ordered, which is a different look, closer to
            film than to a Macintosh.
          </p>
        </section>

        <footer>
          <span className="label">
            307 bytes &middot; no shader &middot; no frame loop
          </span>
        </footer>
      </div>
    </div>
  );
}
