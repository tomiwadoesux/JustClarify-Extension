"use client";

// A three.js overlay that renders the quote text to a texture and warps it with
// turbulent (fBm) noise. It always renders on its own rAF; the v3 scroll drives
// three values through the imperative `set()` handle:
//   scale     — uniform zoom of the text (1 = native, >1 = bigger)
//   intensity — how strong the turbulent displacement is (0 = crisp text)
//   alpha     — overall opacity (the DOM text cross-fades into this)
// Scaling is done in UV space (not by scaling the mesh) so it stays uniform on
// screen regardless of the canvas aspect ratio.

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uAlpha;
  uniform float uScale;

  // 2D simplex noise (Ashima / Stefan Gustavson)
  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec2 mod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }
  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  float fbm(vec2 p){
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * snoise(p); p *= 2.0; a *= 0.5; }
    return s;
  }

  void main(){
    // uniform zoom around the centre (UV space → stays screen-uniform)
    vec2 uv = (vUv - 0.5) / uScale + 0.5;
    float t = uTime;
    // turbulent displacement field — two decorrelated fBm samples drifting over time
    vec2 q = vec2(
      fbm(uv * 3.0 + vec2(0.0, t * 0.25)),
      fbm(uv * 3.0 + vec2(5.2, -t * 0.21))
    );
    uv += q * 0.045 * uIntensity;
    vec4 c = texture2D(uTex, uv);
    c.a *= uAlpha;
    gl_FragColor = c;
  }
`;

const TurbulentText = forwardRef(function TurbulentText(
  { lines, color = "#000000", sampleSelector = ".quote-lines" },
  ref
) {
  const wrapRef = useRef(null);
  // latest values pushed from the scroll timeline; read each frame by the loop.
  const stateRef = useRef({ scale: 1, intensity: 0, alpha: 0 });

  useImperativeHandle(
    ref,
    () => ({
      set(next) {
        Object.assign(stateRef.current, next);
      },
    }),
    []
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    const gl = renderer.domElement;
    gl.style.width = "100%";
    gl.style.height = "100%";
    gl.style.display = "block";
    wrap.appendChild(gl);

    const scene = new THREE.Scene();
    // camera sits in FRONT of the z=0 quad (not on it) so the quad is inside the
    // frustum and actually renders.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    const textCanvas = document.createElement("canvas");
    const texture = new THREE.CanvasTexture(textCanvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uTex: { value: texture },
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uAlpha: { value: 0 },
        uScale: { value: 1 },
      },
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false; // it's a fullscreen quad — never cull it
    scene.add(mesh);

    let W = 0;
    let H = 0;

    // copy font metrics from the live DOM quote so the canvas text matches it
    function readFont() {
      const span = document.querySelector(`${sampleSelector} .reveal-line span`);
      const block = document.querySelector(sampleSelector);
      const cs = span ? getComputedStyle(span) : block ? getComputedStyle(block) : null;
      const family = cs ? cs.fontFamily : "sans-serif";
      const weight = cs ? cs.fontWeight : "500";
      const fontPx = cs ? parseFloat(cs.fontSize) : 20;
      let lineHeightPx = fontPx * 1.6;
      if (block) {
        const lh = getComputedStyle(block).lineHeight;
        if (lh && lh.endsWith("px")) lineHeightPx = parseFloat(lh);
      }
      return { family, weight, fontPx, lineHeightPx };
    }

    function drawText() {
      if (W === 0 || H === 0) return;
      const { family, weight, fontPx, lineHeightPx } = readFont();
      textCanvas.width = Math.floor(W * dpr);
      textCanvas.height = Math.floor(H * dpr);
      const ctx = textCanvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${weight} ${fontPx}px ${family}`;
      const total = lines.length * lineHeightPx;
      const startY = H / 2 - total / 2 + lineHeightPx / 2;
      lines.forEach((ln, i) => ctx.fillText(ln, W / 2, startY + i * lineHeightPx));
      texture.needsUpdate = true;
    }

    function resize() {
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      if (W === 0 || H === 0) return;
      renderer.setSize(W, H, false);
      drawText();
    }

    resize();
    // the real webfont may land after first paint — redraw once it's ready
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(drawText).catch(() => {});
    }
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const clock = new THREE.Clock();
    let raf;
    function loop() {
      const s = stateRef.current;
      material.uniforms.uTime.value = clock.getElapsedTime();
      material.uniforms.uIntensity.value = s.intensity;
      material.uniforms.uAlpha.value = s.alpha;
      material.uniforms.uScale.value = s.scale;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    }
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.dispose();
      if (gl.parentNode) gl.parentNode.removeChild(gl);
    };
  }, [lines, color, sampleSelector]);

  return <div ref={wrapRef} className="absolute inset-0 pointer-events-none" aria-hidden="true" />;
});

export default TurbulentText;
