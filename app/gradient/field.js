"use client";

// The gradient field: three animated blobs, hashed grain, drawn on the GPU.
//
// This is the technique behind amplemarket.com's hero and persona cards,
// rebuilt from their shader with two deliberate changes.
//
// 1. ONE CONTEXT, N FIELDS. They spend a WebGL context per element: seven live
//    contexts on their homepage, against a Chrome soft cap of about sixteen
//    before it starts discarding the oldest. Every field here shares a single
//    offscreen context and copies its result into a plain 2D canvas with
//    drawImage. The copy costs a blit; the alternative costs a context, a
//    program, a buffer and a slot in a global budget you do not control.
//
// 2. GRAIN THAT HOLDS ITS SIZE. Theirs hashes a normalised coordinate, so the
//    noise cell is whatever a pixel happens to be. Hashing floor(fragCoord /
//    grainSize) instead pins the cell to a real number of device pixels, so a
//    field can be resized without the grain changing character, and grainSize
//    becomes a dial: 1 is film, 3 is riso.
//
// Kept from theirs unchanged, because they are right: the domain warp
// constants, the Lissajous blob paths, and dividing the noise amplitude by
// devicePixelRatio so grain does not double in density on a retina display.

import { useEffect, useRef } from "react";
import { MOTIONS } from "./motions";

// A single triangle big enough to cover clip space. Three vertices instead of
// the usual quad's six, and no seam down the diagonal for the rasteriser to
// think about.
const VERT = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

const FRAG = `
#ifdef GL_ES
precision highp float;
#endif

uniform vec2  u_resolution;
uniform float u_time;     // drives the domain warp only, now that the blob
                          // centres arrive already computed
uniform float u_dpr;
uniform vec3  u_col1;
uniform vec3  u_col2;
uniform vec3  u_col3;
uniform vec2  u_c1;       // blob centres, in UV space, computed on the CPU
uniform vec2  u_c2;
uniform vec2  u_c3;
uniform vec3  u_radius;   // one radius per blob
uniform float u_soft;     // width of the falloff, in the same units as radius
uniform float u_warp;     // how hard the domain is bent before sampling
uniform float u_grain;
uniform float u_grainSize;
uniform float u_gain;     // overall alpha, lets a field sit back in a layout

// The falloff. smoothstep rather than a distance-squared curve because the
// tail matters more than the core here: it is the last few per cent of alpha
// that either dissolves into the page or stops at a visible ring.
float blob(vec2 p, vec2 c, float r) {
  float d = distance(p, c) * 2.0;
  return 1.0 - smoothstep(r, r + u_soft, d);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv;
  float t = u_time;

  // Domain warp. Two bent sine fields, one per axis, each modulated by the
  // other axis so the distortion never repeats on a straight line. This is
  // what separates the look from three radial-gradients sliding around: the
  // blobs deform as they travel instead of holding a circular silhouette.
  p.x += cos(t * 0.70 + p.x * 5.0) * 0.21 * sin(t * 0.14 + p.y * 7.0) * 0.29 * u_warp;
  p.y += sin(t * 0.50 + p.x * 3.0) * 0.37 * cos(t * 0.36 + p.y * 5.0) * 0.12 * u_warp;

  // The blob paths used to be six trigonometric products per pixel right here,
  // which is where the source site still computes them. They are three vec2
  // uniforms now: same picture, none of the per-fragment cost, and the motion
  // becomes a named function in motions.js instead of a branch in GLSL.
  float w1 = blob(p, u_c1, u_radius.x);
  float w2 = blob(p, u_c2, u_radius.y);
  float w3 = blob(p, u_c3, u_radius.z);

  // Normalising the weights rather than adding the colours is the whole
  // difference between three lights and three inks. Added, an overlap sums
  // toward white or toward mud depending on the palette; here an overlap is a
  // weighted average, so it lands on a colour that is genuinely between the
  // two and the hues stay separable at every crossing.
  float sum = w1 + w2 + w3;
  vec3 col = (u_col1 * w1 + u_col2 * w2 + u_col3 * w3) / max(sum, 0.0001);

  // Alpha comes from the strongest single blob, not the sum. Using the sum
  // makes every overlap opaque and the field grows a hard plateau in the
  // middle; using the max keeps the silhouette of whichever blob is present.
  float a = clamp(max(max(w1, w2), w3) * u_gain, 0.0, 1.0);

  // Grain, multiplied in before the premultiply so it darkens the colour
  // rather than punching holes in the alpha. Dividing by dpr keeps the
  // apparent strength constant: twice the pixels means twice as many noise
  // samples per inch, which without this reads as twice the texture.
  float n = hash(floor(gl_FragCoord.xy / max(u_grainSize, 1.0))) / u_dpr;
  col *= 1.0 - n * u_grain;

  // The context is premultipliedAlpha, the default, so the colour has to be
  // scaled by alpha here or every soft edge picks up a bright fringe.
  gl_FragColor = vec4(col * a, a);
}
`;

// Past 2 the extra pixels are invisible and the fill cost is real. This is a
// full-screen fill every frame; it is the one number that actually moves the
// GPU time on this page.
const MAX_DPR = 2;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn(gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

// The pool is module scope on purpose. Every <Field> on the route shares it,
// it is built on first mount and never torn down, and a route with forty
// fields still costs exactly one context.
let pool = null;
let poolFailed = false;

function getPool() {
  if (pool || poolFailed) return pool;

  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    // The canvas is never in the document, so it is never composited, so the
    // implicit clear that normally follows compositing never fires and the
    // buffer would survive anyway. Asked for explicitly because "would anyway"
    // is not a contract, and reading it back with drawImage is the entire plan.
    preserveDrawingBuffer: true,
  });
  if (!gl) {
    poolFailed = true;
    return null;
  }

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) {
    poolFailed = true;
    return null;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(gl.getProgramInfoLog(program));
    poolFailed = true;
    return null;
  }

  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPosition = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  // No blending: the shader writes every fragment in the viewport, including
  // the fully transparent ones, so there is nothing to blend against and
  // nothing to clear between targets either.
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  const u = (name) => gl.getUniformLocation(program, name);
  const uniforms = {
    resolution: u("u_resolution"),
    time: u("u_time"),
    dpr: u("u_dpr"),
    col1: u("u_col1"),
    col2: u("u_col2"),
    col3: u("u_col3"),
    c1: u("u_c1"),
    c2: u("u_c2"),
    c3: u("u_c3"),
    radius: u("u_radius"),
    soft: u("u_soft"),
    warp: u("u_warp"),
    grain: u("u_grain"),
    grainSize: u("u_grainSize"),
    gain: u("u_gain"),
  };

  const targets = new Set();
  let raf = null;
  let last = 0;

  // One observer for the whole route rather than one per field. A field that
  // has scrolled away stops accumulating time as well as stopping drawing, so
  // it does not jump forward when it comes back.
  const io =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              const t = e.target.__field;
              if (t) t.visible = e.isIntersecting;
            }
            kick();
          },
          { rootMargin: "120px" }
        );

  function draw(t) {
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(t.cssW * dpr));
    const h = Math.max(1, Math.round(t.cssH * dpr));

    // The shared buffer only ever grows, to the high-water mark across every
    // field. Resizing reallocates, so doing it per field per frame would cost
    // more than every draw on the page put together.
    if (canvas.width < w || canvas.height < h) {
      canvas.width = Math.max(canvas.width, w);
      canvas.height = Math.max(canvas.height, h);
    }
    if (t.canvas.width !== w) t.canvas.width = w;
    if (t.canvas.height !== h) t.canvas.height = h;

    // Resizing a drawing buffer does not restore the viewport, and this one is
    // reset per target anyway since every field renders a different rectangle.
    // The motion is evaluated once per field per frame, on the CPU, and its
    // three centres are uploaded. A motion may also scale the radii, the warp
    // depth and the warp's own clock, which is what separates a field that
    // travels from one that boils in place.
    const m = (MOTIONS[t.motion] || MOTIONS.drift)(t.clock);

    gl.viewport(0, 0, w, h);
    gl.uniform2f(uniforms.resolution, w, h);
    gl.uniform1f(uniforms.time, t.clock * m.clock);
    gl.uniform1f(uniforms.dpr, dpr);
    gl.uniform2f(uniforms.c1, m.c[0], m.c[1]);
    gl.uniform2f(uniforms.c2, m.c[2], m.c[3]);
    gl.uniform2f(uniforms.c3, m.c[4], m.c[5]);
    gl.uniform3fv(uniforms.col1, t.colors[0]);
    gl.uniform3fv(uniforms.col2, t.colors[1]);
    gl.uniform3fv(uniforms.col3, t.colors[2]);
    gl.uniform3f(
      uniforms.radius,
      t.radius[0] * m.r[0],
      t.radius[1] * m.r[1],
      t.radius[2] * m.r[2]
    );
    gl.uniform1f(uniforms.soft, t.soft);
    gl.uniform1f(uniforms.warp, t.warp * m.warp);
    gl.uniform1f(uniforms.grain, t.grain);
    gl.uniform1f(uniforms.grainSize, t.grainSize);
    gl.uniform1f(uniforms.gain, t.gain);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // GL's origin is bottom left and the 2D canvas's is top left, so the
    // rectangle just rendered sits at the bottom of the shared buffer's image.
    // "copy" replaces the destination including its alpha, which saves a
    // clearRect and stops last frame showing through the transparent parts.
    t.ctx.globalCompositeOperation = "copy";
    t.ctx.drawImage(canvas, 0, canvas.height - h, w, h, 0, 0, w, h);
    t.painted = true;
  }

  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;

    let live = 0;
    for (const t of targets) {
      if (!t.visible || t.cssW < 1 || t.cssH < 1) continue;
      // Reduced motion still gets the picture, once, and then stops. An empty
      // box would be a worse answer to the preference than a still one.
      if (t.still) {
        if (!t.painted) draw(t);
        continue;
      }
      t.clock += dt * t.speed;
      draw(t);
      live++;
    }

    if (live > 0 && !document.hidden) raf = requestAnimationFrame(frame);
    else {
      raf = null;
      last = 0;
    }
  }

  function kick() {
    if (raf === null && !document.hidden) raf = requestAnimationFrame(frame);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      last = 0;
    } else {
      kick();
    }
  });

  // A lost context invalidates the program, the buffer and every uniform
  // location. Rebuilding all of that in place is more moving parts than the
  // page is worth: drop the pool, let the next mount build a fresh one, and
  // leave the last painted frame sitting in each 2D canvas in the meantime.
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    pool = null;
  });

  pool = {
    add(t) {
      targets.add(t);
      if (io && t.el) {
        t.el.__field = t;
        io.observe(t.el);
      } else {
        t.visible = true;
      }
      kick();
    },
    remove(t) {
      targets.delete(t);
      if (io && t.el) io.unobserve(t.el);
    },
    kick,
    count: () => targets.size,
  };
  return pool;
}

// How many fields are sharing the one context right now. The page quotes this
// back at the reader, so it is a live number rather than one I have to keep in
// sync with the markup by hand.
export function fieldCount() {
  return pool ? pool.count() : 0;
}

// "#ffd7f0" or "255,215,240", because half the useful palettes are already
// written one way and half the other.
function toRgb(value) {
  if (Array.isArray(value)) return value.map((n) => n / 255);
  const s = String(value).trim();
  if (s.includes(",")) return s.split(",").map((n) => parseFloat(n) / 255);
  const h = s.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export default function Field({
  colors = ["#FFEED8", "#FFD7F0", "#D0B2FF"],
  radius = [0.5, 1.0, 1.0],
  soft = 0.6,
  warp = 4,
  speed = 1,
  grain = 0.2,
  grainSize = 1,
  gain = 1,
  motion = "drift",
  mask = "none",
  phase = 0,
  className = "",
  style,
}) {
  const ref = useRef(null);
  const state = useRef(null);

  // Everything the loop reads lives on one mutable object so a prop change
  // updates the running field instead of restarting it. Re-registering on
  // every render would reset the clock and make the whole page twitch.
  const settings = {
    colors: colors.map(toRgb),
    radius: new Float32Array(radius),
    soft,
    warp,
    speed,
    grain,
    grainSize,
    gain,
    motion,
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const p = getPool();
    if (!p) return;

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const t = {
      el,
      canvas: el,
      ctx: el.getContext("2d"),
      cssW: 0,
      cssH: 0,
      clock: phase,
      visible: false,
      painted: false,
      still: media.matches,
      ...settings,
    };
    state.current = t;

    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width === t.cssW && r.height === t.cssH) return;
      t.cssW = r.width;
      t.cssH = r.height;
      t.painted = false;
      p.kick();
    });
    ro.observe(el);

    const onMotion = () => {
      t.still = media.matches;
      t.painted = false;
      p.kick();
    };
    media.addEventListener("change", onMotion);

    p.add(t);
    return () => {
      p.remove(t);
      ro.disconnect();
      media.removeEventListener("change", onMotion);
      state.current = null;
    };
    // phase is read once, at registration, so it is intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The live update path. Cheap, runs on every render, and never touches the
  // clock or the registration.
  useEffect(() => {
    const t = state.current;
    if (!t) return;
    Object.assign(t, settings);
    t.painted = false;
    pool?.kick();
  });

  return (
    <canvas
      ref={ref}
      className={className}
      aria-hidden="true"
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        maskImage: mask,
        WebkitMaskImage: mask,
        maskSize: "100% 100%",
        WebkitMaskSize: "100% 100%",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        ...style,
      }}
    />
  );
}
