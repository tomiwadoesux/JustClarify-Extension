// factcheck.js — evidence-backed fact-checking for JustClarify.
//
// A fact-check is only worth showing if it's grounded in something the reader
// can click. So this never asks a model "is this true?" from memory. Two
// sources of evidence, cheapest first:
//
//   1. PUBLISHED FACT-CHECKS (free). Google's Fact Check Tools API indexes
//      ClaimReview markup from PolitiFact, Snopes, FactCheck.org, AFP and
//      hundreds more. A hit here means a human fact-checker already ruled on
//      this claim — the strongest answer we can give, and it costs nothing.
//   2. WEB SEARCH + MODEL (needs a Gateway key). Only when step 1 finds
//      nothing. We use a search-native model so retrieval and reasoning happen
//      in one call, and we keep the returned citations.
//
// Chrome's on-device model is deliberately NOT used to reach a verdict: Gemini
// Nano can't browse and has a small, dated knowledge base, so it would produce
// confident fiction. It IS used for claim extraction, which is pure text work
// on text we already have — see factCheckExtractClaims.
//
// Loaded by background.js after gateway.js (reuses gatewayGetSettings).

const FC_LOOKUP_PROXY = "https://api.justclarify.xyz/factcheck/lookup";
const FC_GOOGLE_ENDPOINT =
  "https://factchecktools.googleapis.com/v1alpha1/claims:search";

// Perplexity's sonar models search the web as part of ordinary generation and
// return a citations array — which means grounded answers over a plain
// chat/completions POST, with no tool-calling round trip. That matters here:
// this extension talks to the Gateway with raw fetch, not the AI SDK.
const FC_SEARCH_MODEL = "perplexity/sonar";

const FC_VERDICTS = [
  "TRUE",
  "MOSTLY_TRUE",
  "MIXED",
  "MOSTLY_FALSE",
  "FALSE",
  "UNVERIFIABLE",
];

// Claims we refuse to rule on. Fact-checking an opinion is a category error and
// the fastest way to lose a reader's trust.
const FC_VERDICT_RULES = `
Rules:
- Judge ONLY objectively checkable assertions. Opinions, predictions, promises,
  value judgements and rhetorical questions are UNVERIFIABLE by definition.
- Use UNVERIFIABLE freely. It is the correct answer whenever the evidence you
  found does not actually settle the claim. Never guess to seem useful.
- Judge the claim as stated, not a stronger or weaker version of it.
- Every source URL you cite must be one you actually retrieved.`;

// ---------- 1. Published fact-checks (free) ----------

// Prefer the user's own Google API key when they've added one — that path works
// with no JustClarify server at all, which matters for self-hosters. Otherwise
// go through the proxy so the default install needs zero setup.
// Returns { ok, results }. `ok:false` means the lookup could not run at all
// (offline, proxy down, bad key) — which is NOT the same as running and finding
// nothing, and the two need different words in the UI. Collapsing both to an
// empty array made a broken lookup look identical to an unruled claim.
async function factCheckLookup(claim) {
  const query = String(claim || "").trim().slice(0, 300);
  if (!query) return { ok: true, results: [] };

  const { jcGoogleFactKey } = await chrome.storage.local
    .get(["jcGoogleFactKey"])
    .catch(() => ({}));

  const url = jcGoogleFactKey
    ? `${FC_GOOGLE_ENDPOINT}?query=${encodeURIComponent(query)}&languageCode=en&pageSize=5&key=${encodeURIComponent(jcGoogleFactKey)}`
    : `${FC_LOOKUP_PROXY}?query=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("JustClarify: fact-check lookup failed", res.status, url.split("?")[0]);
      return { ok: false, results: [] };
    }
    const data = await res.json();
    return {
      ok: true,
      results: (data.claims || []).flatMap((c) =>
        (c.claimReview || []).map((r) => ({
          claim: c.text || query,
          claimant: c.claimant || "",
          publisher: r.publisher?.name || "",
          rating: r.textualRating || "",
          title: r.title || "",
          url: r.url || "",
        })),
      ),
    };
  } catch (error) {
    console.warn("JustClarify: fact-check lookup unreachable", error);
    return { ok: false, results: [] };
  }
}

// Map a publisher's own wording ("Pants on Fire", "Four Pinocchios", "Correct")
// onto our verdict scale. Deliberately conservative: anything we can't read
// confidently stays MIXED rather than being forced to a strong verdict.
function factCheckRatingToVerdict(rating) {
  const r = String(rating || "").toLowerCase();
  if (/pants on fire|pinocchio|fabricat|no evidence|baseless|debunk/.test(r)) return "FALSE";
  if (/^false|mostly false|incorrect|inaccurate|wrong|misleading/.test(r)) {
    return /mostly|partly/.test(r) ? "MOSTLY_FALSE" : "FALSE";
  }
  if (/half|mixed|partly|partially|lacks context|missing context|exaggerat/.test(r)) return "MIXED";
  if (/mostly true|mostly accurate|largely/.test(r)) return "MOSTLY_TRUE";
  if (/^true|accurate|correct|confirmed|verified/.test(r)) return "TRUE";
  return "MIXED";
}

// ---------- 2. Search-grounded verdict (needs a Gateway key) ----------

function factCheckPrompt(claim, context, published) {
  const priors = published.length
    ? `\nPublished fact-checks already found for this claim (weigh these heavily):\n${published
        .map((p) => `- ${p.publisher} rated it "${p.rating}" — ${p.url}`)
        .join("\n")}\n`
    : "";

  const where = context
    ? `\nIt appeared in this passage, so judge the meaning it carries there:\n"""${context.slice(0, 1200)}"""\n`
    : "";

  return `Fact-check this claim by searching for current evidence.

CLAIM: "${claim}"
${where}${priors}${FC_VERDICT_RULES}

Reply with ONLY a JSON object, no markdown fence, in exactly this shape:
{"verdict":"${FC_VERDICTS.join('|')}","confidence":"high|medium|low","summary":"<=40 words, plain language, what the evidence shows","sources":[{"title":"...","url":"..."}]}`;
}

function factCheckParse(raw) {
  const match = String(raw || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (_) {
    return null;
  }
  const verdict = String(parsed.verdict || "").toUpperCase().replace(/[\s-]+/g, "_");
  return {
    verdict: FC_VERDICTS.includes(verdict) ? verdict : "UNVERIFIABLE",
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
    summary: String(parsed.summary || "").trim(),
    sources: Array.isArray(parsed.sources)
      ? parsed.sources
          .filter((s) => s && typeof s.url === "string" && /^https?:\/\//.test(s.url))
          .slice(0, 6)
          .map((s) => ({ title: String(s.title || s.url).slice(0, 140), url: s.url }))
      : [],
  };
}

async function factCheckVerify(claim, context, published) {
  const settings = await gatewayGetSettings();

  // No key of their own: JustClarify's hosted tier verifies instead. This used
  // to `return null` here, which meant fact-checking — the feature the product
  // is named after — silently did nothing for every user without an API key.
  if (!settings) {
    const answer = await hostedComplete(
      [{ role: "user", content: factCheckPrompt(claim, context, published) }],
      { maxTokens: 700 },
    );
    if (!answer) return { error: "the fact-check service is unavailable right now" };
    const parsed = factCheckParse(answer);
    // The hosted model has no web search, so it returns no citations. A verdict
    // it can't source is one it shouldn't be trusted to rule on — factCheckParse
    // already carries whatever sources the model named, and the caller shows
    // UNVERIFIABLE when there are none.
    return parsed || { error: "the model's answer couldn't be read as a verdict" };
  }

  let res;
  try {
    res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: FC_SEARCH_MODEL,
        messages: [{ role: "user", content: factCheckPrompt(claim, context, published) }],
        max_tokens: 700,
        temperature: 0,
      }),
    });
  } catch (e) {
    return { error: `couldn't reach the Gateway (${String(e).slice(0, 80)})` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      return { error: "the Gateway rejected your API key" };
    }
    if (res.status === 402) return { error: "this Gateway key is out of credit" };
    return { error: `Gateway returned HTTP ${res.status}: ${body.slice(0, 120)}` };
  }

  const data = await res.json().catch(() => null);
  const parsed = factCheckParse(data?.choices?.[0]?.message?.content);
  if (!parsed) return { error: "the model's answer couldn't be read as a verdict" };

  // Sonar returns the pages it actually read; those beat anything the model
  // typed into the JSON, so merge them in and de-duplicate by URL.
  const cited = Array.isArray(data.citations)
    ? data.citations
        .filter((u) => typeof u === "string" && /^https?:\/\//.test(u))
        .map((u) => ({ title: u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0], url: u }))
    : [];
  const seen = new Set();
  parsed.sources = [...parsed.sources, ...cited]
    .filter((s) => !seen.has(s.url) && seen.add(s.url))
    .slice(0, 6);

  return parsed;
}

// ---------- Orchestration ----------

// One claim → one verdict. Published fact-checks are authoritative when they
// exist; otherwise we search, and when we can't search we say so plainly
// instead of inventing a ruling.
async function factCheckOne(claim, context) {
  const text = String(claim || "").trim();
  if (!text) return null;

  const lookup = await factCheckLookup(text);
  const published = lookup.results;
  const hasKey = !!(await gatewayGetSettings());

  if (published.length) {
    const top = published[0];
    // With a key we still search — a 2019 ruling on a claim that resurfaced
    // today deserves current context. Without one, the published verdict
    // stands on its own, which is exactly the free tier's promise.
    if (!hasKey) {
      return {
        claim: text,
        verdict: factCheckRatingToVerdict(top.rating),
        confidence: "high",
        summary: `${top.publisher} rated this "${top.rating}".`,
        sources: published.slice(0, 4).map((p) => ({
          title: `${p.publisher}${p.title ? ` — ${p.title}` : ""}`,
          url: p.url,
        })),
        origin: "published",
      };
    }
  }

  if (!hasKey) {
    return {
      claim: text,
      verdict: "UNVERIFIABLE",
      confidence: "low",
      // Two different situations, two different sentences. Saying "nobody has
      // ruled on this" when the lookup never actually ran is a lie the reader
      // can't detect.
      summary: lookup.ok
        ? "No fact-checker has published a ruling on this. The free check covers claims PolitiFact, Snopes, FactCheck.org and others have formally ruled on — mostly political and widely-circulated claims, not ordinary sentences. Add an AI Gateway key in the JustClarify popup to check anything else."
        : "Couldn't reach the fact-check lookup — check your connection and try again.",
      sources: [],
      origin: lookup.ok ? "no-key" : "lookup-failed",
    };
  }

  const verified = await factCheckVerify(text, context, published);
  if (!verified) return null;
  if (verified.error) {
    return {
      claim: text,
      verdict: "UNVERIFIABLE",
      confidence: "low",
      summary: `Couldn't complete the check — ${verified.error}.`,
      sources: published.slice(0, 3).map((p) => ({ title: p.publisher, url: p.url })),
      origin: "error",
    };
  }

  return {
    ...verified,
    claim: text,
    sources: verified.sources.length
      ? verified.sources
      : published.slice(0, 3).map((p) => ({ title: p.publisher, url: p.url })),
    origin: published.length ? "searched+published" : "searched",
  };
}

// ---------- Claim extraction (free on-device when possible) ----------

const FC_EXTRACT_RULES = `Extract only sentences that state a checkable fact — a number, date, event, quantity, attribution or causal assertion that could in principle be shown false.
Skip opinions, predictions, promises, questions, definitions and generic statements.`;

// Each claim carries two forms: `claim` is rewritten to stand alone (pronouns
// and relative dates resolved) so it can be verified out of context; `quote` is
// the exact sentence as it appears in the text so the page can underline it in
// place. The quote MUST be copied verbatim — a paraphrase can't be located.
function factCheckExtractPrompt(text, limit) {
  return `${FC_EXTRACT_RULES}
Rank by how much a reader would benefit from having it verified, and return at most ${limit}.

For each, return an object with:
- "quote": the sentence copied EXACTLY from the text, character for character (same words, casing and punctuation) so it can be found again. Do not fix or shorten it.
- "claim": the same statement rewritten to stand on its own (resolve "he", "it", "last year" into the names and dates the passage makes clear).

TEXT:
"""${text.slice(0, 9000)}"""

Reply with ONLY a JSON array of objects, no markdown fence:
[{"quote":"...","claim":"..."}]`;
}

function factCheckParseClaims(raw, limit) {
  const match = String(raw || "").match(/\[[\s\S]*\]/);
  if (!match) return [];
  let arr;
  try {
    arr = JSON.parse(match[0]);
  } catch (_) {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      // Object form {quote, claim}; tolerate a bare string from older outputs.
      if (typeof item === "string") {
        const s = item.trim();
        return { claim: s, quote: s };
      }
      if (item && typeof item === "object") {
        const claim = String(item.claim || item.quote || "").trim();
        const quote = String(item.quote || item.claim || "").trim();
        return { claim, quote };
      }
      return null;
    })
    .filter((c) => c && c.claim.length > 12)
    .slice(0, limit);
}

// Extraction is ordinary text work on text we already hold, so the free
// on-device model is genuinely good enough — and keeping it here is what lets
// a whole-article check cost a handful of verdict calls instead of fifty.
async function factCheckExtractClaims(text, limit = 6) {
  const body = String(text || "").trim();
  if (body.length < 40) return [];
  const prompt = factCheckExtractPrompt(body, limit);

  const settings = await gatewayGetSettings();
  if (!settings) {
    // Same reasoning as factCheckVerify: without this, a keyless user gets an
    // empty claim list and a fact-check that appears to find nothing.
    const answer = await hostedComplete([{ role: "user", content: prompt }], { maxTokens: 700 });
    return factCheckParseClaims(answer, limit);
  }
  try {
    const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 700,
        temperature: 0,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return factCheckParseClaims(data?.choices?.[0]?.message?.content, limit);
  } catch (_) {
    return [];
  }
}

// ---------- Shared errata cache ----------
//
// A verdict belongs to the article, not to the reader who happened to trigger
// the check. So before spending anything, ask whether this exact revision has
// already been checked for somebody else. On a page anyone has read before this
// is the whole flow: no key, no model call, no wait.

const FC_ERRATA_READ = "https://api.justclarify.xyz/errata";
const FC_ERRATA_CHECK = "https://api.justclarify.xyz/errata/check";

// Must produce the same digest as errata.content_hash on the server, or the
// two sides will never agree on a cache key. Normalizing away whitespace and
// case first means a CMS re-wrapping a paragraph doesn't discard a good verdict.
async function factCheckContentHash(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Returns the cached verdicts, or null for any reason at all — miss, stale,
// server down, cache not configured. Every one of those means the same thing to
// the caller ("nothing cached, do it yourself"), so they collapse on purpose.
async function factCheckCacheRead(url, hash) {
  try {
    const res = await fetch(
      `${FC_ERRATA_READ}?url=${encodeURIComponent(url)}&content_hash=${hash}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.hit && Array.isArray(data.verdicts) && data.verdicts.length
      ? data.verdicts
      : null;
  } catch (_) {
    return null;
  }
}

// Cold article: have the server run the check on its own key and keep the
// result for the next reader. This is what lets someone with no API key check a
// page that nobody has read yet.
async function factCheckServerCheck(url, text, title) {
  try {
    const res = await fetch(FC_ERRATA_CHECK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, text, title: title || "" }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.verdicts) && data.verdicts.length ? data.verdicts : null;
  } catch (_) {
    return null;
  }
}

// Push a finished set of verdicts to the page using the same message sequence a
// live run emits, so the content script needs no idea where they came from.
function factCheckDeliver(verdicts, tabId, runId) {
  const claims = verdicts.map((v) => ({
    claim: v.claim || v.quote || "",
    quote: v.quote || v.claim || "",
  }));

  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, { type: "JC_FACTCHECK_CLAIMS", runId, claims }).catch(() => {});
    verdicts.forEach((result, index) => {
      chrome.tabs
        .sendMessage(tabId, { type: "JC_FACTCHECK_RESULT", runId, index, result })
        .catch(() => {});
    });
    chrome.tabs.sendMessage(tabId, { type: "JC_FACTCHECK_DONE", runId }).catch(() => {});
  }
  return { ok: true, claims, results: verdicts, cached: true };
}

// Check a body of text end to end: pull the claims worth checking, then verify
// them concurrently, reporting each verdict to the page as it lands so a long
// article fills in progressively instead of blocking on the slowest claim.
//
// `url` opts this run into the shared cache. Callers that pass none — live
// audio, where the "text" is a rolling transcript rather than a stable
// document — go straight to the local path, which is correct: a transcript
// fragment isn't an article and must never be stored against a page URL.
async function factCheckText(text, tabId, runId, limit = 6, url = "", title = "") {
  if (url) {
    const hash = await factCheckContentHash(text).catch(() => null);
    if (hash) {
      const cached = await factCheckCacheRead(url, hash);
      if (cached) return factCheckDeliver(cached, tabId, runId);

      // Nothing cached. Let the server check it — that keeps the cost one call
      // per article rather than one per reader, and fills the cache for
      // everyone after. Falls through to the local path if it can't.
      const computed = await factCheckServerCheck(url, text, title);
      if (computed) return factCheckDeliver(computed, tabId, runId);
    }
  }

  return factCheckTextLocal(text, tabId, runId, limit);
}

// The original path: extract and verify here, on the reader's own key. Still
// the fallback whenever the shared cache is unavailable, and still what live
// audio uses.
async function factCheckTextLocal(text, tabId, runId, limit = 6) {
  const claims = await factCheckExtractClaims(text, limit);
  if (!claims.length) {
    return { ok: true, claims: [], results: [] };
  }
  if (tabId != null) {
    chrome.tabs
      .sendMessage(tabId, { type: "JC_FACTCHECK_CLAIMS", runId, claims })
      .catch(() => {});
  }

  const results = await Promise.all(
    claims.map(async (claim, index) => {
      // Verify the self-contained form; the verdict inherits the claim's quote
      // so the page can tie the ruling back to the exact sentence it underlined.
      const result = await factCheckOne(claim.claim, text).catch(() => null);
      if (result) result.quote = claim.quote;
      if (result && tabId != null) {
        chrome.tabs
          .sendMessage(tabId, { type: "JC_FACTCHECK_RESULT", runId, index, result })
          .catch(() => {});
      }
      return result;
    }),
  );

  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, { type: "JC_FACTCHECK_DONE", runId }).catch(() => {});
  }
  return { ok: true, claims, results: results.filter(Boolean) };
}
