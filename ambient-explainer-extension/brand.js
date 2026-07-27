// brand.js — one dull, random OKLCH accent per extension load, shared across
// every surface (toolbar icon, popup, in-page UI, history) so the whole product
// wears the SAME colour until the next load, then re-randomises.
//
// The background worker mints the colour on install/startup and stores it under
// `jcBrand`; every other surface reads that and paints itself to match. Safe to
// load in a service worker (importScripts) — the DOM helpers are only called
// from page contexts, never at import time.
(function () {
  // Dull = medium lightness, low chroma. Any hue. Deliberately muted so it
  // never screams the way the old brand red did.
  function jcRandomBrand() {
    return {
      l: +(0.55 + Math.random() * 0.11).toFixed(3), // 0.55–0.66
      c: +(0.05 + Math.random() * 0.06).toFixed(3), // 0.05–0.11 (muted)
      h: Math.floor(Math.random() * 360),
    };
  }

  function jcBrandCss(b) {
    if (!b) return "oklch(0.58 0.08 16)";
    return `oklch(${b.l} ${b.c} ${b.h})`;
  }

  // A translucent wash of the same colour, for soft fills, rings and rules.
  function jcBrandSoftCss(b, alpha) {
    const x = b || { l: 0.58, c: 0.08, h: 16 };
    return `oklch(${x.l} ${x.c} ${x.h} / ${alpha})`;
  }

  // OKLCH → sRGB, for the one place CSS can't reach: the canvas that draws the
  // toolbar icon.
  function jcBrandRgb(b) {
    const x = b || { l: 0.58, c: 0.08, h: 16 };
    const hr = (x.h * Math.PI) / 180;
    const a = x.c * Math.cos(hr);
    const bb = x.c * Math.sin(hr);
    const l_ = x.l + 0.3963377774 * a + 0.2158037573 * bb;
    const m_ = x.l - 0.1055613458 * a - 0.0638541728 * bb;
    const s_ = x.l - 0.0894841775 * a - 1.291485548 * bb;
    const L = l_ ** 3,
      M = m_ ** 3,
      S = s_ ** 3;
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

  // Paint a page context (popup / history / an injected root) with the colour.
  function jcApplyBrand(b, root) {
    const el = root || (typeof document !== "undefined" ? document.documentElement : null);
    if (!el || !el.style) return;
    el.style.setProperty("--accent", jcBrandCss(b));
    el.style.setProperty("--accent-soft", jcBrandSoftCss(b, 0.1));
    el.style.setProperty("--accent-wash", jcBrandSoftCss(b, 0.06));
    el.style.setProperty("--accent-line", jcBrandSoftCss(b, 0.28));
  }

  // Read the shared colour (minting + persisting one if none exists yet), then
  // paint this surface. Also repaint live if the colour changes underneath us.
  function jcInitBrand(root) {
    const paint = (b) => jcApplyBrand(b, root);
    try {
      chrome.storage.local.get(["jcBrand"], (res) => {
        let b = res && res.jcBrand;
        if (!b) {
          b = jcRandomBrand();
          try {
            chrome.storage.local.set({ jcBrand: b });
          } catch (_) {}
        }
        paint(b);
      });
      if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === "local" && changes.jcBrand && changes.jcBrand.newValue) {
            paint(changes.jcBrand.newValue);
          }
        });
      }
    } catch (_) {
      paint(jcRandomBrand());
    }
  }

  const api = { jcRandomBrand, jcBrandCss, jcBrandSoftCss, jcBrandRgb, jcApplyBrand, jcInitBrand };
  Object.assign(globalThis, api);
})();
