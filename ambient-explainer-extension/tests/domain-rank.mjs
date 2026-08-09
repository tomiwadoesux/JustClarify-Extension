// Spoken brand -> real domain, via Cloudflare Radar's ranking. Run with:
//   npm run test:domain
//
// This is the layer that replaced "append .com and hope". It is worth testing
// hard because both of its failure modes are silent and both are worse than
// the guess it replaced:
//
//   - too eager, and "go to the pricing section" opens pricing.parts;
//   - too literal, and "open google" opens google.ca, because the ranking
//     buckets are UNORDERED and google.ca happened to come first in the file.
//
// Both were real outputs of the first version, caught by running the index over
// the live dataset. The rules that fixed them are asserted below, against a
// fixture rather than the network so this stays deterministic.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const route = readFileSync(join(root, "..", "app", "api", "domain", "route.js"), "utf8");
const background = readFileSync(join(root, "background.js"), "utf8");
const commands = readFileSync(join(root, "commands.js"), "utf8");

let failures = 0;
function check(ok, label, detail = "") {
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------- extraction

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  let depth = 0;
  let i = source.indexOf("{", start);
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) break;
  }
  return source.slice(start, i + 1);
}

function extractConst(source, name) {
  const start = source.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`const ${name} not found`);
  let depth = 0;
  let quote = "";
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === ";" && depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`const ${name} unterminated`);
}

// The route's real logic, rebuilt here. Extracted rather than reimplemented so
// the test cannot pass while the route drifts underneath it.
const build = eval(`(() => {
  ${extractConst(route, "MULTI_SUFFIX")}
  ${extractConst(route, "SUFFIX_RANK")}
  ${extractConst(route, "suffixRank")}
  ${extractFunction(route, "splitHost")}
  return { splitHost, suffixRank };
})()`);

// ------------------------------------------------------------ brand splitting

// Depth counts the labels ABOVE the suffix, so every apex is 1 whatever its
// suffix is made of — which is the point: bbc.co.uk has to compare as an apex
// against google.com, not as a subdomain.
//
// [host, brand, depth]
const SPLITS = [
  ["notion.so", "notion", 1],
  ["claude.ai", "claude", 1],
  ["google.com", "google", 1],
  // Without a multi-label suffix list this reads as the brand "co", which is
  // nonsense and would collide with every .co.uk domain there is.
  ["bbc.co.uk", "bbc", 1],
  ["amazon.co.uk", "amazon", 1],
  // A subdomain keeps its parent's brand and a deeper depth, so the apex wins.
  ["maps.google.com", "google", 2],
  ["news.ycombinator.com", "ycombinator", 2],
];
for (const [host, brand, depth] of SPLITS) {
  const got = build.splitHost(host);
  check(got.brand === brand, `${host} belongs to "${brand}"`, `got "${got.brand}"`);
  check(got.depth === depth, `${host} has depth ${depth}`, `got ${got.depth}`);
}

// The property those depths exist for, stated directly.
check(
  build.splitHost("bbc.co.uk").depth === build.splitHost("google.com").depth,
  "an apex under a multi-label suffix ranks as an apex",
);
check(
  build.splitHost("www.bbc.co.uk").depth > build.splitHost("bbc.co.uk").depth,
  "…and its own subdomain still ranks below it",
);

// ------------------------------------------------------------- the tie-break

// Buckets are unordered, so within one tier there is no popularity signal at
// all — file order decides unless something else does. These are the pairs
// that made the first version send people to the wrong place.
check(build.suffixRank("com") < build.suffixRank("ca"), "google.com beats google.ca");
check(build.suffixRank("com") < build.suffixRank("app"), "vercel.com beats vercel.app");
check(build.suffixRank("com") < build.suffixRank("co"), "a .com apex beats a .co of the same brand");
check(build.suffixRank("org") < build.suffixRank("app"), "arxiv.org beats an .app of the same name");
// An unknown suffix must lose to every known one rather than sorting randomly.
check(build.suffixRank("zzz") > build.suffixRank("dev"), "an unrecognised suffix ranks last");

// Replaying the route's own comparison over a fixture shaped like the real
// data: the same brand appearing several times, in and across tiers.
function bestFor(rows) {
  let held = null;
  for (const [host, tier] of rows) {
    const { suffix, depth } = build.splitHost(host);
    const rank = build.suffixRank(suffix);
    const better =
      !held ||
      tier < held.tier ||
      (tier === held.tier && depth < held.depth) ||
      (tier === held.tier && depth === held.depth && rank < held.rank) ||
      (tier === held.tier && depth === held.depth && rank === held.rank && host.length < held.host.length);
    if (better) held = { host, tier, depth, rank };
  }
  return held.host;
}

// ccTLD noise listed FIRST, which is the order that used to win.
check(bestFor([["google.ca", 0], ["google.de", 0], ["google.com", 0]]) === "google.com",
  "the .com wins however late it appears in the file");
check(bestFor([["vercel.app", 1], ["vercel.com", 1]]) === "vercel.com",
  "a marketing site beats its own deployment domain");
check(bestFor([["maps.google.com", 0], ["google.com", 0]]) === "google.com",
  "the apex beats its own subdomain");
// A brand whose only home is not a .com must survive all of the above.
check(bestFor([["claude.ai", 0]]) === "claude.ai", "a brand with no .com keeps its real suffix");
check(bestFor([["supabase.co", 0]]) === "supabase.co", "…including a .co");
check(bestFor([["bit.ly", 1]]) === "bit.ly", "…and a .ly");
// A more popular bucket always outranks suffix preference.
check(bestFor([["example.com", 1], ["example.ai", 0]]) === "example.ai",
  "popularity outranks suffix preference across tiers");

// ------------------------------------------------------- the eagerness floor

// Only the top two buckets are indexed, and that is the guard against common
// English words. Below ten thousand the ranking contains pricing.parts,
// about.me and contact.bg — every one of them a plausible thing to say to a
// page, none of them a place to be sent.
const buckets = extractConst(route, "BUCKETS");
check(/ranking_top_1000'/.test(buckets), "the top 1000 bucket is indexed");
check(/ranking_top_10000'/.test(buckets), "the top 10000 bucket is indexed");
check(
  !/ranking_top_100000/.test(buckets),
  "nothing below the top 10000 is indexed",
  "pricing.parts and about.me live down there",
);

// ------------------------------------------------------------ the token line

// The whole reason this is a server route. An extension bundle is a zip.
check(
  /process\.env\.CLOUDFLARE_RADAR_TOKEN/.test(route),
  "the route reads the token from the environment",
);
check(
  !/cfut_/.test(route) && !/cfut_/.test(background) && !/cfut_/.test(commands),
  "no Radar token is hardcoded anywhere",
);
check(
  !/api\.cloudflare\.com/.test(background),
  "the extension never calls Cloudflare directly",
  "that would ship the token to every install",
);
check(
  /justclarify\.xyz\/api\/domain/.test(background),
  "the extension goes through the server instead",
);

// ------------------------------------------------------------ the fallbacks

// Radar is one of three sources and the middle one. History is a record of
// where this user goes; the model's sound-alike is a hypothesis. Radar sits
// between them, and none of the three may be skipped when it fails.
const lookup = background.slice(
  background.indexOf("JC_VOICE_SITE_LOOKUP"),
  background.indexOf("JC_VOICE_SITE_LOOKUP") + 900,
);
check(
  lookup.indexOf("voiceSiteLookup") < lookup.indexOf("voiceSiteFromRadar"),
  "history is asked before the global ranking",
);
check(
  lookup.indexOf("voiceSiteFromRadar") < lookup.indexOf("voiceSiteFromSpeech"),
  "the global ranking is asked before the model guesses",
);
check(
  /unconfigured|host: null/.test(route),
  "an unconfigured token answers 'I don't know' rather than failing",
);
check(
  /found\.ranked && found\.tier > 0/.test(commands),
  "a ranking hit outside the top 1000 asks before navigating",
);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("domain-rank OK");
