// The page is a client component, so its metadata lives here.
//
// Two things this has to override. The root layout points every route's
// canonical at /demo, which would tell crawlers this page is the landing page.
// And the interview is reached by an invite link, not by search, so it is kept
// out of indexes altogether.
export const metadata = {
  title: "A short chat about how you study",
  description:
    "A five minute conversation with an AI interviewer about how students use AI to study.",
  alternates: { canonical: "/interview" },
  robots: { index: false, follow: false },
};

// Stops iOS zooming the page when the answer box is focused, without blocking
// pinch zoom for people who need it.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function InterviewLayout({ children }) {
  return children;
}
