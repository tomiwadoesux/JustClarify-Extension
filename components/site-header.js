// The site header, shared by every page that is not the landing page.
//
// It is a copy of the landing page's header in Tailwind rather than an import
// of it, because that one lives inside /demo's own big <style> block and
// pulling it out would mean surgery on the page that matters most. The two are
// kept identical by eye: same padding, same sticky blur, same brand mark, same
// two actions on the right.
//
// The diamond is INLINE SVG, not <Image src="/diamond.svg">. That is the whole
// reason it can follow the random accent: an SVG loaded as an image is a sealed
// document that page CSS cannot reach into, so the file's baked #727cb0 would
// win forever. Inline, `currentColor` resolves against --accent, which the root
// layout's brand script re-rolls on every load.

const STORE_URL =
  "https://chromewebstore.google.com/detail/justclarify/ggeikfbifbojgkgcehebpelplhajfffj";
const GITHUB_URL = "https://github.com/tomiwadoesux/JustClarify-Extension";

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-[#ece7e3] bg-[#faf9f7cc] px-4 py-3.5 backdrop-blur-md md:px-7">
      <a href="/" className="inline-flex items-center gap-2.5 text-inherit no-underline">
        <span
          className="inline-flex"
          style={{ color: "var(--accent, oklch(0.56 0.10 28))" }}
          aria-hidden="true"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect
              x="5"
              y="5"
              width="14"
              height="14"
              rx="3.5"
              transform="rotate(45 12 12)"
              fill="currentColor"
            />
            <rect
              x="9"
              y="9"
              width="6"
              height="6"
              rx="1.6"
              transform="rotate(45 12 12)"
              fill="#fff"
            />
          </svg>
        </span>
        <span className="text-[16px] font-bold tracking-[-0.01em]">JustClarify</span>
      </a>

      <div className="inline-flex items-center gap-3.5">
        <a
          className="text-[13px] font-semibold text-[#6d645d] no-underline transition-colors hover:text-[#14110f]"
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Source
        </a>
        <a
          className="jc-header-cta whitespace-nowrap rounded-full bg-[#14110f] px-[15px] py-[9px] text-[12.5px] font-bold text-white no-underline transition-colors"
          href={STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Add to Chrome · Free
        </a>
      </div>

      {/* Tailwind cannot express "hover to the random accent", because the value
          only exists at runtime. One rule, scoped to this button. */}
      <style>{`.jc-header-cta:hover{background:var(--accent, oklch(0.56 0.10 28))}`}</style>
    </header>
  );
}
