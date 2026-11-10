// Mask shapes for /gradient, built as data-URI SVGs with the blur baked in.
//
// The whole effect turns on one decision: the mask is blurred, not the thing
// being masked. Blur the canvas and you get a soft picture with a hard edge
// where the element stops. Blur the mask and the colour itself dissolves into
// the page, which is what reads as light rather than as a shape.
//
// Two ways to hand CSS a mask, and they are not interchangeable:
//
//   mask-image: url(#id)       references a live <mask> element in the DOM.
//                              The path can be rewritten every frame, which is
//                              how amplemarket.com animates its beams. Element
//                              references are the fragile option: they need the
//                              SVG to be in the same document and Safari has
//                              been inconsistent about them for years.
//
//   mask-image: url("data:…")  is an image like any other. Portable, cached,
//                              and resolution independent because the blur is
//                              expressed in viewBox units. The shape is frozen
//                              at authoring time, which for a static silhouette
//                              is not a loss.
//
// Everything below takes the second route. WEDGE_ELEMENT at the bottom is the
// same shape written the first way, so the page can show both.

// Every shape is authored in a 100x100 box and stretched to the element by
// preserveAspectRatio="none" + mask-size: 100% 100%. That is what makes
// stdDeviation resolution independent: 4 units is 4% of the box, whether the
// box ends up 78px wide or 1836px wide.
const VIEW = 100;

// color-interpolation-filters="sRGB" is not decoration. The SVG default is
// linearRGB, and a Gaussian blur run in linear light puts its half-alpha point
// somewhere else entirely, so the same stdDeviation reads noticeably tighter.
// Every browser agrees on sRGB; nothing agrees on what linear looks like next
// to a CSS gradient.
function wrap(shape, blur) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" ` +
    `preserveAspectRatio="none">` +
    `<filter id="b" x="-40%" y="-40%" width="180%" height="180%" ` +
    `color-interpolation-filters="sRGB">` +
    `<feGaussianBlur stdDeviation="${blur}"/></filter>` +
    `<g filter="url(#b)" fill="#fff">${shape}</g></svg>`
  );
}

// encodeURIComponent rather than base64: it stays readable in devtools, it is
// shorter for markup this small, and it escapes the # in any fill we add later.
function uri(markup) {
  return `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
}

// A cone thrown from the top-right corner, the megaphone beam. The curve on
// the return leg is what stops it reading as a plain triangle: the light pools
// at the wide end instead of coming to a point at both ends.
const CONE =
  '<path d="M100,4 L18,59 C-6,80 13,92 25,92 H100 Z"/>';

// A beam with its apex inside the box, spreading to the right edge. Heavier
// blur turns this into the diffuse wash behind a heading.
const BEAM = '<path d="M6,50 L100,2 L100,98 Z"/>';

// Stretched to the element by preserveAspectRatio="none", so in a wide box
// this is an ellipse, not a circle. That is the intent: one shape that fills
// whatever aspect it is handed.
const ORB = '<circle cx="50" cy="50" r="30"/>';

// The horizontal wash. rx keeps the ends from squaring off under low blur.
const BAND = '<rect x="-5" y="30" width="110" height="40" rx="20"/>';

// A swept quarter, the shape climbing the stairs in the Founders card. Drawn
// as a thick stroke rather than a filled crescent so the width stays even
// along the whole sweep.
const ARC =
  '<path d="M2,98 A96,96 0 0 1 98,2" fill="none" stroke="#fff" ' +
  'stroke-width="34" stroke-linecap="round"/>';

// Type as a mask. Worth knowing this works, worth knowing the caveat: an SVG
// used as an image cannot load a webfont, so this resolves to whatever the OS
// calls sans-serif. Fine for a silhouette, wrong for anything anyone reads.
const TYPE =
  '<text x="50" y="50" text-anchor="middle" dominant-baseline="central" ' +
  'font-family="sans-serif" font-weight="800" font-size="30" ' +
  'letter-spacing="-1">LIGHT</text>';

const SHAPES = { cone: CONE, beam: BEAM, orb: ORB, band: BAND, arc: ARC, type: TYPE };

// blur is in viewBox units, so it reads as a percentage of the shorter side.
// 0 is a hard clip, 4 is the source site's card setting, 20 is its hero, and
// past about 30 the shape stops being legible and becomes a wash.
export function mask(name, blur = 4) {
  const shape = SHAPES[name];
  if (!shape) return "none";
  return uri(wrap(shape, blur));
}

export const MASK_NAMES = Object.keys(SHAPES);

// The same cone as an element reference, for the one panel that demonstrates
// the other technique. Returned as markup so the page can drop it inline and
// point mask-image at the id.
export function wedgeElement(id, blur = 4) {
  return {
    id,
    markup:
      `<svg width="0" height="0" aria-hidden="true" focusable="false" ` +
      `style="position:absolute">` +
      `<defs>` +
      `<filter id="${id}-blur" x="-40%" y="-40%" width="180%" height="180%" ` +
      `color-interpolation-filters="sRGB">` +
      // maskContentUnits="objectBoundingBox" puts the path in 0..1 space, and
      // primitiveUnits still defaults to that same user space, so the blur has
      // to be expressed as a fraction. Passing 4 here paints the whole box white.
      `<feGaussianBlur stdDeviation="${blur / 100}"/></filter>` +
      `<mask id="${id}" maskUnits="objectBoundingBox" ` +
      `maskContentUnits="objectBoundingBox">` +
      `<path fill="#fff" filter="url(#${id}-blur)" ` +
      `d="M1,.04 L.18,.59 C-.06,.8 .13,.92 .25,.92 H1 Z"/>` +
      `</mask></defs></svg>`,
    value: `url(#${id})`,
  };
}
