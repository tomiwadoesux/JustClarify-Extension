// The page itself is a client component, so it cannot export metadata. This
// layout carries it — without which /tellme would inherit the landing page's
// title and canonical, and tell crawlers two URLs are the same page.
//
// Analytics is NOT here, it is in page.js. A layout wraps its whole subtree,
// which would include /tellme/admin, and the admin panel is a control room
// visited by one person. Counting it would put your own housekeeping in the
// same numbers as real visitors.
export const metadata = {
  title: "Tell us what happened",
  description:
    "Report a problem with Just Clarify in your own words. Every report is public: red until it is fixed, green once it is.",
  alternates: { canonical: "/tellme" },
  openGraph: {
    title: "Tell us what happened | JustClarify",
    description:
      "Report a problem with Just Clarify in your own words, see what everyone else has reported, and watch it turn green when it is fixed.",
    url: "/tellme",
    siteName: "JustClarify",
    type: "website",
    images: [{ url: "/Images/OgImage.webp", width: 1200, height: 630, alt: "JustClarify" }],
  },
};

export default function TellmeLayout({ children }) {
  return children;
}
