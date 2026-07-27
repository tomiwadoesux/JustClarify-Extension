"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export default function SmoothScroll({ children }) {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.15, // length of the eased glide — higher = silkier, floatier
      smoothWheel: true,
      // gentle exponential ease-out so the page settles instead of stopping dead
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    });

    // Keep ScrollTrigger locked to Lenis' SMOOTHED scroll position, so pinned
    // scrub animations track the exact same eased value the page moves with —
    // this is what removes the jitter/mismatch and makes scrolling feel smooth.
    lenis.on("scroll", ScrollTrigger.update);

    // Drive Lenis from GSAP's single ticker (instead of a separate rAF loop) so
    // both run on one clock; gsap.ticker is in seconds, lenis.raf wants ms.
    const raf = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    // don't let big frame gaps make the scroll jump — keep motion continuous.
    gsap.ticker.lagSmoothing(0);

    return () => {
      lenis.off("scroll", ScrollTrigger.update);
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, []);

  return children;
}
