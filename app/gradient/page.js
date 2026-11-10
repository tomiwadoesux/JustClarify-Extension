"use client";

// /gradient — the grainy WebGL wash under a blurred SVG mask.
//
// A working document for the technique on amplemarket.com, rebuilt rather than
// copied. Their version is three scripts totalling about 9 KB gzipped and no
// library at all, which is the interesting part: the whole look is one small
// fragment shader plus a mask, not a 150 KB scene graph.
//
// What the source site actually does, read off the live page:
//
//   1. The line drawing is a flat AVIF, about 21 KB. Not SVG, not a canvas.
//   2. The colour behind it is a WebGL canvas running three animated blobs.
//   3. The grain is a hash inside that shader, not a noise PNG on top.
//   4. The shape is an SVG <mask> whose path carries feGaussianBlur, so the
//      colour dissolves at the edges instead of stopping at them.
//   5. Per-instance palettes ride in on data attributes and become uniforms,
//      so one shader serves every card on the page.
//
// The two things this page does differently are documented in field.js: one
// shared GL context instead of one per element, and grain quantised to a fixed
// number of device pixels so it survives a resize.
//
// The sections below isolate one variable each. That is the point of the
// route: the effect has four dials and every one of them has a range where it
// stops working, which is much easier to see side by side than to describe.

import { useEffect, useState } from "react";
import Field, { fieldCount } from "./field";
import { mask, wedgeElement } from "./masks";
import "./gradient.css";

/* ------------------------------------------------------------------ palettes
 *
 * The first two are lifted straight off the source site's data attributes,
 * which is where its per-card colours live:
 *   data-color-1="255,238,216" data-color-2="255,215,240" data-color-3="208,178,255"
 * The third is mine, to prove the shader has no opinion about hue.
 */
const PALETTES = {
  persona: ["#FFEED8", "#FFD7F0", "#D0B2FF"],
  hero: ["#E8400D", "#FFEED8", "#D0B2FF"],
  founder: ["#7FE3D4", "#BFA8FF", "#8FD8F0"],
  ember: ["#FFB27A", "#FF6B6B", "#7A5CFF"],
};

/* ------------------------------------------------------------------ variants
 *
 * Six presets, each one a different answer to the same question: what shape is
 * the light. Everything else is held close to the source site's numbers so the
 * mask is the visible difference.
 */
const VARIANTS = [
  {
    key: "beacon",
    name: "Beacon",
    note: "The persona card, near enough exactly. Cone thrown from the corner, blur at 4.",
    mask: mask("cone", 4),
    colors: PALETTES.persona,
    radius: [0.5, 1.0, 1.0],
    warp: 4,
    grain: 0.2,
    art: "cone",
  },
  {
    key: "bloom",
    name: "Bloom",
    note: "No mask at all. The hero treatment: the field is the whole surface and the edges are the element's.",
    mask: "none",
    colors: PALETTES.hero,
    radius: [0.6, 1.1, 1.0],
    warp: 5,
    grain: 0.22,
    art: null,
  },
  {
    key: "halo",
    name: "Halo",
    note: "Orb mask, tight radii, slow clock. Reads as a lit object rather than a lit room.",
    mask: mask("orb", 14),
    colors: PALETTES.founder,
    radius: [0.35, 0.6, 0.55],
    warp: 2,
    grain: 0.16,
    speed: 0.55,
    art: "orb",
  },
  {
    key: "ribbon",
    name: "Ribbon",
    note: "A band under heavy blur. The one that survives having text sat on top of it.",
    mask: mask("band", 20),
    colors: PALETTES.persona,
    // Wide radii on purpose. A mask only says where colour is allowed; the
    // blobs decide where it actually lands, and a thin band lit by small blobs
    // reads as a smear in one corner rather than as a band.
    radius: [1.5, 1.8, 1.6],
    warp: 3,
    grain: 0.14,
    gain: 0.9,
    art: null,
  },
  {
    key: "sweep",
    name: "Sweep",
    note: "A stroked arc as the mask. Any shape works, including ones with no fill.",
    mask: mask("arc", 8),
    colors: PALETTES.founder,
    radius: [1.4, 1.7, 1.5],
    warp: 4,
    grain: 0.18,
    art: "stairs",
  },
  {
    key: "letterform",
    name: "Letterform",
    note: "Type as the mask. Works, with one caveat: an SVG used as an image cannot load a webfont.",
    mask: mask("type", 2),
    colors: PALETTES.ember,
    radius: [0.55, 1.0, 1.0],
    warp: 6,
    grain: 0.24,
    art: null,
  },
];

/* --------------------------------------------------------------------- ink
 *
 * Minimal line marks, sat above the field the way the source site sits its
 * illustrations above its canvases. Deliberately stroke-only and black: the
 * whole layering argument is that the ink stays ink and the colour reads as
 * light thrown past it.
 */
function Ink({ shape }) {
  if (!shape) return null;
  const common = {
    fill: "none",
    stroke: "#14171b",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    vectorEffect: "non-scaling-stroke",
  };
  return (
    <div className="gp-stage-art">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        {shape === "cone" && (
          <>
            <path {...common} d="M30 62 L62 40 L62 74 Z" />
            <path {...common} d="M30 62 L20 68 L20 56 Z" />
            <circle {...common} cx="70" cy="57" r="9" />
          </>
        )}
        {shape === "orb" && (
          <>
            <circle {...common} cx="50" cy="50" r="22" />
            <path {...common} d="M50 14 v-8 M50 94 v-8 M14 50 h-8 M94 50 h-8" />
          </>
        )}
        {shape === "stairs" && (
          <>
            <path {...common} d="M18 82 h18 v-16 h18 v-16 h18 v-16 h10" />
            <path {...common} d="M74 34 l10 0 l-4 -5 M84 34 l-4 5" />
          </>
        )}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------- ladders
 *
 * One variable moves, everything else is pinned. The flagged rung is the value
 * the source site actually ships, which is usually the one that looks least
 * dramatic in isolation and most correct in place.
 */
const BASE = {
  colors: PALETTES.persona,
  radius: [0.5, 1.0, 1.0],
  warp: 4,
  grain: 0.2,
};

const BLUR_RUNGS = [
  { v: 0, label: "hard clip", flag: false },
  { v: 4, label: "their cards", flag: true },
  { v: 12, label: "soft", flag: false },
  { v: 32, label: "gone", flag: false },
];

const GRAIN_RUNGS = [
  { v: 0, label: "clean", flag: false },
  { v: 0.12, label: "faint", flag: false },
  { v: 0.2, label: "theirs", flag: true },
  { v: 0.5, label: "too much", flag: false },
];

const SIZE_RUNGS = [
  { v: 1, label: "film", flag: true },
  { v: 2, label: "coarse", flag: false },
  { v: 4, label: "riso", flag: false },
];

const WARP_RUNGS = [
  { v: 0, label: "three circles", flag: false },
  { v: 1.5, label: "restrained", flag: false },
  { v: 4, label: "theirs", flag: true },
  { v: 9, label: "boiling", flag: false },
];

/* --------------------------------------------------- moving light, fixed dots
 *
 * The five motions, and the two variants they run under. Shader grain is off
 * in every one of these: the texture is the ordered dither on top, and running
 * both puts two unrelated noises on the same picture.
 */
const DITHER_MOTIONS = [
  { key: "drift", note: "never repeats" },
  { key: "orbit", note: "predictable" },
  { key: "pulse", note: "swells in place" },
  { key: "sweep", note: "travels, wraps" },
  { key: "boil", note: "churns, no travel" },
];

// gain is the one number that had to change coming into this section. Over an
// ink floor the field's alpha IS the value the threshold sees, and a cut asks
// "did this clear one half". Run these palettes at full gain and almost every
// pixel clears it, so the card comes out solid white with a dithered rim. Pull
// the peak down to roughly three quarters and the whole falloff lands inside
// the range where dot density still tracks the gradient, which is the only
// range where an ordered dither has anything to say.
const DITHER_CARDS = [
  {
    name: "Bloom",
    colors: PALETTES.hero,
    mask: "none",
    radius: [0.62, 1.05, 0.95],
    warp: 5,
    gain: 0.72,
  },
  {
    name: "Beacon",
    colors: PALETTES.persona,
    mask: mask("cone", 4),
    // Smaller than the cone it sits in, deliberately. Blobs wide enough to
    // fill the mask make all five motions look identical: the shape is lit
    // either way and the travel happens out of sight behind the mask edge.
    radius: [0.58, 0.95, 0.8],
    warp: 4,
    gain: 0.78,
  },
];

const DITHER_MODES = ["screen", "dither", "off"];

// How much Bayer. The order is how many thresholds the matrix carries: 2x2 has
// four and reads as a chequer, 16x16 has 256 and is close enough to continuous
// that the screen almost disappears at a 1px cell.
const BAYER_ORDERS = [2, 4, 8, 16];

// How big the box is. Pixels per matrix cell, not pixels per tile: the tile is
// order x cell, so 8x8 at 2px is a 16px tile with every cell still intact.
const CELL_SIZES = [1, 2, 3, 4];

function Rung({ label, value, flag, children }) {
  return (
    <div className="gp-rung" data-flag={String(flag)}>
      <div className="gp-rung-stage">{children}</div>
      <div className="gp-rung-label">
        <b>{value}</b>
        <span>{label}</span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- element masks
 *
 * The other way to write a mask. Built once at module scope because the id has
 * to be stable across renders for the CSS reference to keep resolving.
 */
const WEDGE = wedgeElement("gp-wedge", 4);

const SNIPPET = `// the mask, blurred at authoring time
const cone = \`<svg xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 100 100" preserveAspectRatio="none">
  <filter id="b" x="-40%" y="-40%" width="180%" height="180%"
          color-interpolation-filters="sRGB">
    <feGaussianBlur stdDeviation="4"/>
  </filter>
  <g filter="url(#b)" fill="#fff">
    <path d="M100,4 L18,59 C-6,80 13,92 25,92 H100 Z"/>
  </g>
</svg>\`;

<Field
  colors={["#FFEED8", "#FFD7F0", "#D0B2FF"]}
  mask={\`url("data:image/svg+xml,\${encodeURIComponent(cone)}")\`}
  warp={4}
  grain={0.2}
/>`;

const SHADER_SNIPPET = `// the three lines that make it look like light and not like CSS
p.x += cos(t*.70 + p.x*5.) * .21 * sin(t*.14 + p.y*7.) * .29 * u_warp;
p.y += sin(t*.50 + p.x*3.) * .37 * cos(t*.36 + p.y*5.) * .12 * u_warp;

vec3 col = (u_col1*w1 + u_col2*w2 + u_col3*w3) / max(w1+w2+w3, 1e-4);`;

/* --------------------------------------------------------------------- page */

export default function GradientPage() {
  const [palette, setPalette] = useState("persona");
  // screen at an 8px cell is the default because it is the honest one: the
  // gradient underneath is untouched and you are looking at it through a fixed
  // grid, the way a halftone screen works in print. "dither" is the same
  // matrix with the cut applied, which throws the continuous tone away.
  const [dmode, setDmode] = useState("screen");
  const [order, setOrder] = useState(8);
  const [cell, setCell] = useState(1);
  const [contexts, setContexts] = useState(null);

  // Read after mount, never during render: the count depends on how many
  // fields have registered, which is not knowable on the server.
  useEffect(() => {
    const id = setTimeout(() => setContexts(fieldCount()), 400);
    return () => clearTimeout(id);
  }, []);

  return (
    <main className="gradient-page">
      <header className="gp-masthead">
        <div className="gp-masthead-field">
          <Field
            colors={PALETTES.hero}
            radius={[0.6, 1.1, 1.0]}
            warp={5}
            grain={0.22}
            gain={0.55}
            speed={0.8}
            mask={mask("band", 30)}
          />
        </div>
        <div className="gp-wrap">
          <div className="gp-masthead-inner">
            <p className="gp-eyebrow">Working document</p>
            <h1 className="gp-title">Grainy light under a blurred mask</h1>
            <p className="gp-lede">
              Three animated blobs on the GPU, a hash for grain, and an SVG mask
              with a Gaussian blur on the path rather than on the picture. That
              last part is the whole trick. Blur the canvas and you get a soft
              image with a hard edge where the element stops. Blur the mask and
              the colour dissolves into the page.
            </p>
            <p className="gp-lede">
              Rebuilt from amplemarket.com, whose entire version of this is
              about 9 KB of gzipped JavaScript and no library.
            </p>
          </div>
        </div>
      </header>

      <div className="gp-wrap">
        {/* ------------------------------------------------------ variants */}
        <section className="gp-section">
          <div className="gp-section-head">
            <span className="gp-num">01</span>
            <h2 className="gp-h2">Variants</h2>
          </div>
          <p className="gp-note">
            One shader, one set of blob paths. Everything that separates these
            is the mask and the palette. The ink sits above the field in every
            card, which is the layer order the source site uses and the reason
            the drawings stay black instead of going pink.
          </p>
          <div className="gp-grid">
            {VARIANTS.map((v) => (
              <article className="gp-card" key={v.key}>
                <div className="gp-stage">
                  <div className="gp-stage-field">
                    <Field
                      colors={v.colors}
                      radius={v.radius}
                      warp={v.warp}
                      grain={v.grain}
                      speed={v.speed ?? 1}
                      gain={v.gain ?? 1}
                      mask={v.mask}
                      phase={v.key.length * 3}
                    />
                  </div>
                  <Ink shape={v.art} />
                </div>
                <div className="gp-card-meta">
                  <p className="gp-card-name">{v.name}</p>
                  <p className="gp-card-note">{v.note}</p>
                  <p className="gp-params">
                    <span>warp {v.warp}</span>
                    <span>grain {v.grain}</span>
                    <span>r {v.radius.join("/")}</span>
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------- mask blur */}
        <section className="gp-section">
          <div className="gp-section-head">
            <span className="gp-num">02</span>
            <h2 className="gp-h2">The blur belongs to the mask</h2>
          </div>
          <p className="gp-note">
            The same cone at four values of <code>stdDeviation</code>, in
            viewBox units, so each one is a percentage of the box rather than a
            pixel count. At 0 it is a clip path and the shape announces itself.
            At 4, their setting, the wide end of the cone has already stopped
            being an edge. Past about 30 there is no cone left, only a bias in
            where the colour sits, which is occasionally what you want.
          </p>
          <div className="gp-ladder">
            {BLUR_RUNGS.map((r) => (
              <Rung key={r.v} value={`stdDeviation ${r.v}`} label={r.label} flag={r.flag}>
                <Field {...BASE} mask={mask("cone", r.v)} phase={r.v} />
              </Rung>
            ))}
          </div>
        </section>

        {/* -------------------------------------------------------- grain */}
        <section className="gp-section">
          <div className="gp-section-head">
            <span className="gp-num">03</span>
            <h2 className="gp-h2">Grain</h2>
          </div>
          <p className="gp-note">
            One hash of the fragment coordinate, multiplied into the colour
            before the alpha premultiply so it darkens the wash instead of
            punching holes in it. The amplitude is divided by{" "}
            <code>devicePixelRatio</code>, which is the detail most
            reimplementations miss: twice the pixels means twice as many noise
            samples per inch, and without the divide a retina screen shows
            roughly twice the texture of the display it was tuned on.
          </p>
          <div className="gp-ladder">
            {GRAIN_RUNGS.map((r) => (
              <Rung key={r.v} value={`grain ${r.v}`} label={r.label} flag={r.flag}>
                <Field {...BASE} grain={r.v} mask={mask("orb", 16)} phase={r.v * 10} />
              </Rung>
            ))}
          </div>
          <p className="gp-note" style={{ marginTop: 32 }}>
            The cell size is the dial their shader does not have. Hashing{" "}
            <code>floor(fragCoord / grainSize)</code> rather than a normalised
            coordinate pins the noise to a fixed number of device pixels, so a
            field can be resized without the grain changing character.
          </p>
          <div className="gp-ladder">
            {SIZE_RUNGS.map((r) => (
              <Rung key={r.v} value={`grainSize ${r.v}`} label={r.label} flag={r.flag}>
                <Field {...BASE} grain={0.3} grainSize={r.v} mask={mask("orb", 16)} phase={r.v * 7} />
              </Rung>
            ))}
          </div>
        </section>

        {/* --------------------------------------------------------- warp */}
        <section className="gp-section">
          <div className="gp-section-head">
            <span className="gp-num">04</span>
            <h2 className="gp-h2">Domain warp</h2>
          </div>
          <p className="gp-note">
            Bend the coordinate before you sample it. At 0 the blobs are
            perfect ellipses drifting on Lissajous paths and the whole thing
            looks like three CSS radial gradients, because functionally it is.
            Turning it up deforms the blobs as they travel, which is what stops
            the eye reading them as objects. Their value is 4.
          </p>
          <div className="gp-ladder">
            {WARP_RUNGS.map((r) => (
              <Rung key={r.v} value={`warp ${r.v}`} label={r.label} flag={r.flag}>
                <Field {...BASE} warp={r.v} mask={mask("band", 12)} phase={r.v * 4} />
              </Rung>
            ))}
          </div>
        </section>

        {/* ------------------------------------------ moving light, fixed dots */}
        <section className="gp-section">
          <div className="gp-section-head">
            <span className="gp-num">05</span>
            <h2 className="gp-h2">Moving light, fixed texture</h2>
          </div>
          <p className="gp-note">
            The shader&apos;s own grain is switched off here and the texture
            comes from <a href="/dither">/dither</a> instead: the same 307-byte
            Bayer matrix, baked at 50% alpha. No WebGL is involved in the
            texture at all. It is nailed to the element, never transformed and
            never animated, so the only thing moving in any of these ten cards
            is the light underneath.
          </p>
          <p className="gp-note">
            Two dials, and they are different questions.{" "}
            <span className="gp-inline">matrix</span> is how much Bayer: the
            order is how many thresholds the tile carries, four at 2&times;2 and
            256 at 16&times;16. <span className="gp-inline">per cell</span> is
            how big the box is, in screen pixels per matrix cell. The tile is
            the product, which is why an 8&times;8 matrix asked to fit a 4px
            tile used to put every cell on half a pixel and quietly lose half
            the matrix.
          </p>
          <p className="gp-note">
            <span className="gp-inline">screen</span> is the default and these
            are still gradients: the matrix is laid over continuous tone and
            every value the field had is still there, seen through a fixed grid.
            That is a halftone screen in the print sense.{" "}
            <span className="gp-inline">dither</span> adds one{" "}
            <code>contrast(2000)</code> on top, which cuts every pixel to on or
            off and throws the continuous tone away. Same asset, same matrix,
            one filter between them, and only the cut is destructive.
          </p>
          <p className="gp-note">
            That constraint is what makes the five motions legible. A texture
            that drifts with the gradient hides the difference between light
            that travels and light that swells, because both just look like
            something sliding. Pin the dots and{" "}
            <span className="gp-inline">sweep</span> flips them along one
            advancing edge while <span className="gp-inline">pulse</span> flips
            them in rings from the middle out.
          </p>
          <div className="gp-controls">
            {DITHER_MODES.map((m) => (
              <button
                key={m}
                type="button"
                className="gp-chip"
                aria-pressed={dmode === m}
                onClick={() => setDmode(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="gp-controls">
            {BAYER_ORDERS.map((n) => (
              <button
                key={n}
                type="button"
                className="gp-chip"
                aria-pressed={order === n}
                onClick={() => setOrder(n)}
              >
                {n}&times;{n}
              </button>
            ))}
            <span className="gp-chip-note">matrix</span>
          </div>
          <div className="gp-controls">
            {CELL_SIZES.map((c) => (
              <button
                key={c}
                type="button"
                className="gp-chip"
                aria-pressed={cell === c}
                onClick={() => setCell(c)}
              >
                {c}px
              </button>
            ))}
            <span className="gp-chip-note">
              per cell, so a {order * cell}px tile
            </span>
          </div>
          {DITHER_CARDS.map((card) => (
            <div key={card.name}>
              <p className="gp-drow-label">{card.name}</p>
              <div className="gp-drow">
                {DITHER_MOTIONS.map((m, i) => (
                  <article className="gp-dcard" key={m.key}>
                    <div
                      className="gp-dstage"
                      data-mode={dmode}
                      data-bayer={order}
                      style={{ "--gp-cell": `${cell}px` }}
                    >
                      <div className="gp-dfield">
                        <Field
                          colors={card.colors}
                          radius={card.radius}
                          warp={card.warp}
                          gain={card.gain}
                          grain={0}
                          motion={m.key}
                          mask={card.mask}
                          phase={i * 4}
                        />
                      </div>
                    </div>
                    <div className="gp-dmeta">
                      <b>{m.key}</b>
                      <span>{m.note}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
          <p className="gp-note" style={{ marginTop: 24 }}>
            Two notes for anyone switching to{" "}
            <span className="gp-inline">dither</span>. The floor under the field
            is ink rather than paper, which is not a style choice: threshold a
            bright floor and the darkest cell of every tile lands on the wrong
            side of the cut, so a flat empty area comes out speckled. And the
            colour goes through the cut intact, so <code>contrast()</code> cuts
            each channel separately and the dot edges carry red, green and blue
            fringes. /dither avoids that by feeding its cut a grey ramp and
            recolouring afterwards, and calls the fringing an artefact worth
            knowing about. On these cards it is the point.
          </p>
        </section>

        {/* ------------------------------------------------------ palettes */}
        <section className="gp-section">
          <div className="gp-section-head">
            <span className="gp-num">06</span>
            <h2 className="gp-h2">One shader, any palette</h2>
          </div>
          <p className="gp-note">
            The colours are three <code>vec3</code> uniforms. On the source site
            they arrive as <code>data-color-1</code> through{" "}
            <code>data-color-3</code> on the wrapper, which is how a Webflow
            page ends up with five differently coloured cards and one shader.
            Because the fragment shader normalises the blob weights instead of
            adding the colours, overlaps land on a colour genuinely between the
            two rather than racing toward white.
          </p>
          <div className="gp-controls">
            {Object.keys(PALETTES).map((k) => (
              <button
                key={k}
                type="button"
                className="gp-chip"
                aria-pressed={palette === k}
                onClick={() => setPalette(k)}
              >
                {k}
              </button>
            ))}
          </div>
          <div className="gp-ladder">
            {["cone", "orb", "band"].map((shape, i) => (
              <Rung key={shape} value={shape} label={PALETTES[palette].join(" ")} flag={false}>
                <Field {...BASE} colors={PALETTES[palette]} mask={mask(shape, 10)} phase={i * 5} />
              </Rung>
            ))}
          </div>
        </section>

        {/* -------------------------------------------------- element mask */}
        <section className="gp-section">
          <div className="gp-section-head">
            <span className="gp-num">07</span>
            <h2 className="gp-h2">The other way to write the mask</h2>
          </div>
          <p className="gp-note">
            Everything above uses a data-URI SVG, which is portable and cached
            and has the blur baked in. The source site does it the other way:{" "}
            <code>mask-image: url(#id)</code> pointing at a live{" "}
            <code>&lt;mask&gt;</code> element in the document. That is the
            fragile option, and it buys exactly one thing, which is that the
            path can be rewritten every frame. If the silhouette never changes,
            it buys nothing.
          </p>
          <div dangerouslySetInnerHTML={{ __html: WEDGE.markup }} />
          <div className="gp-ladder">
            <Rung value="url(#id)" label="element reference" flag={false}>
              <Field {...BASE} mask={WEDGE.value} />
            </Rung>
            <Rung value='url("data:…")' label="data URI" flag={true}>
              <Field {...BASE} mask={mask("cone", 4)} />
            </Rung>
          </div>
        </section>

        {/* --------------------------------------------------------- cost */}
        <section className="gp-section">
          <div className="gp-section-head">
            <span className="gp-num">08</span>
            <h2 className="gp-h2">What it costs</h2>
          </div>
          <p className="gp-note">
            Measured on the live source page over the remote debugging port, not
            estimated. The frame numbers are a 2.06 megapixel canvas at
            devicePixelRatio 1, pinned to vsync, which is to say the shader was
            never the thing holding the frame up.
          </p>
          <table className="gp-table">
            <thead>
              <tr>
                <th>Measured on amplemarket.com</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>home-hero.min.js</td>
                <td>3.1 KB gz</td>
              </tr>
              <tr>
                <td>home-personas.min.js</td>
                <td>3.5 KB gz</td>
              </tr>
              <tr>
                <td>home-pillars.min.js</td>
                <td>2.4 KB gz</td>
              </tr>
              <tr>
                <td>One persona illustration, AVIF</td>
                <td>21 KB</td>
              </tr>
              <tr>
                <td>Hero canvas</td>
                <td>1836 x 1121</td>
              </tr>
              <tr>
                <td>Frame time, p50 / p95</td>
                <td>13.3 / 14.2 ms</td>
              </tr>
              <tr>
                <td>JS heap across scroll states</td>
                <td>37 to 38 MB</td>
              </tr>
              <tr>
                <td>Live WebGL contexts</td>
                <td>7</td>
              </tr>
            </tbody>
          </table>
          <p className="gp-note" style={{ marginTop: 32 }}>
            Seven contexts is the one number worth flinching at. Chrome starts
            discarding the oldest at around sixteen, and a context is not a
            per-page budget, it is a per-browser one shared with every other tab
            the reader has open. Every field on this route draws through a
            single shared context and copies the result into an ordinary 2D
            canvas with <code>drawImage</code>, which costs a blit per field per
            frame and nothing else.
          </p>
          <table className="gp-table">
            <thead>
              <tr>
                <th>This route</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Fields registered</td>
                <td>{contexts === null ? "counting" : contexts}</td>
              </tr>
              <tr>
                <td>WebGL contexts</td>
                <td>1</td>
              </tr>
              <tr>
                <td>Fields drawing while offscreen</td>
                <td>0</td>
              </tr>
            </tbody>
          </table>
          <p className="gp-note" style={{ marginTop: 24 }}>
            The gating is the same as theirs and it is not optional at this
            count: an IntersectionObserver with a 120px margin stops a field
            that has scrolled away, a visibilitychange handler drops the whole
            loop when the tab blurs, and{" "}
            <code>prefers-reduced-motion</code> paints one frame and then stops.
            A still field is a much better answer to that preference than an
            empty box.
          </p>
        </section>

        {/* -------------------------------------------------------- source */}
        <section className="gp-section">
          <div className="gp-section-head">
            <span className="gp-num">09</span>
            <h2 className="gp-h2">Using it</h2>
          </div>
          <pre className="gp-code">{SNIPPET}</pre>
          <p className="gp-note" style={{ marginTop: 32 }}>
            And the three lines in the fragment shader that do the actual work.
            The first two bend the domain, the third averages the blob weights
            rather than summing the colours.
          </p>
          <pre className="gp-code">{SHADER_SNIPPET}</pre>
        </section>

        <footer className="gp-foot">
          <p>
            Technique observed on{" "}
            <a href="https://www.amplemarket.com/" rel="noreferrer noopener" target="_blank">
              amplemarket.com
            </a>
            . Their implementation is in home-hero.min.js, home-personas.min.js
            and home-pillars.min.js. Sibling working document:{" "}
            <a href="/dither">/dither</a>.
          </p>
        </footer>
      </div>
    </main>
  );
}
