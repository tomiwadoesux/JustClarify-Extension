// Shared gate for the JustClarify extension's hosted endpoints.
//
// Every route here spends the project's own AI_GATEWAY_API_KEY on behalf of
// installs that have no key of their own, so all of them need the same things:
// only our extension may call them, no single install may run away with the
// bill, and the upstream provider's error text must never reach the client.
//
// Counting is DURABLE (Supabase, one row per install/scope/day) with the old
// in-memory maps kept as the fallback when the database is unreachable —
// fail-open on infra trouble, never fail-closed. Only burst limiting stays
// purely in-memory: per-minute abuse is per-instance by nature and not worth
// a database round trip.
//
// The same daily counter serves two thresholds:
//   - the abuse quota (perDay), which has always been here, and
//   - the paywall meter: when JC_PAYWALL=on, an install that has spent its
//     JC_FREE_USES lifetime allowance on the 'explain' scope gets a 402.
//     OFF by default, deliberately — flipping it on before a way to pay
//     exists would brick the product, not monetise it.

// The allowlist is a SENSITIVE env var, which means it cannot be read back
// once set — not by the dashboard, not by `vercel env pull`. So a value with a
// stray quote, or written as a full chrome-extension:// origin instead of a
// bare id, is invisible: every request 403s and the only way to find out is to
// probe the endpoint from outside. That happened. Hence both defences below —
// entries are normalised to bare ids, and a refusal says why in the logs.
const ALLOWED_IDS = (process.env.JC_EXTENSION_IDS || '')
  .split(',')
  .map((id) =>
    id
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .replace(/^chrome-extension:\/\//, '')
      .replace(/\/$/, '')
      .trim(),
  )
  .filter(Boolean);

const PAYWALL_ON = process.env.JC_PAYWALL === 'on';
const FREE_USES = Math.max(1, Number(process.env.JC_FREE_USES) || 30);
const PRICE_LINE = 'JustClarify is $3.99/month past the free asks — or add your own AI key in the popup for unlimited use.';

export function originAllowed(origin) {
  if (!origin || !origin.startsWith('chrome-extension://')) return false;
  // An unset allowlist is fine locally and an open faucet in production, so it
  // only ever passes outside production.
  if (!ALLOWED_IDS.length) return process.env.NODE_ENV !== 'production';
  const allowed = ALLOWED_IDS.some((id) => origin === `chrome-extension://${id}`);
  if (!allowed) logRefusal(origin);
  return allowed;
}

// A refused install is indistinguishable from an outage on the client — the
// user sees "this endpoint only serves the JustClarify extension" whether the
// caller is a stranger or the real extension against a mistyped allowlist. One
// log line per distinct id, so a genuinely broken deploy is greppable without
// a stranger's traffic being able to flood the logs.
const refusalsSeen = new Set();

function logRefusal(origin) {
  const id = origin.slice('chrome-extension://'.length);
  if (refusalsSeen.has(id) || refusalsSeen.size > 200) return;
  refusalsSeen.add(id);
  console.warn(
    `[api-guard] refused extension id ${id}; JC_EXTENSION_IDS holds ${ALLOWED_IDS.length} id(s)` +
      `${ALLOWED_IDS.length ? ` starting ${ALLOWED_IDS.map((i) => i.slice(0, 6)).join(',')}` : ''}`,
  );
}

export function cors(origin, extraHeaders = 'content-type, x-jc-install') {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': extraHeaders,
    'Access-Control-Max-Age': '86400',
    // Without this the extension can see the meter headers exist but not read
    // them — CORS hides non-safelisted response headers by default.
    'Access-Control-Expose-Headers': 'x-jc-free-left, x-jc-free-total',
    Vary: 'Origin',
  };
}

// The install id is a bucket key, never an identity: random, client-generated,
// never joined to anything else. One that looks forged shares a bucket keyed
// by IP rather than being handed a fresh allowance.
export function installKey(request) {
  const raw = String(request.headers.get('x-jc-install') || '').trim();
  if (/^[a-zA-Z0-9-]{16,64}$/.test(raw)) return raw;
  const forwarded = request.headers.get('x-forwarded-for') || '';
  return `anon:${forwarded.split(',')[0].trim() || 'unknown'}`;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

// Burst limiting — in-memory on purpose (see header).
const bursts = new Map(); // `${scope}:${install}` -> number[]

function burstLimited(scope, install, perMinute) {
  const key = `${scope}:${install}`;
  const now = Date.now();
  const hits = (bursts.get(key) || []).filter((t) => now - t < MINUTE);
  hits.push(now);
  bursts.set(key, hits);

  if (bursts.size > 20_000) {
    for (const [k, times] of bursts) {
      if (!times.some((t) => now - t < MINUTE)) bursts.delete(k);
    }
  }
  return hits.length > perMinute;
}

// In-memory daily fallback for when Supabase is unreachable.
const fallbackDaily = new Map(); // `${scope}:${install}` -> { count, resetAt }

function fallbackCount(scope, install) {
  const key = `${scope}:${install}`;
  const now = Date.now();
  const entry = fallbackDaily.get(key);
  if (!entry || now > entry.resetAt) {
    fallbackDaily.set(key, { count: 1, resetAt: now + DAY });
    return { dayCount: 1, lifetimeCount: null }; // lifetime unknowable here
  }
  entry.count += 1;
  return { dayCount: entry.count, lifetimeCount: null };
}

// One durable increment per allowed request. Returns today's count and the
// lifetime count for this install+scope, or falls back to memory on any
// database trouble.
async function countUse(scope, install) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return fallbackCount(scope, install);

  try {
    const response = await fetch(`${url}/rest/v1/rpc/jc_increment_usage`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_install: install, p_scope: scope }),
      // A metering hiccup must never hold a user's answer hostage.
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return fallbackCount(scope, install);
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row || typeof row.day_count !== 'number') return fallbackCount(scope, install);
    return { dayCount: row.day_count, lifetimeCount: Number(row.lifetime_count) };
  } catch (_) {
    return fallbackCount(scope, install);
  }
}

// One place that decides whether a request may proceed, so a new route can't
// accidentally ship without a limiter. Returns { headers, reject } — reject is
// a ready-to-send Response, or null to carry on.
export async function guard(request, { scope, perMinute, perDay, allowHeaders, metered }) {
  const origin = request.headers.get('origin');
  const headers = { ...cors(origin, allowHeaders), 'content-type': 'application/json' };

  if (!originAllowed(origin)) {
    return {
      headers,
      reject: Response.json(
        { error: 'This endpoint only serves the JustClarify extension.' },
        { status: 403, headers },
      ),
    };
  }

  const install = installKey(request);

  if (burstLimited(scope, install, perMinute)) {
    return {
      headers,
      reject: Response.json(
        { error: 'Slow down a moment — too many requests at once.' },
        { status: 429, headers },
      ),
    };
  }

  const { dayCount, lifetimeCount } = await countUse(scope, install);

  // The paywall meter. Only metered scopes count against the free allowance —
  // transcription and speech ride along with an explain that already counted.
  if (PAYWALL_ON && metered && lifetimeCount != null && lifetimeCount > FREE_USES) {
    return {
      headers,
      reject: Response.json({ error: PRICE_LINE, paywall: true }, { status: 402, headers }),
    };
  }

  if (dayCount > perDay) {
    return {
      headers,
      reject: Response.json(
        {
          error:
            "That's today's allowance used up. Add your own AI key in the popup for unlimited use.",
        },
        { status: 429, headers },
      ),
    };
  }

  // Surfaced so the extension can warn before the wall instead of at it —
  // always, not only when the wall is armed: the "10 of 30 used" nudge runs
  // ahead of payments existing.
  if (metered && lifetimeCount != null) {
    headers['x-jc-free-left'] = String(Math.max(0, FREE_USES - lifetimeCount));
    headers['x-jc-free-total'] = String(FREE_USES);
  }

  return { headers, reject: null };
}
