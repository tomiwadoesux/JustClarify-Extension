// /demo is the live landing page — `/` permanently redirects here (see
// next.config.mjs), so this is the URL that must self-canonicalise. Title,
// description and Open Graph are inherited from the root layout on purpose:
// this page is the site's primary entry point, so it carries the primary copy.
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  alternates: { canonical: "/demo" },
};

// Analytics is mounted per-route rather than in the root layout, so it measures
// the two pages worth measuring — the landing page and the report board — and
// leaves the experiments at /3d, /v2, /tusi and friends out of the numbers.
export default function DemoLayout({ children }) {
  return (
    <>
      {children}
      <Analytics />
    </>
  );
}
