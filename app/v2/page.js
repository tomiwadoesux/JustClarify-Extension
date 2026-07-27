"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Header from "@/components/header";
import GoldenRatio from "@/components/golden-ratio";
import Veed from "@/components/veed";
import Abt from "@/components/abt";
import Why from "@/components/why";

gsap.registerPlugin(ScrollTrigger);

export default function HomeV2() {
  const pinContainerRef = useRef(null);
  const goldenRatioRef = useRef(null);

  useEffect(() => {
    // Only apply the scroll transition on desktop/tablet screens
    const media = window.matchMedia("(min-width: 768px)");
    if (!media.matches) return;

    const gr = goldenRatioRef.current;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: pinContainerRef.current,
          start: "top top",
          end: "+=100%", // shorter scroll = faster clear
          scrub: 1, // smooth scrubbing linked to scroll
          pin: true, // pin the viewport while the SVG draws out
          anticipatePin: 1,
        },
      });

      // 1) The GoldenRatio figure draws ITSELF IN on load (offset length → 0).
      //    On scroll it does the reverse: every stroked path un-draws / erases
      //    (offset 0 → length) so the whole figure retracts. Short duration =
      //    it draws out FAST, finishing well before the scroll ends.
      const strokePaths = gr.querySelectorAll("path[stroke]");
      strokePaths.forEach((path) => {
        const length = path.getTotalLength();
        // dasharray must equal the path length for the offset to read as a draw
        gsap.set(path, { strokeDasharray: length });

        tl.fromTo(
          path,
          { strokeDashoffset: 0 }, // fully drawn
          {
            strokeDashoffset: length, // erased
            duration: 0.6, // matches the text wipes so they finish together
            ease: "none",
          },
          0 // all paths erase together, starting immediately
        );
      });

      // 2) As the lines draw out, the caption leaves too. Each wipe is a white
      //    rect (= page bg) baked into the SVG; growing it erases what's under.
      //    "Understand what you read" clears from the RIGHT; the red badge +
      //    "without leaving the page" clears from the LEFT.
      const wu = gr.querySelector("#wipe-understand");
      if (wu) {
        tl.to(
          wu,
          {
            attr: { x: +wu.dataset.x1, width: +wu.dataset.w1 },
            duration: 0.6,
            ease: "none",
          },
          0
        );
      }
      const wl = gr.querySelector("#wipe-leaving");
      if (wl) {
        tl.to(
          wl,
          {
            attr: { width: +wl.dataset.w1 }, // left edge fixed → clears from left
            duration: 0.6,
            ease: "none",
          },
          0
        );
      }
    });

    return () => ctx.revert();
  }, []);

  return (
    <div className="relative bg-white overflow-x-hidden">
      {/* Desktop view: pinned "draw out" transition */}
      <div
        ref={pinContainerRef}
        className="relative w-full h-screen overflow-hidden hidden md:block"
      >
        {/* Header stays visible and pinned during the transition */}
        <Header />

        {/* Golden Ratio figure that un-draws on scroll */}
        <div
          ref={goldenRatioRef}
          id="golden-ratio-container"
          className="absolute inset-0 w-full h-full z-10 pointer-events-none"
        >
          <GoldenRatio />
        </div>
      </div>

      {/* Mobile view fallback: sections stack and scroll normally */}
      <div className="md:hidden">
        <Header />
        <GoldenRatio />
        <Veed />
      </div>

      {/* The remaining sections flow normally below */}
      <div className="relative overflow-visible">
        <Veed />
        <Abt />
        <Why />
      </div>
    </div>
  );
}
