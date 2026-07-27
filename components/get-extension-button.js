"use client";

import { useEffect, useState } from "react";

const BROWSER_ICONS = [
  { src: "/browsers/chrome.svg", name: "Chrome" },
  { src: "/browsers/safari.svg", name: "Safari" },
  { src: "/browsers/firefox.svg", name: "Firefox" },
  { src: "/browsers/arc.svg", name: "Arc" },
  { src: "/browsers/brave.svg", name: "Brave" },
  { src: "/browsers/edge.svg", name: "Edge" },
];

export default function GetExtensionButton({ onClick, className = "" }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActive((i) => (i + 1) % BROWSER_ICONS.length);
    }, 350);
    return () => clearInterval(id);
  }, []);

  return (
    <button
      onClick={onClick}
      className={`group relative flex items-center justify-center p-0 border-0 bg-transparent cursor-pointer select-none transition-all duration-200 hover:scale-[1.05] active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#3B4290] rounded-sm ${className}`}
      aria-label="Get JustClarify extension"
    >
      <svg
        width="133"
        height="51"
        viewBox="0 0 133 51"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-auto drop-shadow-sm filter group-hover:drop-shadow-md transition-all duration-200"
      >
        <path
          d="M3 32C1.34327 31.9998 1.17429e-07 30.6568 2.62268e-07 29L2.53526e-06 2.99999C2.6801e-06 1.34323 1.34327 0.000135197 3 -9.61651e-06L130 -2.62268e-07C131.657 -1.17422e-07 133 1.34315 133 3L133 29C133 30.6569 131.657 32 130 32L80.5746 32C78.4671 30.298 72.9833 26.2323 66.5488 26.2322C60.1142 26.2322 54.6292 30.2977 52.5218 32L3 32Z"
          fill="#3B4290"
          className="transition-colors duration-200 group-hover:fill-[#2d3370] group-active:fill-[#232857]"
        />
        <text
          x="66.5"
          y="15"
          fill="#FFFFFF"
          fontSize="16"
          fontFamily="var(--font-inter-tight), sans-serif"
          fontWeight="600"
          letterSpacing="0.02em"
          textAnchor="middle"
          dominantBaseline="central"
          className="select-none pointer-events-none"
        >
          Get Extension
        </text>
        {BROWSER_ICONS.map((icon, i) => (
          <image
            key={icon.src}
            href={icon.src}
            x="56.153"
            y="29.589"
            width="20.793"
            height="20.793"
            preserveAspectRatio="xMidYMid meet"
            style={{ opacity: i === active ? 1 : 0 }}
          >
            <title>{icon.name}</title>
          </image>
        ))}
      </svg>
    </button>
  );
}
