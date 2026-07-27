"use client";

import { useState, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

function useIsTablet() {
  const [isTablet, setIsTablet] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(max-width: 1024px)");
    setIsTablet(media.matches);

    const listener = () => setIsTablet(media.matches);
    media.addEventListener("change", listener);

    return () => media.removeEventListener("change", listener);
  }, []);

  return isTablet;
}

export default function Veed() {
  const isTablet = useIsTablet();
  const [isMobile, setIsMobile] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Scroll animation for video rect moving up
  useEffect(() => {
    const vidGroup = document.querySelector("#vid-group");
    if (!vidGroup || !containerRef.current) return;

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: containerRef.current,
        start: "top bottom",
        end: "bottom top",
        scrub: 1, // Smooth scrubbing
      },
    });

    tl.to(vidGroup, {
      y: 0, // Move up 150px as you scroll
      ease: "none",
    });

    return () => {
      tl.kill();
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    };
  }, []);

  return (
    <div id="video-section" ref={containerRef} className="overflow-visible">
      <svg
        width="100%"
        className="-top-[0.1rem] relative hidden md:block overflow-visible"
        height="auto"
        viewBox="0 0 1513 583"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ overflow: "visible" }}
      >
        <g id="Group 39">
          <g id="Group 21">
            <g id="Frame2">
              <rect
                x={isTablet ? "1200" : "1195"}
                y={isTablet ? "525" : "545"}
                width={isTablet ? "195" : "117"}
                height={isTablet ? "40" : "28"}
                fill="#FF0000"
              />

              <text
                x={isTablet ? "1211" : "1204"}
                y={isTablet ? "548" : "560"}
                fill="white"
                className={isTablet ? "text-[31px]" : "text-[17px]"}
                dominantBaseline="middle"
              >
                How it Works
              </text>
            </g>
            <path
              id="rect2804"
              d="M0.111328 0.75H1185.11"
              stroke="#000000"
              strokeWidth="1.5"
            />
          </g>
          <path
            id="Vector"
            d="M1185.18 0.910645C1185.18 87.6222 1219.64 170.782 1281 232.097C1342.35 293.411 1425.57 327.857 1512.33 327.857"
            stroke="#000000"
            strokeWidth="1.5"
          />

          {/* Video rect group - moves up on scroll */}
          <g id="vid-group">
            <foreignObject id="vid" y="1.75" width="1184" height="581">
              <video
                src="/videos/vid.mp4"
                className="w-full h-full object-cover"
                autoPlay
                loop
                muted
                playsInline
              />
            </foreignObject>
          </g>

          <line
            id="Line 35"
            x1="6.55671e-08"
            y1="582"
            x2="1512"
            y2="582"
            stroke="#000000"
            strokeWidth="1.5"
          />
        </g>
      </svg>

      <div className="md:hidden">
        <div className="">
          <div className="pt-2 pb-2 px-4 justify-left flex  ">
            <h1 className="text-base text-[#FFFFFF] bg-[#FF0000] text-right  w-fit px-2 py-0">
              How it works
            </h1>
          </div>

          <div className="bg-black aspect-[16/9] relative">
            <video
              src="/videos/vid.mp4"
              className="w-full h-full object-cover absolute inset-0"
              autoPlay
              loop
              muted
              playsInline
            />
          </div>
        </div>
      </div>
    </div>
  );
}
