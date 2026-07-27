"use client";
import { useRef, useEffect } from "react";
import gsap from "gsap";

export default function Ayotomcs() {
  const svgRef = useRef(null);
  const codeRef = useRef(null);
  const shakeTimeline = useRef(null);

  // Shaking animation for the whole SVG
  useEffect(() => {
    // Set transform origin to center
    gsap.set(svgRef.current, { transformOrigin: "50% 50%" });

    // Subtle shake animation (rotation only)
    shakeTimeline.current = gsap.timeline({ repeat: -1, repeatDelay: 2 }); // 0.3s shake, 3.7s pause = 4s total
    shakeTimeline.current
      .to(svgRef.current, {
        rotation: -8,
        duration: 0.2,
        ease: "power1.inOut",
      })
      .to(svgRef.current, {
        rotation: 12,
        duration: 0.12,
        ease: "power1.inOut",
      })
      .to(svgRef.current, { rotation: -8, duration: 0.1, ease: "power1.inOut" })
      .to(svgRef.current, { rotation: 8, duration: 0.1, ease: "power1.inOut" })
      .to(svgRef.current, { rotation: 0, duration: 0.1, ease: "power1.inOut" });

    return () => {
      shakeTimeline.current && shakeTimeline.current.kill();
    };
  }, []);

  const handleMouseEnter = () => {
    shakeTimeline.current && shakeTimeline.current.pause();
    gsap.to(svgRef.current, { rotation: 0, duration: 0.2, ease: "power2.out" });
    gsap.to(codeRef.current, { y: -250, duration: 0.5, ease: "power2.out" });
  };

  const handleMouseLeave = () => {
    shakeTimeline.current && shakeTimeline.current.resume();
    gsap.to(codeRef.current, { y: 0, duration: 0.5, ease: "power2.out" });
  };

  return (
    <a
      href="https://ayotomcs.me"
      target="_blank"
      rel="noopener noreferrer"
      className="block text-nowrap"
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <div className="flex flex-row gap-1 overflow-visible">
        <h4 className="text-right flex-1 p-0 text-base md:text-xl">Designed by</h4>
        <svg
     
          viewBox="0 0 374 320"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          ref={svgRef}
          style={{ display: "block", cursor: "pointer" }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="overflow-visible self-center md:w-5 md:h-5 w-4 h-4"
        >
          <g id="Group 70">
            <g ref={codeRef} id="code">
              <g id="Group 69">
                <rect
                  id="Rectangle 117"
                  x="92.9004"
                  y="38.373"
                  width="19.8005"
                  height="19.8005"
                  fill="black"
                  stroke="black"
                />
                <rect
                  id="Rectangle 123"
                  x="92.9004"
                  y="163.177"
                  width="19.8005"
                  height="19.8005"
                  fill="black"
                  stroke="black"
                />
                <rect
                  id="Rectangle 118"
                  x="72.1006"
                  y="55.3916"
                  width="19.8005"
                  height="19.8005"
                  fill="black"
                  stroke="black"
                />
                <rect
                  id="Rectangle 122"
                  x="72.1006"
                  y="146.158"
                  width="19.8005"
                  height="19.8005"
                  fill="black"
                  stroke="black"
                />
                <rect
                  id="Rectangle 119"
                  x="51.3008"
                  y="72.4102"
                  width="19.8005"
                  height="19.8005"
                  fill="black"
                  stroke="black"
                />
                <rect
                  id="Rectangle 121"
                  x="51.3008"
                  y="129.14"
                  width="19.8005"
                  height="19.8005"
                  fill="black"
                  stroke="black"
                />
                <rect
                  id="Rectangle 120"
                  x="30.5"
                  y="89.4287"
                  width="19.8005"
                  height="42.492"
                  fill="black"
                  stroke="black"
                />
              </g>
              <g id="Group 67">
                <rect
                  id="Rectangle 131"
                  x="227.203"
                  y="1"
                  width="20.8005"
                  height="39.7101"
                  fill="black"
                />
                <rect
                  id="Rectangle 132"
                  x="206.403"
                  y="36.9268"
                  width="20.8005"
                  height="39.7101"
                  fill="black"
                />
                <rect
                  id="Rectangle 133"
                  x="185.603"
                  y="72.8555"
                  width="20.8005"
                  height="39.7101"
                  fill="black"
                />
                <rect
                  id="Rectangle 134"
                  x="164.802"
                  y="108.784"
                  width="20.8005"
                  height="39.7101"
                  fill="black"
                />
                <rect
                  id="Rectangle 135"
                  x="144.002"
                  y="144.712"
                  width="20.8005"
                  height="39.7101"
                  fill="black"
                />
                <rect
                  id="Rectangle 136"
                  x="123.201"
                  y="180.641"
                  width="20.8005"
                  height="39.7101"
                  fill="black"
                />
              </g>
              <g id="Group 68">
                <rect
                  id="Rectangle 124"
                  width="20.8005"
                  height="20.8005"
                  transform="matrix(-1 0 0 1 278.803 37.873)"
                  fill="black"
                />
                <rect
                  id="Rectangle 125"
                  width="20.8005"
                  height="20.8005"
                  transform="matrix(-1 0 0 1 278.803 162.677)"
                  fill="black"
                />
                <rect
                  id="Rectangle 126"
                  width="20.8005"
                  height="20.8005"
                  transform="matrix(-1 0 0 1 299.604 54.8916)"
                  fill="black"
                />
                <rect
                  id="Rectangle 127"
                  width="20.8005"
                  height="20.8005"
                  transform="matrix(-1 0 0 1 299.604 145.658)"
                  fill="black"
                />
                <rect
                  id="Rectangle 128"
                  width="20.8005"
                  height="20.8005"
                  transform="matrix(-1 0 0 1 320.403 71.9102)"
                  fill="black"
                />
                <rect
                  id="Rectangle 129"
                  width="20.8005"
                  height="20.8005"
                  transform="matrix(-1 0 0 1 320.403 128.64)"
                  fill="black"
                />
                <rect
                  id="Rectangle 130"
                  width="20.8005"
                  height="43.492"
                  transform="matrix(-1 0 0 1 341.204 88.9287)"
                  fill="black"
                />
              </g>
            </g>
            <g id="Hat">
              <path
                id="Vector 50"
                d="M44 143L77 143L77 177L66 177L66 231L55 231L55 286L66 286L66 297L88 297L88 309L131.5 309L131.5 319.5L241.5 319.5L241.5 309L285.5 309L285.5 297L307 297L307 286.5L318.5 286.5L318.5 232.5L307 232.5L307 176.5L297 176.5L297 143.5L329.5 143.5L329.5 132.5L351 132.5L351 121L363 121L363 110L374 110L374 77L361.5 77L361.5 66L351 66L351 55.5L340.5 55.5L340.5 44.5L329.5 44.5L329.5 34L307 34L307 22.5L285 22.5L285 12L252 12L252 -1.06656e-05L120.5 -2.21617e-05L120.5 11L88 11L88 21.5L65.5 21.5L65.5 33L44 33L44 43.5L33 43.5L33 55L21.5 55L21.5 66L11 66L11 78L2.11126e-05 78L1.83588e-05 109.5L11 109.5L11 121L21.5 121L21.5 131.5L44 131.5L44 143Z"
                fill="black"
              />
              <path
                id="Vector 51"
                d="M284 133L297 133L297 87.5L274.5 87.5L274.5 76.5L252.5 76.5L252.5 65L120 65L120 75.5L98 75.5L98 87L76.5 87L76.5 133L89 133L89 121.5L100 121.5L100 111L133 111L133 99.5L240 99.5L240 110.5L273 110.5L273 122L284 122L284 133Z"
                fill="white"
              />
            </g>
          </g>
        </svg>
      </div>
    </a>
  );
}
