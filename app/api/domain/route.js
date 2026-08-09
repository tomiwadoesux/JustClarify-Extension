// Turn a spoken brand name into the domain that brand actually uses.
//
// The problem: voice heard "open supabase" and had exactly one way to turn that
// into an address — append ".com". Measured against Cloudflare's ranking, that
// guess is wrong for 42% of the brands in it. supabase.co, huggingface.co,
// arxiv.org, bit.ly, claude.ai — every one of them a site people ask for out
// loud, every one of them somewhere ".com" never reaches.
//
// The data is Cloudflare Radar's domain ranking, built from DNS queries to
// 1.1.1.1. THE TOKEN LIVES HERE AND ONLY HERE. An extension bundle is a zip
// anyone can unpack, so a Radar token shipped inside one is a token being spent
// by strangers within days — the same reasoning that put the AI key behind
// /api/explain rather than in the extension.
//
// Extension -> here:  POST { brand: "supabase" }, header x-jc-install
// here -> extension:  { host: "supabase.co", tier: 0 } | { host: null }
//
// `tier` is how sure we are: 0 means the domain is in the top thousand on the
// internet, 1 means the top ten thousand. The extension navigates straight
// through on 0 and asks first on 1.

import { guard, cors } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RADAR = 'https://api.cloudflare.com/client/v4/radar/datasets';

// Only the two most popular buckets, and that is a CORRECTNESS decision rather
// than a bandwidth one. Below the top ten thousand the index fills up with
// domains that merely spell a common English word — pricing.parts, about.me,
// contact.bg — and "go to the pricing section" landing on pricing.parts is a
// worse failure than admitting we don't know. Together they are ~145KB.
const BUCKETS = [
  ['ranking_top_1000', 0],
  ['ranking_top_10000', 1],
];

// Enough of the public suffix list to keep a brand attached to its own name.
// Without it "bbc.co.uk" reads as the brand "co", which is nonsense.
const MULTI_SUFFIX = new Set([
  'co.uk', 'co.jp', 'com.au', 'co.za', 'com.br', 'com.ng', 'co.nz', 'co.in',
  'org.uk', 'ac.uk', 'gov.uk', 'com.mx', 'co.kr',
]);

// A brand's real home is far more often .com than its busiest
// subdomain-of-convenience. This is what stops google.ca outranking google.com
// and vercel.app outranking vercel.com: the ranking buckets are UNORDERED, so
// within one bucket there is no popularity signal to break the tie with, and
// without this the answer is whichever line happened to come first.
const SUFFIX_RANK = { com: 0, org: 1, net: 2, ai: 3, io: 3, co: 4, app: 5, dev: 5 };
const suffixRank = (suffix) => (suffix in SUFFIX_RANK ? SUFFIX_RANK[suffix] : 8);

function splitHost(host) {
  const labels = host.split('.');
  if (labels.length >= 3 && MULTI_SUFFIX.has(labels.slice(-2).join('.'))) {
    return {
      brand: labels[labels.length - 3],
      suffix: labels.slice(-2).join('.'),
      depth: labels.length - 2,
    };
  }
  return {
    brand: labels[labels.length - 2],
    suffix: labels[labels.length - 1],
    depth: labels.length - 1,
  };
}

// One index per instance, rebuilt daily. Fluid Compute reuses instances, so in
// practice this is built once and answers thousands of lookups.
let cache = null; // { at: number, index: Map }
const TTL_MS = 24 * 60 * 60 * 1000;

async function fetchBucket(alias, token) {
  const response = await fetch(`${RADAR}/${alias}`, {
    headers: { Authorization: `Bearer ${token}` },
    // Radar regenerates these weekly; a day-old copy is always fine.
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Radar ${alias} responded ${response.status}`);
  return response.text();
}

async function buildIndex(token) {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.index;

  const index = new Map(); // brand -> { host, tier, depth, rank }

  for (const [alias, tier] of BUCKETS) {
    const body = await fetchBucket(alias, token);
    for (const line of body.split('\n')) {
      const host = line.trim().toLowerCase();
      // The stream is a CSV with a "domain" header row.
      if (!host || host === 'domain' || !host.includes('.')) continue;

      const { brand, suffix, depth } = splitHost(host);
      // Single letters are never what someone says, and they collide with
      // everything.
      if (!brand || brand.length < 2) continue;

      const rank = suffixRank(suffix);
      const held = index.get(brand);
      const better =
        !held ||
        tier < held.tier ||
        // An apex domain beats a subdomain of the same brand at the same tier.
        (tier === held.tier && depth < held.depth) ||
        (tier === held.tier && depth === held.depth && rank < held.rank) ||
        (tier === held.tier && depth === held.depth && rank === held.rank && host.length < held.host.length);
      if (better) index.set(brand, { host, tier, depth, rank });
    }
  }

  cache = { at: Date.now(), index };
  return index;
}

export async function OPTIONS(request) {
  // cors() only — a preflight must never count against anyone's meter.
  return new Response(null, { status: 204, headers: cors(request.headers.get('origin')) });
}

export async function POST(request) {
  // Not metered: this spends no AI budget, only a cached lookup. It still needs
  // the origin check and a rate limit, which is what guard() is for.
  const { headers, reject } = await guard(request, { scope: 'domain', perMinute: 30, perDay: 500 });
  if (reject) return reject;

  let brand;
  try {
    const body = await request.json();
    brand = String(body.brand || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 40);
  } catch (_) {
    return Response.json({ error: 'Bad request.' }, { status: 400, headers });
  }

  if (brand.length < 2) return Response.json({ host: null }, { headers });

  const token = process.env.CLOUDFLARE_RADAR_TOKEN;
  // Unconfigured is not an error the user should ever see: the extension has a
  // history lookup and a confirmed guess behind this, and both still work.
  if (!token) return Response.json({ host: null, unconfigured: true }, { headers });

  try {
    const index = await buildIndex(token);
    const hit = index.get(brand);
    if (!hit) return Response.json({ host: null }, { headers });
    return Response.json({ host: hit.host, tier: hit.tier }, { headers });
  } catch (error) {
    // Radar down, token rolled, network trouble — all the same to the CALLER.
    // Answering "I don't know" lets the extension fall through to what it did
    // before this route existed, which is the right behaviour for the user.
    //
    // It is the wrong behaviour for whoever runs this, though: a token that
    // 401s makes the feature quietly do nothing, forever, with nothing on
    // screen to say so. This route was written against a token restricted by
    // client IP, which worked from a laptop and would have returned 401 from
    // every Vercel region — invisible without this line.
    console.error('[domain] Radar lookup failed:', error && error.message);
    return Response.json({ host: null }, { headers });
  }
}
