// Regenerate the extension's static PNG icons as the JustClarify diamond.
// The toolbar icon is recoloured to the per-load random OKLCH at runtime
// (background.js), but the manifest `icons` (extensions page, Web Store, etc.)
// are static — so they get one fixed, on-brand accent here.
//
// Run: node scripts/gen-icons.cjs
const sharp = require("sharp");
const path = require("path");

// oklch(0.56 0.10 28) → sRGB, matching the demo accent (a dull terracotta).
function oklchToRgb(l, c, h) {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3, M = m_ ** 3, S = s_ ** 3;
  const lin = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  return lin.map((v) => {
    const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, s)) * 255);
  });
}

const [r, g, b] = oklchToRgb(0.56, 0.1, 28);
const accent = `rgb(${r},${g},${b})`;

// A diamond (rounded square rotated 45°) with a smaller inner diamond cut in
// white — the same mark used across the popup, blob and history. Transparent
// background so it reads on light and dark surfaces.
function diamondSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
    <rect x="4" y="4" width="16" height="16" rx="3.6" transform="rotate(45 12 12)" fill="${accent}"/>
    <rect x="8.6" y="8.6" width="6.8" height="6.8" rx="1.8" transform="rotate(45 12 12)" fill="#ffffff"/>
  </svg>`;
}

const OUT = path.join(__dirname, "..", "ambient-explainer-extension", "icons");
const sizes = [16, 32, 48, 96, 128];

(async () => {
  for (const s of sizes) {
    // Render the SVG at 4× then downscale for crisp anti-aliasing at 16px.
    const buf = Buffer.from(diamondSvg(s * 4));
    await sharp(buf).resize(s, s).png().toFile(path.join(OUT, `icon-${s}.png`));
    console.log(`icon-${s}.png  (${accent})`);
  }
})();
