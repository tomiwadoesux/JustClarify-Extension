// Served at /sitemap.xml. Only canonical, indexable URLs belong here — the
// prototype routes (/test, /v2, /v3, /tusi, /harmonics, /3d) are deliberately
// absent because they're noindexed.
export default function sitemap() {
  const base = "https://justclarify.xyz";
  return [
    // `/` is intentionally absent: it 308s to /demo, and listing a redirecting
    // URL in a sitemap is a Search Console warning.
    { url: `${base}/demo`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/privacy-policy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
