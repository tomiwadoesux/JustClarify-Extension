"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { gsap } from "gsap";
import DitherGradient from "./dither-gradient";

function useIsTablet() {
  const [isTablet, setIsTablet] = useState(false);

  useEffect(() => {
    // Adding optional chaining or checking for window in case of SSR
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(max-width: 1024px)");
    setIsTablet(media.matches);

    const listener = () => setIsTablet(media.matches);
    media.addEventListener("change", listener);

    return () => media.removeEventListener("change", listener);
  }, []);

  return isTablet;
}

export default function GoldenRatio() {
  const isTablet = useIsTablet();
  const pathRef = useRef(null);
  const containerRef = useRef(null);
  const mobileAccentRef = useRef(null);
  const [topPx, setTopPx] = useState(0);

  // Generate 99 random rectangle indices (from 21-230) to fill with accent color
  const filledRectangles = useMemo(() => {
    const allIndices = [];
    for (let i = 21; i <= 230; i++) {
      allIndices.push(i);
    }
    // Shuffle using a seeded random for consistency
    const seed = 72;
    const seededRandom = (s) => {
      const x = Math.sin(s) * 10000;
      return x - Math.floor(x);
    };
    for (let i = allIndices.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom(seed + i) * (i + 1));
      [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]];
    }
    // Take first 99
    return new Set(allIndices.slice(0, 66));
  }, []);

  useEffect(() => {
    if (!pathRef.current || !containerRef.current) return;

    const pathRect = pathRef.current.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();

    // Calculate position relative to the container
    setTopPx(pathRect.top - containerRect.top);
  }, []);

  // Group 19 drawing animation on load
  useEffect(() => {
    // Get all paths inside Group 19 elements
    const group19Elements = document.querySelectorAll(
      '#Group_19, [id="Group 19"], [id="Group 37"]',
    );

    const tl = gsap.timeline({ delay: 0.3 });

    group19Elements.forEach((group) => {
      const paths = group.querySelectorAll("path");

      paths.forEach((path) => {
        if (!path) return;

        const length = path.getTotalLength();

        // Set initial state - path is hidden
        gsap.set(path, {
          strokeDasharray: length,
          strokeDashoffset: length,
        });

        // Animate all paths drawing together at a comfortable pace
        tl.to(
          path,
          {
            strokeDashoffset: 0,
            duration: 1.0, // Comfortable pace
            ease: "sine.inOut", // Smooth ambient ease
          },
          0, // All start at the same time
        );
      });
    });

    // Animate the accent rect (behind "without leaving the page") 2 seconds after group animation
    const accentRect = document.querySelector("#accent-rect");
    if (accentRect) {
      // Set initial state - width 0, will draw from right to left
      gsap.set(accentRect, {
        scaleX: 0,
        transformOrigin: "right center",
      });

      // Animate rect drawing from right to left, 2 seconds after Group 19 finishes
      tl.to(
        accentRect,
        {
          scaleX: 1,
          duration: 0.6,
          ease: "power1.inOut",
        },
        ">-0.9", // Start 1 second after the group animation ends
      );
    }

    if (mobileAccentRef.current) {
      gsap.set(mobileAccentRef.current, {
        scaleX: 0,
        transformOrigin: "left center",
      });

      tl.to(
        mobileAccentRef.current,
        {
          scaleX: 1,
          duration: 0.9,
          ease: "power1.inOut",
        },
        ">-0.9",
      );
    }

    return () => {
      tl.kill();
    };
  }, []);

  return (
    <div ref={containerRef} className="min-h-[100svh] md:h-[100vh] w-full relative">
      {/* <div
        className="absolute bg-black w-full h right-[21.68%]"
        style={{
          top: `${topPx}px`,
          bottom: "0px",
        }}
      >
        <video
          src="/video.mp4"
          autoPlay
          muted
          loop
          className="w-full h-full object-cover"
        />
      </div> */}
      <div className="absolute bottom-0 left-0 w-full md:hidden pointer-events-none">
        <div className="absolute left-3 right-3 -top-9 z-10 flex flex-wrap items-center gap-x-1 gap-y-1 text-[14px] leading-none text-[#000000]">
          <span>Understand what you read</span>
          <span className="relative px-1 py-[2px] text-[#FFFFFF]">
            <span
              ref={mobileAccentRef}
              aria-hidden="true"
              className="absolute inset-0 bg-[#FF0000]"
            />
            <span className="relative">without leaving the page</span>
          </span>
        </div>
        <svg
          width="100%"
          height="auto"
          viewBox="0 0 328 202"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="block w-full"
          preserveAspectRatio="xMidYMax meet"
        >
          <g id="Group 37">
          <path
            id="curve6"
            d="M327.157 125.008C327.157 108.592 323.921 92.3362 317.635 77.1695C311.349 62.0029 302.135 48.2221 290.519 36.614C278.904 25.0059 265.114 15.7979 249.937 9.51567C234.761 3.23342 218.495 2.91804e-05 202.068 3.05176e-05"
            stroke="#000000"
            strokeWidth="1.5"
          />
          <path
            id="curve7"
            d="M327.158 125.007C327.158 135.109 325.167 145.112 321.298 154.446C317.43 163.779 311.76 172.259 304.612 179.403C297.464 186.546 288.978 192.213 279.638 196.079C270.299 199.945 260.289 201.934 250.18 201.934"
            stroke="#000000"
            strokeWidth="1.5"
          />
          <path
            id="curve8"
            d="M202.07 153.856C202.07 160.17 203.314 166.422 205.732 172.255C208.15 178.088 211.693 183.389 216.161 187.853C220.628 192.318 225.932 195.859 231.769 198.276C237.606 200.692 243.862 201.935 250.18 201.935"
            stroke="#000000"
            strokeWidth="1.5"
          />
          <path
            id="curve9"
            d="M202.071 153.858C202.071 146.207 205.112 138.87 210.525 133.46C215.939 128.05 223.281 125.011 230.937 125.011"
            stroke="#000000"
            strokeWidth="1.5"
          />
          <path
            id="rect2784"
            d="M230.936 153.858V125.009"
            stroke="#000000"
            strokeWidth="1.5"
          />
          <path
            id="rect2786"
            d="M250.179 153.856H202.068"
            stroke="#000000"
            strokeWidth="1.5"
          />
          <path
            id="rect2788"
            d="M230.935 144.24H250.18"
            stroke="#000000"
            strokeWidth="1.5"
          />
          <path
            id="rect2790"
            d="M240.559 144.241V153.858"
            stroke="#000000"
            strokeWidth="1.5"
          />
          <path
            id="rect2794"
            d="M250.181 125.007V201.935"
            stroke="#000000"
            strokeWidth="1.5"
          />
          <path
            id="rect2796"
            d="M202.068 125.008H327.158"
            stroke="#000000"
            strokeWidth="1.5"
          />
          <path
            id="rect2798"
            d="M202.225 202L0.287109 202"
            stroke="#000000"
            strokeWidth="1.5"
          />
          <path
            id="Vector"
            d="M0.00195312 201.938C0.00195583 148.381 21.291 97.0175 59.186 59.147C97.081 21.2765 148.478 0.0010064 202.069 0.00100708M202.07 201.938V3.05176e-05M327.159 201.937H0"
            stroke="#000000"
            strokeWidth="1.5"
          />
          <path
            id="rect2804"
            d="M0.287109 3.05176e-05L327.287 1.93033e-06"
            stroke="#000000"
            strokeWidth="2.5"
          />

          <path
            id="curve10"
            d="M250.178 144.24C250.178 139.14 248.151 134.248 244.542 130.642C240.933 127.035 236.039 125.009 230.935 125.009"
            stroke="#000000"
            strokeWidth="1.5"
          />
          <path
            id="curve11"
            d="M250.179 144.241C250.179 145.504 249.93 146.754 249.447 147.921C248.963 149.087 248.255 150.147 247.361 151.04C246.468 151.933 245.407 152.641 244.24 153.124C243.073 153.607 241.822 153.856 240.558 153.856"
            stroke="#000000"
            strokeWidth="1.5"
          />
          <path
            id="curve12"
            d="M230.954 144.225C230.954 145.488 231.203 146.738 231.686 147.905C232.17 149.071 232.878 150.131 233.772 151.024C234.665 151.917 235.726 152.625 236.893 153.108C238.06 153.591 239.311 153.84 240.575 153.84"
            stroke="#000000"
            strokeWidth="1.5"
          />
          </g>
        </svg>
      </div>

      <svg
        width="100%"
        height="auto"
        viewBox="0 0 731 594"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute top-0 left-0 hidden md:block w-[35%] h-auto pointer-events-none"
      >
        <g id="MacBook Pro 14&#34; - 13" clipPath="url(#clip0_93_96)">
          <g id="Group 19">
            <path
              id="curve1"
              d="M-198.9 1308.72C-198.9 941.469 -52.9161 589.261 206.937 329.576C466.789 69.8907 819.225 -75.9988 1186.71 -75.9988"
              stroke="#000000"
              strokeWidth="1.5"
            />
          </g>
        </g>
        <defs>
          <clipPath id="clip0_93_96">
            <rect width="731" height="594" fill="#FFFFFF" />
          </clipPath>
        </defs>
      </svg>

      <svg
        width="100%"
        height="auto"
        viewBox="0 0 1513 244"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute bottom-0 left-0 hidden md:block w-full h-auto overflow-visible"
        preserveAspectRatio="xMidYMax meet"
      >
        <g id="MacBook Pro 14&#34; - 11" clipPath="url(#clip0_92_2)">
          <g id="Group 19">
            {/* <path
              id="curve5"
              d="M1184.71 242.938C1184.71 189.381 1206 138.017 1243.9 100.147C1281.79 62.2764 1333.19 41.001 1386.78 41.001"
              stroke="#000000"
              strokeWidth="1.5"
            /> */}

            <path
              id="curve6"
              d="M1511.87 166.008C1511.87 149.592 1508.63 133.336 1502.35 118.17C1496.06 103.003 1486.85 89.2221 1475.23 77.614C1463.62 66.0059 1449.83 56.7979 1434.65 50.5156C1419.47 44.2334 1403.21 41 1386.78 41"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              id="curve7"
              d="M1511.87 166.007C1511.87 176.109 1509.88 186.112 1506.01 195.446C1502.14 204.779 1496.47 213.259 1489.32 220.403C1482.18 227.546 1473.69 233.213 1464.35 237.079C1455.01 240.945 1445 242.934 1434.89 242.934"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              id="curve8"
              d="M1386.78 194.856C1386.78 201.17 1388.03 207.422 1390.45 213.255C1392.86 219.088 1396.41 224.389 1400.87 228.853C1405.34 233.318 1410.65 236.859 1416.48 239.275C1422.32 241.692 1428.58 242.935 1434.89 242.935"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              id="curve9"
              d="M1386.78 194.858C1386.78 187.207 1389.82 179.869 1395.24 174.46C1400.65 169.05 1407.99 166.011 1415.65 166.01"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              id="rect2784"
              d="M1415.65 194.858V166.009"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              id="rect2786"
              d="M1434.89 194.856H1386.78"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              id="rect2788"
              d="M1415.65 185.24H1434.89"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              id="rect2790"
              d="M1425.27 185.241V194.858"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              id="rect2794"
              d="M1434.89 166.007V242.935"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              id="rect2796"
              d="M1386.78 166.008H1511.87"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              id="live"
              d="M1184.75 202.938C1184.71 149.381 1206 98.0175 1243.9 60.1469C1281.79 22.2764 1333.19 1.00098 1386.78 1.00098V202.938H1184.75Z"
              stroke="#000000"
              // fill="#FF0000"
              strokeWidth="1.5"
              transform="translate(0, 40)"
            />
            {/* <path
              id="rect2798"
              d="M1386.78 242.938V41"
              stroke="#000000"
              strokeWidth="1.5"
            /> */}
            <path
              id="rect2800"
              d="M1511.87 242.937H1184.71"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              id="rect2802"
              d="M1512 40L1512 243"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              id="rect2804"
              d="M0 41.1667H1512"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              ref={pathRef}
              id="rect2804_2"
              d="M1157 41.1589H1213"
              stroke="#FF0000"
              strokeWidth="1.5"
            />
            <path
              id="curve10"
              d="M1434.89 185.24C1434.89 180.14 1432.86 175.248 1429.25 171.642C1425.65 168.035 1420.75 166.009 1415.65 166.009"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              id="curve11"
              d="M1434.89 185.241C1434.89 186.504 1434.64 187.754 1434.16 188.921C1433.68 190.087 1432.97 191.147 1432.07 192.04C1431.18 192.933 1430.12 193.641 1428.95 194.124C1427.79 194.607 1426.54 194.856 1425.27 194.856"
              stroke="#000000"
              strokeWidth="1.5"
            />
            <path
              id="curve12"
              d="M1415.67 185.225C1415.67 186.488 1415.91 187.738 1416.4 188.905C1416.88 190.071 1417.59 191.131 1418.48 192.024C1419.38 192.917 1420.44 193.625 1421.61 194.108C1422.77 194.591 1424.02 194.84 1425.29 194.84"
              stroke="#000000"
              strokeWidth="1.5"
            />
          </g>

          <path
            id="understand-path"
            d={isTablet ? "M400 21.3 H 1419" : "M683.02 21.3 H 1419"}
            fill="none"
          />

          <text
            className="fill-[#000000] lg:text-[18px] md:text-[31px]"
            fill="#000000"
            fontSize="13"
          >
            <textPath
              href="#understand-path"
              startOffset={isTablet ? "5%" : "7%"}
              textAnchor="start"
            >
              Understand what you read
            </textPath>
          </text>

          <rect
            id="accent-rect"
            className="fill-[#FF0000]"
            x={isTablet ? "-1170" : "-1170"}
            y={isTablet ? "-8" : "1.5"}
            width={isTablet ? "345" : "215"}
            height={isTablet ? "40" : "28"}
            fill="#FF0000"
            transform="scale(-1, 1)"
          />
          <path
            id="without-leaving-path"
            d={isTablet ? "M600 21.3 H 1600" : "M932 21.3 H 1600"}
            fill="none"
          />
          <text
            className="fill-[#FFFFFF] lg:text-[18px] md:text-[31px]"
            fill="#FFFFFF"
            fontSize="18"
          >
            <textPath
              href="#without-leaving-path"
              startOffset={isTablet ? "23.5%" : "5%"}
              textAnchor="start"
            >
              without leaving the page
            </textPath>
          </text>

          {/* Scroll "draw out" wipes — white (= the page bg) so growing them
              reads as the caption being erased. Width 0 at rest; ONLY the /v2
              scroll timeline grows them (data-* hold the end geometry). The
              main page leaves them untouched, so they stay invisible there.
                wipe-understand → grows right→left, clearing "Understand what
                  you read" from the right.
                wipe-leaving    → grows left→right (left edge fixed), clearing
                  the red badge + "without leaving the page" from the left. */}
          <rect
            id="wipe-understand"
            x={isTablet ? "820" : "950"}
            y="-6"
            width="0"
            height="42"
            fill="#FFFFFF"
            data-x1={isTablet ? "415" : "705"}
            data-w1={isTablet ? "405" : "245"}
          />
          <rect
            id="wipe-leaving"
            x={isTablet ? "820" : "948"}
            y="-6"
            width="0"
            height="42"
            fill="#FFFFFF"
            data-w1={isTablet ? "360" : "230"}
          />
        </g>
        <path
          id="rect2798_1"
          d="M1185 244L1185 -2000"
          stroke="#000000"
          strokeWidth="1.5"
        />
        <path
          id="rect2798_2"
          d="M1185 69L1185 13"
          stroke="#FF0000"
          strokeWidth="1.5"
        />

        <defs>
          <clipPath id="clip0_92_2">
            <rect y="-50" width="1513" height="350" fill="#FFFFFF" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}
