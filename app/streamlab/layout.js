// Streaming lab — a visible reproduction of how the "Your LLM" engine reads a
// chat tab, so the streaming behaviour can be watched in ordinary devtools
// instead of the extension's hidden service-worker console. Never indexed.
export const metadata = {
  title: "Streaming lab",
  robots: { index: false, follow: false, nocache: true },
};

export default function StreamLabLayout({ children }) {
  return children;
}
