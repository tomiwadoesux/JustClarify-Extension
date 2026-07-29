// Served at /robots.txt.
//
// Deliberately does NOT disallow the prototype routes (/test, /v2, /v3, /tusi,
// /harmonics, /3d). They're deindexed with `robots: { index: false }` in their
// own layouts, and a robots.txt Disallow would actively defeat that: blocking a
// URL stops Googlebot fetching the page, which means it never sees the noindex
// meta tag, and an already-indexed URL stays in the index as "Indexed, though
// blocked by robots.txt". Blocking is for crawl budget; noindex is for removal.
// Once they've dropped out of the index, adding Disallow back is safe.
export default function robots() {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://justclarify.xyz/sitemap.xml",
    host: "https://justclarify.xyz",
  };
}
