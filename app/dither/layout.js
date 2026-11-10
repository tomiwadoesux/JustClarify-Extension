// Reference route, deliberately kept out of the index. /dither is a working
// document for one technique, not a page anyone should land on from search: it
// has no product content and would only dilute /demo's signals.
export const metadata = {
  title: "Dither",
  robots: { index: false, follow: false, nocache: true },
};

export default function DitherLayout({ children }) {
  return children;
}
