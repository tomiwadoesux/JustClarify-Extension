// Prototype route — kept for reference, deliberately kept out of the index.
// These pages are near-duplicates of the live landing page; left indexable they
// compete with /demo for the same terms and split its ranking signals.
export const metadata = {
  title: "Prototype",
  robots: { index: false, follow: false, nocache: true },
};

export default function PrototypeLayout({ children }) {
  return children;
}
