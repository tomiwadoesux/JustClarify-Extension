"use client";

export default function OutlineButton({ children, onClick, className = "" }) {
  return (
    <div
      className={`relative inline-block  outline-btn w-fit`}
      onClick={onClick}
    >
      <div
        className={`px-3 py-1 bg-accent text-white relative z-10 w-full h-full flex items-center justify-center ${className}`}
        style={{
          clipPath:
            "polygon(0 0, 100% 0, 100% 35%, 96% 35%, 96% 65%, 100% 65%, 100% 100%, 0 100%, 0 65%, 4% 65%, 4% 35%, 0 35%)",
        }}
      >
        {children}
      </div>


    </div>
  );
}
