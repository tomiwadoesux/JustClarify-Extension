"use client";

import { useEffect } from "react";
import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import Ayotomcs from "./ayotomcs";
import DitherGradient from "./dither-gradient";
import GetExtensionButton from "./get-extension-button";

gsap.registerPlugin(MotionPathPlugin);

function ClippedGradientLayer({ width, height, clipPath, style, className = "" }) {
  return (
    <div
      aria-hidden="true"
      className={`absolute overflow-hidden ${className}`.trim()}
      style={{
        clipPath,
        WebkitClipPath: clipPath,
        ...style,
      }}
    >
      <DitherGradient width={width} height={height} />
    </div>
  );
}

export default function Why() {
  // Animation for Ellipse 5 rotating and Group 8 following Ellipse 11 path
  useEffect(() => {
    // Ellipse 5 continuous rotation from center
    const ellipse5 = document.querySelector("#Ellipse5");
    if (ellipse5) {
      gsap.to(ellipse5, {
        rotation: 360,
        duration: 13,
        repeat: -1,
        ease: "none",
        transformOrigin: "center center",
      });
    }

    // Group 8 following Ellipse 11 path - full orbit
    const group8 = document.querySelector("#Group8");

    if (group8) {
      // Ellipse 11 center and radius
      const cx = 1368;
      const cy = 534;
      const r = 474.25;

      // Animate full orbit around the circle
      gsap.to(
        { angle: 0 },
        {
          angle: Math.PI * 2, // Full 360 degrees
          duration: 20, // Takes 20 seconds for a full orbit
          repeat: -1,
          ease: "none", // Constant speed
          onUpdate: function () {
            const angle = this.targets()[0].angle;
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);

            // Move Group 8 - offset by original position
            gsap.set(group8, {
              x: x - 896.5,
              y: y - 585.5,
            });
          },
        },
      );
    }

    // Line 27 pulse effect on mouse movement
    const line27 = document.querySelector("#Line27");
    if (line27) {
      // Original straight line path
      const straightPath = "M272.073 234.75 L63.0732 234.75";

      // Function to generate random zigzag pulse path
      const generatePulsePath = () => {
        const startX = 272.073;
        const endX = 63.0732;
        const baseY = 234.75;
        const segments = 12;
        const segmentWidth = (startX - endX) / segments;

        let path = `M${startX} ${baseY}`;
        for (let i = 1; i < segments; i++) {
          const x = startX - i * segmentWidth;
          // Random vertical offset for zigzag effect
          const yOffset = (Math.random() - 0.5) * 20;
          path += ` L${x} ${baseY + yOffset}`;
        }
        path += ` L${endX} ${baseY}`;
        return path;
      };

      let isMoving = false;
      let pulseInterval = null;
      let stopTimeout = null;

      const startPulse = () => {
        if (!isMoving) {
          isMoving = true;
          // Fast pulsing zigzag
          pulseInterval = setInterval(() => {
            line27.setAttribute("d", generatePulsePath());
          }, 50); // Update every 50ms for fast pulse
        }

        // Reset the stop timer
        clearTimeout(stopTimeout);
        stopTimeout = setTimeout(() => {
          // Mouse stopped - instantly snap back to straight
          isMoving = false;
          clearInterval(pulseInterval);
          line27.setAttribute("d", straightPath);
        }, 50); // Wait 50ms of no movement before stopping
      };

      // Debounced mouse move handler
      document.addEventListener("mousemove", startPulse);

      // Cleanup function
      const cleanupLine27 = () => {
        document.removeEventListener("mousemove", startPulse);
        clearInterval(pulseInterval);
        clearTimeout(stopTimeout);
      };

      // Store cleanup for later
      window._line27Cleanup = cleanupLine27;
    }

    return () => {
      gsap.killTweensOf(ellipse5);
      gsap.killTweensOf(group8);
      if (window._line27Cleanup) window._line27Cleanup();
    };
  }, []);

  return (
    <div>
      <div className="h-[100%] relative">
        <div className="absolute -top-[11%] md:-top-[6%] lg:-top-[3%] pr-3 right-[50%]">
          <h4 className=" px-2  w-fit bg-accent text-white text-base md:text-xl">
            Why it feels different
          </h4>
        </div>
        <div className="absolute top-[1%] pl-3 left-[50%]">
          <h4 className=" px-2 w-fit bg-accent text-white text-base md:text-xl">
            Ambient
          </h4>
          <h4 className=" text-[#000000] pt-1 text-base md:text-xl">
            No tabs. No chat windows. No interruptions.
          </h4>
        </div>
        <div className="absolute top-[37%] md:top-[38%] lg:top-[12%] pl-3 left-[50%]">
          <h4 className=" px-2  w-fit bg-accent text-white text-base md:text-xl">
            Contextual
          </h4>
          <h4 className=" text-[#000000] pt-1 text-base md:text-xl">
            Reads around the text, not just the text.
          </h4>
        </div>
        <div className="absolute top-[75%] md:top-[20%] lg:top-[23%] pl-3 left-[50%]">
          <h4 className=" px-2  w-fit bg-accent text-white text-base md:text-xl">
            Concise
          </h4>
          <h4 className=" text-[#000000] pt-1 text-base md:text-xl">
            Explains calmly, without judgment or noise.{" "}
          </h4>
        </div>
        <div className="absolute pt-4 top-[100%] md:pl-5 md:top-[38%] lg:top-[32%] right-[51%] md:right-[51%] lg:left-[50%]">
          <GetExtensionButton
            onClick={() =>
              window.open(
                "https://chromewebstore.google.com/detail/justclarify/ggeikfbifbojgkgcehebpelplhajfffj",
                "_blank"
              )
            }
            className="w-[124px] md:w-[141px] lg:w-[153px]"
          />
        </div>
        <div className="absolute hidden md:block top-[95.3%] bg-[#FFFFFF] z-40  left-[0%] pl-3 ">
          <Ayotomcs />
        </div>

        <div className="absolute hidden md:block top-[97%] z-40 pl-3 left-[0%]">
          <h4 className=" text-[#000000] pt-1 opacity-70 text-sm md:text-sm">
            JustClarify © 2026 all rights reserved
          </h4>
        </div>
        <div>
          <svg
            width="50.135%"
            height="auto"
            viewBox="0 0 764 1254"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="hidden md:block overflow-visible"
          >
            <g id="MacBook Pro 14&#34; - 19" clipPath="url(#clip0_150_171)">
              <line
                id="Line 7"
                x1="762.75"
                y1="-3.27835e-08"
                x2="762.75"
                y2="470"
                stroke="#000000"
                strokeWidth="1.5"
              />
              <path
                id="Vector"
                d="M762.031 469.464H0.00695801"
                stroke="#000000"
                strokeWidth="1.5"
              />
              <path
                id="Vector_2"
                d="M-0.00012207 0.715332H293"
                stroke="#000000"
                strokeWidth="1.5"
              />
              <path
                id="Vector_3"
                d="M293 0.715332H762.033"
                stroke="#000000"
                strokeWidth="1.5"
              />
              <g id="Group 28">
                <path
                  id="Vector 2"
                  d="M361.419 156.714L382.182 190.302L333.938 192.134V453.509H597.755V319.768L726 237.325L584.931 15.645L361.419 156.714Z"
                  stroke="#000000"
                  strokeWidth="1.5"
                />
                <g>
                  <defs>
                    <mask id="hmm-clip">
                      <path
                        d="M595.923 190.913H383.403L503.709 379.005L595.923 320.989V190.913Z"
                        fill="white"
                      />
                    </mask>
                  </defs>
                  <foreignObject
                    x="383"
                    y="190"
                    width="215"
                    height="190"
                    mask="url(#hmm-clip)"
                  >
                    <DitherGradient width={215} height={190} />
                  </foreignObject>
                  <path
                    id="hmm"
                    d="M595.923 190.913H383.403L503.709 379.005L595.923 320.989V190.913Z"
                    fill="none"
                    stroke="#000000"
                  />
                </g>
              </g>
              {/* <path
                id="JW:25"
                d="M143.33 215.455H145.091V225.852C145.091 226.78 144.92 227.569 144.58 228.217C144.239 228.866 143.758 229.358 143.138 229.695C142.518 230.031 141.786 230.199 140.943 230.199C140.148 230.199 139.44 230.054 138.82 229.766C138.199 229.472 137.712 229.055 137.357 228.516C137.001 227.976 136.824 227.334 136.824 226.591H138.557C138.557 227.003 138.659 227.363 138.862 227.67C139.071 227.973 139.355 228.21 139.714 228.381C140.074 228.551 140.484 228.636 140.943 228.636C141.45 228.636 141.881 228.53 142.236 228.317C142.591 228.104 142.861 227.791 143.045 227.379C143.235 226.963 143.33 226.454 143.33 225.852V215.455ZM154.063 230L150.086 215.455H151.875L154.915 227.301H155.057L158.154 215.455H160.142L163.239 227.301H163.381L166.421 215.455H168.211L164.233 230H162.415L159.205 218.409H159.091L155.881 230H154.063ZM173.184 228.139C172.833 228.139 172.533 228.014 172.282 227.763C172.031 227.512 171.905 227.211 171.905 226.861C171.905 226.51 172.031 226.21 172.282 225.959C172.533 225.708 172.833 225.582 173.184 225.582C173.534 225.582 173.835 225.708 174.086 225.959C174.337 226.21 174.462 226.51 174.462 226.861C174.462 227.093 174.403 227.306 174.285 227.5C174.171 227.694 174.017 227.85 173.823 227.969C173.634 228.082 173.421 228.139 173.184 228.139ZM173.184 220.781C172.833 220.781 172.533 220.656 172.282 220.405C172.031 220.154 171.905 219.853 171.905 219.503C171.905 219.152 172.031 218.852 172.282 218.601C172.533 218.35 172.833 218.224 173.184 218.224C173.534 218.224 173.835 218.35 174.086 218.601C174.337 218.852 174.462 219.152 174.462 219.503C174.462 219.735 174.403 219.948 174.285 220.142C174.171 220.336 174.017 220.492 173.823 220.611C173.634 220.724 173.421 220.781 173.184 220.781ZM180.242 230V228.722L185.043 223.466C185.606 222.85 186.07 222.315 186.435 221.861C186.799 221.402 187.069 220.971 187.244 220.568C187.424 220.161 187.514 219.735 187.514 219.29C187.514 218.778 187.391 218.336 187.145 217.962C186.904 217.588 186.572 217.299 186.151 217.095C185.729 216.892 185.256 216.79 184.73 216.79C184.172 216.79 183.684 216.906 183.267 217.138C182.855 217.365 182.536 217.685 182.308 218.097C182.086 218.509 181.975 218.991 181.975 219.545H180.298C180.298 218.693 180.495 217.945 180.888 217.301C181.281 216.657 181.816 216.155 182.493 215.795C183.175 215.436 183.94 215.256 184.787 215.256C185.639 215.256 186.395 215.436 187.053 215.795C187.711 216.155 188.227 216.641 188.601 217.251C188.975 217.862 189.162 218.542 189.162 219.29C189.162 219.825 189.065 220.348 188.871 220.859C188.681 221.366 188.35 221.932 187.877 222.557C187.408 223.177 186.757 223.935 185.923 224.83L182.656 228.324V228.438H189.418V230H180.242ZM199.696 230.199C198.863 230.199 198.113 230.033 197.445 229.702C196.777 229.37 196.242 228.916 195.84 228.338C195.437 227.76 195.217 227.102 195.179 226.364H196.884C196.95 227.022 197.249 227.566 197.779 227.997C198.314 228.423 198.953 228.636 199.696 228.636C200.293 228.636 200.823 228.497 201.287 228.217C201.756 227.938 202.123 227.554 202.388 227.067C202.658 226.574 202.793 226.018 202.793 225.398C202.793 224.763 202.653 224.197 202.374 223.7C202.099 223.198 201.721 222.803 201.238 222.514C200.755 222.225 200.203 222.079 199.583 222.074C199.138 222.069 198.681 222.138 198.212 222.28C197.743 222.417 197.357 222.595 197.054 222.812L195.407 222.614L196.287 215.455H203.844V217.017H197.765L197.253 221.307H197.338C197.637 221.07 198.011 220.874 198.461 220.717C198.91 220.561 199.379 220.483 199.867 220.483C200.757 220.483 201.55 220.696 202.246 221.122C202.947 221.544 203.496 222.121 203.894 222.855C204.296 223.589 204.498 224.427 204.498 225.369C204.498 226.297 204.289 227.126 203.873 227.855C203.461 228.58 202.892 229.152 202.168 229.574C201.444 229.991 200.62 230.199 199.696 230.199Z"
                fill="#000000"
              /> */}
              <path
                id="vlineee"
                d="M293.096 0.700928V627.1V1481.5"
                stroke="#000000"
                strokeWidth="1.5"
              />
              <path
                id="Subtract"
                d="M7 1.50684C124.721 13.3778 216.646 113.413 216.646 235.08C216.646 356.747 124.721 456.782 7 468.653V470.161C125.559 458.284 218.146 357.568 218.146 235.08C218.146 112.592 125.558 11.8767 7 0V1.50684Z"
                fill="#000000"
              />
              <path
                id="Subtract_2"
                d="M292.704 257.652C281.396 256.442 272.573 246.806 272.573 235.08C272.574 223.354 281.396 213.72 292.704 212.51L292.704 211C280.76 212.196 271.39 222.192 271.081 234.456L271.073 235.08C271.073 247.628 280.558 257.944 292.704 259.16L292.704 257.652Z"
                fill="#000000"
              />
              <path
                id="Subtract_3"
                d="M292.522 229C289.456 229.307 287.062 231.911 287.062 235.079C287.062 238.247 289.456 240.85 292.522 241.157L292.522 229Z"
                className="fill-accent"
              />
              <path
                id="Line27"
                d="M272.073 234.75 L63.0732 234.75"
                stroke="#000000"
                strokeWidth="1.5"
                fill="none"
              />
              <circle
                id="roo"
                cx="63.0732"
                cy="234"
                r="22.25"
                stroke="#000000"
                strokeWidth="1.5"
                strokeDasharray="9 9"
              />
              <circle
                id="Ellipse 15"
                cx="63.5732"
                cy="234.5"
                r="6.5"
                className="fill-accent"
              />
            </g>
            <defs>
              <clipPath id="clip0_150_171">
                <rect width="764" height="2000" fill="white" />
              </clipPath>
            </defs>
          </svg>
          <div className="relative md:hidden w-[50.35%]">
            <ClippedGradientLayer
              width={93}
              height={83}
              clipPath="polygon(0.44% 1.03%, 99.34% 1.03%, 99.34% 68.85%, 56.42% 99.10%)"
              style={{
                left: "20.47%",
                top: "43.42%",
                width: "43.26%",
                height: "27.30%",
              }}
            />
            <svg
              width="100%"
              height="auto"
              viewBox="0 0 215 304"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="relative z-10 block h-auto w-full"
            >
              <g id="Group 102">
                <g id="Rectangle 231">
                  <mask id="path-1-inside-1_198_33" fill="white">
                    <path d="M0 0H215V304H0V0Z" />
                  </mask>
                  <path
                    d="M215 0H216.5V-1.5H215V0ZM215 304V305.5H216.5V304H215ZM0 0V1.5H215V0V-1.5H0V0ZM215 0H213.5V304H215H216.5V0H215ZM215 304V302.5H0V304V305.5H215V304Z"
                    fill="#000000"
                    mask="url(#path-1-inside-1_198_33)"
                  />
                </g>
                <g id="Group 27">
                  <path
                    id="Vector 2"
                    d="M34.8933 118.052L43.8794 132.589L23 133.381V246.5H137.176V188.619L192.678 152.939L131.626 57L34.8933 118.052Z"
                    stroke="#000000"
                    strokeWidth="1.5"
                  />
                  <path
                    id="hmm"
                    d="M136.383 132.853H44.408L96.4742 214.256L136.383 189.148V132.853Z"
                    fill="none"
                    stroke="#000000"
                  />
                </g>
              </g>
            </svg>
          </div>
        </div>

        <div className="absolute lg:-bottom-0 md:-bottom-30 w-full ">
          <svg
            width="100%"
            height="auto"
            viewBox="0 0 1512 619"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="hidden md:block"
          >
            <g id="MacBook Pro 14&#34; - 15" clipPath="url(#clip0_112_2)">
              <circle
                id="Ellipse 10"
                cx="1368"
                cy="534"
                r="533.25"
                stroke="#000000"
                strokeWidth="1.5"
              />
              <circle
                id="Ellipse11"
                cx="1368"
                cy="534"
                r="474.25"
                stroke="#000000"
                strokeWidth="1.5"
                strokeDasharray="25 25"
              />
              <line
                id="Line 11"
                x1="-18"
                y1="391.25"
                x2="854"
                y2="391.25"
                stroke="#000000"
                strokeWidth="1.5"
              />
              <g>
                <defs>
                  <mask id="ellipse9-clip">
                    <circle cx="1368" cy="534" r="417" fill="white" />
                  </mask>
                </defs>
                <foreignObject
                  x="951"
                  y="117"
                  width="834"
                  height="834"
                  mask="url(#ellipse9-clip)"
                >
                  <DitherGradient width={834} height={834} />
                </foreignObject>
                <circle id="ellipse_9" cx="1368" cy="534" r="417" fill="none" />
              </g>
              <g id="Group8">
                <circle
                  id="Ellipse 4"
                  cx="896.5"
                  cy="585.5"
                  r="6.5"
                  className="fill-accent"
                />
                <circle
                  id="Ellipse5"
                  cx="896.5"
                  cy="585.5"
                  r="14"
                  stroke="#000000"
                  strokeDasharray="5 5"
                />
              </g>
            </g>
            <defs>
              <clipPath id="clip0_112_2">
                <rect width="1512" height="619" fill="white" />
              </clipPath>
            </defs>
          </svg>
        </div>
      </div>
      <div className="md:hidden relative top-37">
        <div className="relative overflow-hidden">
          <ClippedGradientLayer
            width={440}
            height={440}
            clipPath="circle(50%)"
            style={{
              left: "-1.16%",
              top: "27.93%",
              width: "102.33%",
              aspectRatio: "1 / 1",
            }}
          />
          <svg
            width="100%"
            height="auto"
            viewBox="0 0 430 222"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="relative z-10 block h-auto w-full"
          >
            <g clipPath="url(#clip0_169_94)">
              <circle
                cx="215"
                cy="282"
                r="281.25"
                stroke="#000000"
                strokeWidth="1.5"
              />
              <circle
                cx="215"
                cy="282"
                r="250.25"
                stroke="#000000"
                strokeWidth="1.5"
                strokeDasharray="19 19"
              />
              <g>
                <circle cx="215" cy="282" r="220" fill="none" />
              </g>
              {/* <g id="Group8">

           
            <circle
            id="Ellipse5"
              cx="29"
              cy="112"
              r="13.25"
              stroke="#000000"
              strokeWidth="1.5"
              strokeDasharray="6 6"
            />
            <circle  cx="29.5" cy="112.5" r="6.5" className="fill-accent" />
             </g> */}
            </g>
            <defs>
              <clipPath id="clip0_169_94">
                <rect width="430" height="222" fill="white" />
              </clipPath>
            </defs>
          </svg>
        </div>

        <div className="absolute md:hidden top-[100%] py-1 bg-[#FFFFFF] z-40  left-[2%]">
          <Ayotomcs />
        </div>

        <div className="absolute md:hidden top-[100%] py-1 md:top-[83%] pl-3 z-40 right-[2%] md:left-[20%]">
          <h4 className=" text-[#000000] pt-1 text-xs md:text-lg">
            © 2026 JustClarify
          </h4>
        </div>
      </div>
    </div>
  );
}
