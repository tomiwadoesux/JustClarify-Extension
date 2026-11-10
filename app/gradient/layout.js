// Reference route, deliberately kept out of the index. /gradient is a working
// document for one technique, the same way /dither is: no product content, and
// indexing it would only dilute /demo's signals.
export const metadata = {
  title: "Gradient",
  robots: { index: false, follow: false, nocache: true },
};

export default function GradientLayout({ children }) {
  return children;
}
