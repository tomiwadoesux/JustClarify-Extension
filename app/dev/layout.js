// The extension test bench. Must never be indexed — it's full of deliberately
// false statements used as fact-check fixtures, and Google has no way to tell
// they're fixtures. It's also absent from sitemap.js for the same reason.
export const metadata = {
  title: "Extension test bench",
  robots: { index: false, follow: false, nocache: true },
};

export default function DevLayout({ children }) {
  return children;
}
