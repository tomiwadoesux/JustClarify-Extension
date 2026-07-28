# JustClarify Privacy Policy

Last updated: July 28, 2026

## Overview

JustClarify is a browser extension that helps you understand what you are reading without leaving the page. It explains highlighted text, rewrites passages, and checks factual claims against published fact-checks and web sources.

This policy explains what JustClarify collects, what is stored, what is shared, and what you can control. It covers one thing that is unusual and worth reading carefully: fact-check results are stored on our servers and shared with other users of the extension. That is described in **Shared fact-check results** below.

## Information We Collect

JustClarify only processes content when you actively use it. It does not run in the background, does not log the pages you browse, and does not read pages you have not asked it to act on.

### 1. Email address

If you use JustClarify during the early access period, the extension asks for your email address. It is used to manage early access and to contact you about the product.

### 2. Selected text and surrounding context

When you ask JustClarify to explain or rewrite something, the extension sends:

- the text you highlighted
- surrounding text needed to understand the context
- the mode you selected, such as simplify, expand, example, or follow-up

This is sent to the JustClarify backend to generate a response.

### 3. Page content, page address and page title — when you run a fact-check

When you run a fact-check on a page, the extension sends the page's text, its web address (URL) and its title to the JustClarify backend so that factual claims can be identified and verified.

### 4. Tab audio — only during live fact-checking

If you explicitly start live fact-checking, JustClarify captures audio from the current tab so that spoken claims can be transcribed and checked. This requires the `tabCapture` permission and an offscreen document, because Chrome does not allow service workers to access audio directly.

Audio capture starts only when you start it and stops when you stop it. Audio is transcribed for the purpose of extracting claims. We do not retain audio recordings.

## Shared fact-check results

**Please read this section carefully, as it involves information leaving your browser and being shown to other people.**

Checking an article with AI is slow and expensive, so JustClarify checks each article once and then shares the result. When you fact-check a page, we store:

- the page's web address, with tracking parameters removed
- the page title
- a cryptographic hash (a fingerprint) of the page text — not the page text itself
- the resulting verdicts, which include **short verbatim excerpts of the sentences that were checked**, a plain-language summary, and links to sources

Anyone else who later visits that same page using JustClarify will be shown those stored verdicts. This means:

- The web address of a page you fact-check, its title, and excerpts of its text are stored on our servers.
- Those excerpts and the page address can be seen by other users of the extension who visit the same page.
- This applies **only to pages you actively choose to fact-check.** It does not apply to pages you merely visit, nor to the explain or rewrite features.

Because of this, **do not run fact-checks on private, internal, paywalled, or otherwise non-public pages.** Anything checked may be shown to other users who reach the same address.

Stored verdicts are not linked to you. We do not store an account identifier, IP-based identity, or any user identifier alongside them.

## How We Use Information

We use collected information to:

- provide explanations, rewrites and fact-check verdicts inside the extension
- avoid repeating expensive work by reusing fact-check results across users
- manage early access
- maintain and operate the JustClarify service
- contact users about product availability, updates, or rollout

We do not sell personal information, use it for advertising, or use it to determine creditworthiness or eligibility for any service.

## How Information Is Stored

### Email address

Stored locally in your browser so you do not have to re-enter it, submitted to the JustClarify backend, and stored with Resend for contact purposes.

### Settings and optional API key

Your settings, and any API key you choose to provide, are stored **locally in your browser only**. An API key you supply is never sent to JustClarify servers; it is used to call the AI provider directly from your browser.

### Selected text and context

Sent to the JustClarify backend to generate a response, and passed on to AI providers strictly to produce that response. It is not retained after the response is generated.

### Fact-check results

Stored in our database, hosted with Supabase, as described in **Shared fact-check results**.

## Data Retention

- **Fact-check verdicts:** retained for up to 14 days, after which they expire and are re-checked or removed.
- **Selected text and context:** not retained after your response is generated.
- **Audio:** not retained.
- **Email address:** retained while you remain on the early access list, until you ask us to delete it.

## Third-Party Services

JustClarify uses the following services, which may process the information needed to perform their function:

| Service | Purpose |
|---|---|
| Supabase | Database hosting for shared fact-check results |
| Vercel | Hosting for the JustClarify backend |
| Hugging Face | AI-generated explanations |
| Vercel AI Gateway | Routes AI requests to model providers |
| Perplexity | Web-grounded fact-check verdicts |
| OpenAI | Identifying which sentences contain checkable claims |
| Google Fact Check Tools | Retrieving fact-checks already published by organisations such as PolitiFact, Snopes and FactCheck.org |
| DictionaryAPI | Dictionary lookups |
| Resend | Storing email contacts and sending email |

## What We Do Not Collect

JustClarify does not intentionally collect:

- passwords
- payment information
- health information
- precise location data
- keystroke logs
- a log of your general browsing activity

To be precise about browsing data: we do **not** record the pages you visit. We **do** store the address of a page when you actively run a fact-check on it, as described above.

## Sharing of Information

We do not sell personal information. We share information with service providers only as necessary to operate JustClarify.

Fact-check verdicts, including the page addresses and text excerpts they contain, are shared with other users of the extension as described in **Shared fact-check results**.

## Your Choices

- You can stop using the extension at any time.
- You can avoid all shared storage by simply not running fact-checks; explanations and rewrites are never stored or shared.
- You can remove locally stored data by uninstalling the extension or clearing its stored data in your browser.
- You can report a fact-check verdict you believe is wrong from within the extension.
- You can ask us to remove a stored verdict or your email address by contacting us.

## Children's Privacy

JustClarify is not intended for children under 13, and we do not knowingly collect personal information from children under 13.

## Changes to This Policy

We may update this policy from time to time. When we do, we will update the effective date at the top of this page. Material changes to what is stored or shared will be reflected here before they take effect.

## Contact

For questions, or to request deletion of your information or a stored verdict, contact:

`@hello.ayotomcs.me`
