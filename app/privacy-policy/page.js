import Image from "next/image";
import Link from "next/link";

// "Privacy Policy" alone — the root layout's title template appends
// " | JustClarify", so spelling out the brand here would double it.
export const metadata = {
  title: "Privacy Policy",
  description:
    "JustClarify Privacy Policy. Learn what information JustClarify collects, how it is used, what is stored, and what is shared with other users.",
  alternates: { canonical: "/privacy-policy" },
  // Next shallow-merges metadata, so declaring `openGraph` here replaces the
  // root block wholesale — it has to be spelled out in full or this page would
  // inherit the landing page's og:url and lose its image.
  openGraph: {
    title: "Privacy Policy | JustClarify",
    description:
      "What JustClarify collects, how it is used, what is stored, and what is shared with other users.",
    url: "/privacy-policy",
    siteName: "JustClarify",
    type: "article",
    images: [{ url: "/Images/OgImage.webp", width: 1200, height: 630, alt: "JustClarify" }],
  },
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#171717]">
      {/* Header */}
      <header className="w-full px-4 md:px-10 py-5">
        <Link href="/" className="inline-flex items-center gap-2 group">
          <Image
            src="/diamond.svg"
            alt="JustClarify logo"
            width={32}
            height={32}
            priority
            className="w-5 h-5 md:w-6 md:h-6"
          />
          <span className="text-base md:text-xl">JustClarify</span>
          <span className="text-xs text-[#000000] ml-1 group-hover:text-[#FF0000] transition-colors">
            &larr; Home
          </span>
        </Link>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-6 md:px-8 pb-20 pt-4">
        <h1 className="text-2xl md:text-3xl font-semibold text-[#FF0000] mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-[#000000] mb-10">
          Last updated: July 28, 2026
        </p>

        <Section title="Overview">
          <p className="mb-3">
            JustClarify is a browser extension that helps you understand what
            you are reading without leaving the page. It explains highlighted
            text, rewrites passages, and checks factual claims against published
            fact-checks and web sources.
          </p>
          <p>
            This policy explains what JustClarify collects, what is stored, what
            is shared, and what you can control. It covers one thing that is
            unusual and worth reading carefully: fact-check results are stored on
            our servers and shared with other users of the extension. That is
            described in{" "}
            <span className="font-semibold">Shared fact-check results</span>{" "}
            below.
          </p>
        </Section>

        <Section title="Information We Collect">
          <p className="mb-4">
            JustClarify only processes content when you actively use it. It does
            not run in the background, does not log the pages you browse, and
            does not read pages you have not asked it to act on.
          </p>

          <h3 className="font-semibold text-[#000000] mb-2">
            1. Email address
          </h3>
          <p className="mb-5">
            If you use JustClarify during the early access period, the extension
            asks for your email address. It is used to manage early access and to
            contact you about the product.
          </p>

          <h3 className="font-semibold text-[#000000] mb-2">
            2. Selected text and surrounding context
          </h3>
          <p className="mb-3">
            When you ask JustClarify to explain or rewrite something, the
            extension sends:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-5">
            <li>the text you highlighted</li>
            <li>surrounding text needed to understand the context</li>
            <li>
              the mode you selected, such as simplify, expand, example, or
              follow-up
            </li>
          </ul>

          <h3 className="font-semibold text-[#000000] mb-2">
            3. Page content, page address and page title, when you run a
            fact-check
          </h3>
          <p className="mb-5">
            When you run a fact-check on a page, the extension sends the
            page&apos;s text, its web address (URL) and its title to the
            JustClarify backend so that factual claims can be identified and
            verified.
          </p>

          <h3 className="font-semibold text-[#000000] mb-2">
            4. Tab audio, only during live fact-checking
          </h3>
          <p>
            If you explicitly start live fact-checking, JustClarify captures
            audio from the current tab so that spoken claims can be transcribed
            and checked. Capture starts only when you start it and stops when you
            stop it. Audio is used to produce a transcript. We do not retain
            audio recordings.
          </p>
        </Section>

        <Section title="Shared fact-check results">
          <div className="border-l-2 border-[#FF0000] bg-[#FAFAFA] rounded-r p-4 mb-4">
            <p className="font-semibold text-[#000000]">
              Please read this section carefully. It involves information leaving
              your browser and being shown to other people.
            </p>
          </div>

          <p className="mb-3">
            Checking an article with AI is slow and expensive, so JustClarify
            checks each article once and then shares the result. When you
            fact-check a page, we store:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-4">
            <li>the page&apos;s web address, with tracking parameters removed</li>
            <li>the page title</li>
            <li>
              a cryptographic hash (a fingerprint) of the page text, not the
              page text itself
            </li>
            <li>
              the resulting verdicts, which include{" "}
              <span className="font-semibold">
                short verbatim excerpts of the sentences that were checked
              </span>
              , a plain-language summary, and links to sources
            </li>
          </ul>

          <p className="mb-3">
            Anyone else who later visits that same page using JustClarify will be
            shown those stored verdicts. This means:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-4">
            <li>
              The web address of a page you fact-check, its title, and excerpts
              of its text are stored on our servers.
            </li>
            <li>
              Those excerpts and the page address can be seen by other users of
              the extension who visit the same page.
            </li>
            <li>
              This applies{" "}
              <span className="font-semibold">
                only to pages you actively choose to fact-check.
              </span>{" "}
              It does not apply to pages you merely visit, nor to the explain or
              rewrite features.
            </li>
          </ul>

          <p className="mb-3">
            Because of this,{" "}
            <span className="font-semibold">
              do not run fact-checks on private, internal, paywalled, or
              otherwise non-public pages.
            </span>{" "}
            Anything checked may be shown to other users who reach the same
            address.
          </p>

          <p>
            Stored verdicts are not linked to you. We do not store an account
            identifier, IP-based identity, or any user identifier alongside them.
          </p>
        </Section>

        <Section title="How We Use Information">
          <p className="mb-3">We use collected information to:</p>
          <ul className="list-disc pl-5 space-y-1 mb-3">
            <li>
              provide explanations, rewrites and fact-check verdicts inside the
              extension
            </li>
            <li>
              avoid repeating expensive work by reusing fact-check results across
              users
            </li>
            <li>manage early access</li>
            <li>maintain and operate the JustClarify service</li>
            <li>
              contact users about product availability, updates, or rollout
            </li>
          </ul>
          <p>
            We do not sell personal information, use it for advertising, or use
            it to determine creditworthiness or eligibility for any service.
          </p>
        </Section>

        <Section title="How Information Is Stored">
          <h3 className="font-semibold text-[#000000] mb-2">Email address</h3>
          <p className="mb-5">
            Stored locally in your browser so you do not have to re-enter it,
            submitted to the JustClarify backend, and stored with Resend for
            contact purposes.
          </p>

          <h3 className="font-semibold text-[#000000] mb-2">
            Settings and optional API key
          </h3>
          <p className="mb-5">
            Your settings, and any API key you choose to provide, are stored{" "}
            <span className="font-semibold">
              locally in your browser only
            </span>
            . An API key you supply is never sent to JustClarify servers; it is
            used to call the AI provider directly from your browser.
          </p>

          <h3 className="font-semibold text-[#000000] mb-2">
            Selected text and context
          </h3>
          <p className="mb-5">
            Sent to the JustClarify backend to generate a response, and passed on
            to AI providers strictly to produce that response. It is not retained
            after the response is generated.
          </p>

          <h3 className="font-semibold text-[#000000] mb-2">
            Fact-check results
          </h3>
          <p>
            Stored in our database, hosted with Supabase, as described in Shared
            fact-check results.
          </p>
        </Section>

        <Section title="Data Retention">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <span className="font-semibold">Fact-check verdicts:</span>{" "}
              retained for up to 14 days, after which they expire and are
              re-checked or removed.
            </li>
            <li>
              <span className="font-semibold">
                Selected text and context:
              </span>{" "}
              not retained after your response is generated.
            </li>
            <li>
              <span className="font-semibold">Audio:</span> not retained.
            </li>
            <li>
              <span className="font-semibold">Email address:</span> retained
              while you remain on the early access list, until you ask us to
              delete it.
            </li>
          </ul>
        </Section>

        <Section title="Third-Party Services">
          <p className="mb-3">
            JustClarify uses the following services, which may process the
            information needed to perform their function:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <span className="font-semibold">Supabase</span>: database hosting
              for shared fact-check results
            </li>
            <li>
              <span className="font-semibold">Vercel</span>: hosting for the
              JustClarify backend
            </li>
            <li>
              <span className="font-semibold">Hugging Face</span>: AI-generated
              explanations
            </li>
            <li>
              <span className="font-semibold">Vercel AI Gateway</span>: routes
              AI requests to model providers
            </li>
            <li>
              <span className="font-semibold">Perplexity</span>: web-grounded
              fact-check verdicts
            </li>
            <li>
              <span className="font-semibold">OpenAI</span>: identifying which
              sentences contain checkable claims
            </li>
            <li>
              <span className="font-semibold">Google Fact Check Tools</span>:
              retrieving fact-checks already published by organisations such as
              PolitiFact, Snopes and FactCheck.org
            </li>
            <li>
              <span className="font-semibold">DictionaryAPI</span>: dictionary
              lookups
            </li>
            <li>
              <span className="font-semibold">Resend</span>: storing email
              contacts and sending email
            </li>
          </ul>
        </Section>

        <Section title="What We Do Not Collect">
          <p className="mb-3">
            JustClarify does not intentionally collect:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-3">
            <li>passwords</li>
            <li>payment information</li>
            <li>health information</li>
            <li>precise location data</li>
            <li>keystroke logs</li>
            <li>a log of your general browsing activity</li>
          </ul>
          <p>
            To be precise about browsing data: we do{" "}
            <span className="font-semibold">not</span> record the pages you
            visit. We <span className="font-semibold">do</span> store the address
            of a page when you actively run a fact-check on it, as described
            above.
          </p>
        </Section>

        <Section title="Sharing of Information">
          <p className="mb-3">
            We do not sell personal information. We share information with
            service providers only as necessary to operate JustClarify.
          </p>
          <p>
            Fact-check verdicts, including the page addresses and text excerpts
            they contain, are shared with other users of the extension as
            described in Shared fact-check results.
          </p>
        </Section>

        <Section title="Your Choices">
          <ul className="list-disc pl-5 space-y-1">
            <li>You can stop using the extension at any time.</li>
            <li>
              You can avoid all shared storage by simply not running
              fact-checks; explanations and rewrites are never stored or shared.
            </li>
            <li>
              You can remove locally stored data by uninstalling the extension or
              clearing its stored data in your browser.
            </li>
            <li>
              You can report a fact-check verdict you believe is wrong from
              within the extension.
            </li>
            <li>
              You can ask us to remove a stored verdict or your email address by
              contacting us.
            </li>
          </ul>
        </Section>

        <Section title="Children's Privacy">
          <p>
            JustClarify is not intended for children under 13, and we do not
            knowingly collect personal information from children under 13.
          </p>
        </Section>

        <Section title="Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. When we do, we
            will update the effective date at the top of this page. Material
            changes to what is stored or shared will be reflected here before
            they take effect.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            For questions, or to request deletion of your information or a stored
            verdict, contact:{" "}
            <a
              href="mailto:hello@ayotomcs.me"
              className="text-[#FF0000] underline underline-offset-2 hover:opacity-80 transition-opacity"
            >
              hello@ayotomcs.me
            </a>
          </p>
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1 h-5 rounded-full bg-[#FF0000]" />
        <h2 className="text-lg md:text-xl font-semibold text-[#000000]">
          {title}
        </h2>
      </div>
      <div className="text-[15px] leading-relaxed text-[#000000] pl-4">
        {children}
      </div>
    </section>
  );
}
