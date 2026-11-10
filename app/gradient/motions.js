// The five ways the light is allowed to move.
//
// These used to live in the fragment shader, the way the source site's do, and
// moving them to JavaScript costs nothing and buys two things. Every frame now
// uploads three vec2s instead of running six trigonometric products per pixel,
// and a motion becomes an ordinary function anyone can read rather than a
// branch inside GLSL.
//
// Each returns centres in the shader's 0..1 UV space, a multiplier per blob
// radius, and how hard to drive the two things the shader still owns: the
// domain warp, and the clock that warp runs on.
//
// One rule holds across all five. The blobs move; nothing else does. On this
// route the texture on top is a screen-locked ordered dither, and a dither that
// travels with the thing underneath stops being a dither and becomes a moving
// pattern. Every dot here is nailed to the viewport and only its state changes.

const TAU = Math.PI * 2;

export const MOTIONS = {
  // The source site's own paths: a cosine scaled by a second cosine at an
  // unrelated rate. The product means each blob slows, stalls and reverses at
  // intervals that never line up, so a loop of any length never announces
  // where it started. This is the default for good reason.
  drift(t) {
    return {
      c: [
        0.5 + Math.cos(t * 0.4) * 0.5 * Math.cos(t * 0.2) * 0.5,
        0.5 + Math.cos(t * 0.3) * 0.5 * Math.cos(t * 0.5) * 0.5,
        0.5 + Math.sin(t * 0.4) * 0.5 * Math.cos(t * 0.2) * 0.5,
        0.5 + Math.sin(t * 0.3) * 0.5 * Math.cos(t * 0.5) * 0.5,
        0.5 + Math.cos(t * 0.5) * 0.5 * Math.sin(t * 0.2) * 0.5,
        0.5 + Math.cos(t * 0.4) * 0.5 * Math.sin(t * 0.3) * 0.5,
      ],
      r: [1, 1, 1],
      warp: 1,
      clock: 1,
    };
  },

  // Three blobs on one ellipse, 120 degrees apart, constant angular speed. The
  // regularity is the point and also the risk: it is the only motion here a
  // viewer can predict, which makes it the right one behind something that
  // wants to be calm and the wrong one anywhere it might be stared at.
  orbit(t) {
    const a = t * 0.32;
    const c = [];
    for (let i = 0; i < 3; i++) {
      const p = a + (i * TAU) / 3;
      c.push(0.5 + Math.cos(p) * 0.3, 0.5 + Math.sin(p) * 0.24);
    }
    return { c, r: [1, 1, 1], warp: 0.6, clock: 0.8 };
  },

  // Centres near enough fixed, radii breathing in thirds. Nothing travels, so
  // the dither underneath flips in concentric rings rather than along a moving
  // edge. Reads as light swelling in place instead of light going somewhere.
  pulse(t) {
    const base = [0.36, 0.42, 0.64, 0.4, 0.5, 0.66];
    const w = 0.05;
    return {
      c: [
        base[0] + Math.cos(t * 0.25) * w,
        base[1] + Math.sin(t * 0.21) * w,
        base[2] + Math.cos(t * 0.19 + 2) * w,
        base[3] + Math.sin(t * 0.27 + 2) * w,
        base[4] + Math.cos(t * 0.23 + 4) * w,
        base[5] + Math.sin(t * 0.17 + 4) * w,
      ],
      r: [
        1 + Math.sin(t * 0.85) * 0.36,
        1 + Math.sin(t * 0.85 + TAU / 3) * 0.36,
        1 + Math.sin(t * 0.85 + (2 * TAU) / 3) * 0.36,
      ],
      warp: 0.5,
      clock: 0.7,
    };
  },

  // Linear travel with a wrap. The range is deliberately wider than the box on
  // both sides, so a blob is always fully outside before it reappears and
  // nothing is ever seen popping into existence at the edge.
  sweep(t) {
    const span = 2.4;
    const wrap = (v) => (((v % span) + span) % span) - 0.7;
    const s = t * 0.22;
    return {
      c: [
        wrap(s), 0.3 + Math.sin(t * 0.4) * 0.06,
        wrap(s + 0.8), 0.52 + Math.sin(t * 0.33 + 1) * 0.06,
        wrap(s + 1.6), 0.74 + Math.sin(t * 0.29 + 2) * 0.06,
      ],
      r: [1, 1, 1],
      warp: 0.8,
      clock: 1,
    };
  },

  // The blobs barely move and the warp does everything. Turning the warp clock
  // up rather than the travel speed churns the field in place, which is the
  // one motion here that survives being cropped to a very small box: there is
  // no travel to crop out.
  boil(t) {
    const w = 0.06;
    return {
      c: [
        0.38 + Math.cos(t * 0.6) * w, 0.44 + Math.sin(t * 0.7) * w,
        0.62 + Math.cos(t * 0.5 + 2) * w, 0.42 + Math.sin(t * 0.65 + 2) * w,
        0.5 + Math.cos(t * 0.55 + 4) * w, 0.62 + Math.sin(t * 0.6 + 4) * w,
      ],
      r: [1, 1, 1],
      warp: 2.4,
      clock: 2.2,
    };
  },
};

export const MOTION_NAMES = Object.keys(MOTIONS);
