"use client";

import { useEffect, useRef } from "react";

export default function TusiPage() {
  const containerRef = useRef(null);

  // Create the p5 instance once (client-only).
  useEffect(() => {
    let instance;
    let cancelled = false;

    (async () => {
      const p5 = (await import("p5")).default;
      if (cancelled || !containerRef.current) return;

      const sketch = (p) => {
        // Fixed geometry (defaults to the Tusi couple: R = 2r, a = r).
        const R = 280;
        const r = 140;
        const speed = 2.0;
        const TWO_PI = Math.PI * 2;
        const PI = Math.PI;
        const AMP = 2 * r; // oscillation amplitude (= R for the Tusi couple)
        const EMERGE_T = PI; // vertical diamond emerges (from center) after the first half cycle
        const FIRST_DOT_T = TWO_PI; // first black dot appears after the two diamonds
        const REVEAL_STEP = PI; // then one more black dot every half cycle
        // the 6 black-dot directions (all but horizontal & vertical), in
        // opposite-alternating reveal order
        const dotBetas = [PI / 8, (5 * PI) / 8, PI / 4, (3 * PI) / 4, (3 * PI) / 8, (7 * PI) / 8];

        let t = 0;
        let tPrev = 0; // previous frame's t (to detect center crossings)
        let blinkUntil = -1; // blink the black dots red until this t
        let cx, cy;

        function drawWheel(tt) {
          const BLINK_DUR = 0.3; // how long the black dots blink red (t-units)

          // center crossings -> blink the black dots red.
          // H diamond crosses when cos(t) flips; V (once out) when sin(t-EMERGE_T) flips.
          const hCross = Math.cos(tPrev) * Math.cos(tt) < 0;
          const vOut = tt >= EMERGE_T;
          const vCross = vOut && Math.sin(tPrev) * Math.sin(tt) < 0;
          if (hCross || vCross) blinkUntil = tt + BLINK_DUR;
          const blinking = tt < blinkUntil;

          const diamond = (dx, dy) => {
            p.noStroke();
            p.fill(220, 30, 40);
            const d = 8; // equal half-diagonals (a square rotated 45°)
            p.beginShape();
            p.vertex(dx, dy - d);
            p.vertex(dx + d, dy);
            p.vertex(dx, dy + d);
            p.vertex(dx - d, dy);
            p.endShape(p.CLOSE);
          };

          // black dots — the other directions, one revealing every half cycle
          // after the two diamonds; they blink red on any diamond crossing.
          p.noStroke();
          for (let k = 0; k < dotBetas.length; k++) {
            if (tt < FIRST_DOT_T + k * REVEAL_STEP) continue;
            const beta = dotBetas[k];
            const s = AMP * Math.cos(tt - beta);
            const dx = cx + s * Math.cos(beta);
            const dy = cy + s * Math.sin(beta);
            if (blinking) p.fill(220, 30, 40);
            else p.fill(0);
            p.circle(dx, dy, 6);
          }

          // horizontal diamond — always; oscillates along the horizontal line
          diamond(cx + AMP * Math.cos(tt), cy);

          // vertical diamond — same Tusi phase as every point (sin t), so it
          // stays aligned on the circle; just becomes visible from EMERGE_T
          if (vOut) diamond(cx, cy + AMP * Math.sin(tt));
        }

        p.setup = () => {
          p.createCanvas(p.windowWidth, p.windowHeight);
          p.pixelDensity(2);
          cx = p.width * 0.5;
          cy = p.height * 0.55;
        };

        p.windowResized = () => {
          p.resizeCanvas(p.windowWidth, p.windowHeight);
          cx = p.width * 0.5;
          cy = p.height * 0.55;
        };

        p.draw = () => {
          p.background(255);

          // center cross spanning the big circle's diameter (always black)
          p.stroke(0);
          p.strokeWeight(1);
          p.line(cx - R, cy, cx + R, cy);
          p.line(cx, cy - R, cx, cy + R);

          drawWheel(t);
          tPrev = t;
          t += 0.02 * speed;
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
    <main className="relative w-screen h-screen overflow-hidden bg-white">
      <div ref={containerRef} className="fixed inset-0 z-0" />
    </main>
  );
}
