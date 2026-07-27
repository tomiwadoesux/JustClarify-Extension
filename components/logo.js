export default function Logo({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="JustClarify logo"
    >
      {/* equal-sided square rotated 45° → a diamond */}
      <path d="M12 0L24 12L12 24L0 12Z" fill="#3B4290" />
    </svg>
  );
}
