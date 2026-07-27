import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — JustClarify",
  description:
    "JustClarify Privacy Policy. Learn what information JustClarify collects, how it is used, and how it is handled.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#171717]">
      {/* Header */}
      <header className="w-full px-4 md:px-10 py-5">
        <Link href="/" className="inline-flex items-center gap-2 group">
          <Image
            src="/Images/logo.svg"
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
          Last updated: March 10, 2026
        </p>

        <Section title="Overview">
          <p>
            JustClarify is a browser extension that helps users understand
            selected text without leaving the page. This Privacy Policy explains
            what information JustClarify collects, how it is used, and how it is
            handled.
          </p>
        </Section>

        <Section title="Information We Collect">
          <p className="mb-4">
            JustClarify currently collects the following categories of
            information:
          </p>

          <h3 className="font-semibold text-[#000000] mb-2">
            1. Email address
          </h3>
          <p className="mb-5">
            If you choose to use JustClarify during the early access period, the
            extension asks for your email address. That email address is used to
            manage early access and future product communication.
          </p>

          <h3 className="font-semibold text-[#000000] mb-2">
            2. Selected text and surrounding context
          </h3>
          <p className="mb-3">
            When you use JustClarify to explain text, the extension sends:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>the text you highlighted</li>
            <li>surrounding text needed to understand the context</li>
            <li>
              the explanation mode you selected, such as simplify, expand,
              example, or follow-up
            </li>
          </ul>
          <p>
            This information is sent to the JustClarify backend in order to
            generate a response.
          </p>
        </Section>

        <Section title="How We Use Information">
          <p className="mb-3">We use collected information to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>provide contextual explanations inside the extension</li>
            <li>improve access management during early access</li>
            <li>maintain and operate the JustClarify service</li>
            <li>
              contact users later about product availability, updates, or
              rollout information
            </li>
          </ul>
        </Section>

        <Section title="How Information Is Stored">
          <h3 className="font-semibold text-[#000000] mb-2">Email address</h3>
          <p className="mb-2">Your email address is:</p>
          <ul className="list-disc pl-5 space-y-1 mb-5">
            <li>
              stored locally in your browser using extension storage so you do
              not have to enter it again each time
            </li>
            <li>submitted to the JustClarify backend</li>
            <li>
              stored with Resend for contact and email communication purposes
            </li>
          </ul>

          <h3 className="font-semibold text-[#000000] mb-2">
            Selected text and context
          </h3>
          <p>
            Selected text and contextual content are sent to the JustClarify
            backend for processing. That data may be sent onward to third-party
            AI or utility providers strictly to generate the requested
            explanation or dictionary-style response.
          </p>
        </Section>

        <Section title="Third-Party Services">
          <p className="mb-3">
            JustClarify currently uses third-party services to operate parts of
            the product, including:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-3">
            <li>Resend, for storing email contacts and future communication</li>
            <li>Hugging Face, for AI-generated explanations</li>
            <li>DictionaryAPI, for dictionary lookup functionality</li>
          </ul>
          <p>
            These services may process the information required to perform their
            functions.
          </p>
        </Section>

        <Section title="What We Do Not Collect">
          <p className="mb-3">JustClarify does not intentionally collect:</p>
          <ul className="list-disc pl-5 space-y-1 mb-3">
            <li>passwords</li>
            <li>payment information</li>
            <li>health information</li>
            <li>precise location data</li>
            <li>browsing history as a separate stored log</li>
            <li>keystroke logs</li>
          </ul>
          <p>
            JustClarify only processes website content when you actively use the
            extension on selected text.
          </p>
        </Section>

        <Section title="Sharing of Information">
          <p>
            We do not sell personal information. We only share information with
            service providers as necessary to operate JustClarify, such as email
            and AI infrastructure providers.
          </p>
        </Section>

        <Section title="Data Retention">
          <p>
            We retain information only as long as reasonably necessary to
            operate the service, manage early access, communicate with users,
            and support future product rollout.
          </p>
        </Section>

        <Section title="Your Choices">
          <p className="mb-3">
            You can stop using the extension at any time. You can also remove
            locally stored extension data by uninstalling the extension or
            clearing the extension&apos;s stored data in your browser.
          </p>
          <p>
            If you want your email removed from our contact records, you can
            contact us and request deletion.
          </p>
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
            will update the effective date at the top of this page.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            If you have questions about this Privacy Policy or want to request
            deletion of your information, contact:{" "}
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
