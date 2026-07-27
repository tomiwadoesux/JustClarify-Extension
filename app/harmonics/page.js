"use client";

import { useEffect, useRef, useState } from "react";

export default function HarmonicsPage() {
  const containerRef = useRef(null);
  const paramsRef = useRef({ speed: 1.0, glow: true, showCircles: true, paused: false });
  const [speed, setSpeed] = useState(1.0);
  const [glow, setGlow] = useState(true);
  const [showCircles, setShowCircles] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    paramsRef.current = { speed, glow, showCircles, paused };
  }, [speed, glow, showCircles, paused]);

  useEffect(() => {
    let instance;
    let cancelled = false;

    (async () => {
      const p5 = (await import("p5")).default;
      if (cancelled || !containerRef.current) return;

      const sketch = (p) => {
        const PI = Math.PI;
        let u = 0; // cycle phase 0..1 (loops)
        let hold = 0; // frames left to pause on the aligned frame after a join

        // ── Geometry in the original SVG design space (viewBox 1463 x 760) ──
        const DESIGN_W = 1463;
        const DESIGN_H = 760;
        const CENTER = { x: 731.5, y: 380 }; // figure center
        const L = { x: 704.5, y: 380 }; // left landing point  (27px left of center)
        const R = { x: 758.5, y: 380 }; // right landing point (27px right of center)
        let s = 1; // design→screen scale (set on resize)

        // ── The 8 circles. Each = one dot riding one circle. ─────────────────
        // Every circle's CENTER moves in a CIRCLE (a round orbit through its
        // home), each facing its own direction but all the SAME size.  The orbit
        // passes through home once per cycle, so every center is back home as the
        // dots rejoin (the starting symmetric figure reforms).
        // The one flagged still:true never moves at all — only its dot goes round.
        // anchor : the join point the circle passes through, where its dot sits
        //          at alignment.  L-anchored circles bulge RIGHT (theta0 = 0);
        //          R-anchored circles bulge LEFT (theta0 = PI).
        // r      : radius in design units — powers of two (47.5,94.5,189.5,378.5).
        // freq   : integer laps the DOT makes around its circle per cycle.
        const CIRCLES = [
          { anchor: "L", r: 378.5, freq: 1, size: 6 }, // big, bulges right
          { anchor: "L", r: 189.5, freq: 2, size: 5.5 },
          { anchor: "L", r: 94.5, freq: 3, size: 5 },
          { anchor: "L", r: 47.5, freq: 4, size: 4.5 },
          { anchor: "R", r: 378.5, freq: 2, size: 6 }, // big, bulges left
          { anchor: "R", r: 189.5, freq: 3, size: 5.5 },
          { anchor: "R", r: 94.5, freq: 4, size: 5 },
          { anchor: "R", r: 47.5, freq: 5, size: 4.5, still: true }, // designated static
        ];

        const ORBIT_R = 80; // orbit size — IDENTICAL for every circle

        // Precompute each circle's home center and its circular-orbit offset.
        const RINGS = CIRCLES.map((o, i) => {
          const A = o.anchor === "L" ? L : R;
          const theta0 = o.anchor === "L" ? 0 : PI;
          const hx = A.x + Math.cos(theta0) * o.r; // home center
          const hy = A.y + Math.sin(theta0) * o.r;
          const delta = i * (PI / 4); // each circle's orbit faces its own direction
          const offset = o.still
            ? () => ({ x: 0, y: 0 }) // designated still circle: never moves
            : (th) => ({
                // plain CIRCLE through home — center back home (dots meet) at th=0/2π
                x: ORBIT_R * (Math.cos(th + delta) - Math.cos(delta)),
                y: ORBIT_R * (Math.sin(th + delta) - Math.sin(delta)),
              });
          return { ...o, hx, hy, theta0, offset };
        });

        // Map a point from design space to centered, scaled screen space.
        const sx = (x) => p.width / 2 + (x - CENTER.x) * s;
        const sy = (y) => p.height / 2 + (y - CENTER.y) * s;

        function resize() {
          // Fit the whole figure on screen with a small margin.
          s = Math.min(p.width / DESIGN_W, p.height / DESIGN_H) * 0.92;
        }

        p.setup = () => {
          p.createCanvas(p.windowWidth, p.windowHeight);
          p.pixelDensity(2);
          resize();
        };

        p.windowResized = () => {
          p.resizeCanvas(p.windowWidth, p.windowHeight);
          resize();
        };

        p.draw = () => {
          const { speed, glow, showCircles, paused } = paramsRef.current;
          p.background(255);

          // Eased timeline: t sweeps 0 → 2π with ZERO velocity at both ends, so
          // the dots glide to a halt as they rejoin, then ease back into motion.
          const t = PI * (1 - Math.cos(PI * u));
          // 1 at the alignment instants (u≈0/1), 0 at mid-cycle — drives the glow pulse.
          const align = Math.cos(PI * u) ** 2;

          // Compute every circle + dot for this frame (in design space, then map).
          const items = RINGS.map((o) => {
            // center rides its rosette; offset = 0 at the join so the dot meets there
            const off = o.offset(t);
            const cx = o.hx + off.x;
            const cy = o.hy + off.y;
            // +PI phase puts the dot on the join point at t=0; integer freq
            // brings every dot back together at the end of each cycle.
            const ang = o.theta0 + PI + o.freq * t;
            return {
              cx: sx(cx),
              cy: sy(cy),
              r: o.r * s,
              size: o.size,
              big: o.r >= 378.5, // the two big circles get solid black outlines
              x: sx(cx + Math.cos(ang) * o.r),
              y: sy(cy + Math.sin(ang) * o.r),
            };
          });

          // 1 ─ circle outlines: solid black, big ones a touch heavier
          if (showCircles) {
            const ctx = p.drawingContext;
            ctx.setLineDash([]); // solid — no dashes
            p.noFill();
            p.stroke(0);
            for (const it of items) {
              p.strokeWeight(it.big ? 1 : 0.75);
              p.circle(it.cx, it.cy, it.r * 2);
            }
          }

          // 2 ─ red dots (no glow)
          p.noStroke();
          p.fill(220, 30, 40);
          for (const it of items) {
            p.circle(it.x, it.y, it.size + align * 2);
          }

          if (!paused) {
            if (hold > 0) {
              hold -= 1; // stopped, held on the aligned frame while the dots are joined
            } else {
              u += 0.0016 * speed;
              if (u >= 1) {
                u = 0; // back to the identical aligned frame
                hold = 0; // no dead freeze — it just eases through the join
              }
            }
          }
        };
      };

      instance = new p5(sketch, containerRef.current);
    })();

    return () => {
      cancelled = true;
      instance?.remove();
    };
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-white">
      <div ref={containerRef} className="fixed inset-0 z-0" />
    </main>
  );
}
