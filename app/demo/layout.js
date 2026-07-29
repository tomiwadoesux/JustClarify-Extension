// /demo is the live landing page — `/` permanently redirects here (see
// next.config.mjs), so this is the URL that must self-canonicalise. Title,
// description and Open Graph are inherited from the root layout on purpose:
// this page is the site's primary entry point, so it carries the primary copy.
export const metadata = {
  alternates: { canonical: "/demo" },
};

export default function DemoLayout({ children }) {
  return children;
}
