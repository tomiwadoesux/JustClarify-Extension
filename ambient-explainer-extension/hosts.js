// hosts.js — one place that knows where JustClarify lives, and what to do when
// that address is unreachable.
//
// WHY THIS FILE EXISTS: justclarify.xyz is a .xyz, and consumer network
// filters treat cheap TLDs as guilty until proven innocent. Charter/Spectrum's
// Advanced WiFi (CUJO AI) blocks it outright: port 80 is answered with a 302
// to block.charter-prod.hosted.cujo.io, and port 443 is answered with a
// non-TLS record, so fetch() rejects before a single byte of ours is sent.
// School and corporate filters using the same category feeds behave the same
// way. From inside the extension this is indistinguishable from our servers
// being down, and the user was told to "check your connection" while their
// connection was fine.
//
// Two answers, both here:
//   1. MIRRORS. The same deployment answers on a second hostname that is not a
//      .xyz. A blocklist entry is per-domain, so the mirror walks straight
//      through the filter that stopped the primary.
//   2. AN HONEST DIAGNOSIS. When every host fails but the rest of the internet
//      is reachable, that is not an outage and must not be reported as one.
//
// Loaded FIRST in background.js importScripts and FIRST in the content_scripts
// list, because hosted.js, factcheck.js, content.js and voice.js all ask it
// where to go.

// Primary first: it is the branded address, it is what the popup shows, and on
// the overwhelming majority of networks it works. Mirrors exist for the
// minority whose network has decided otherwise.
const JC_HOSTS = ["https://justclarify.xyz", "https://just-clarify.vercel.app"];

// The fact-check backend is a separate deployment on its own hostname, with
// its own mirror. Same rule, same reason.
const JC_API_HOSTS = [
  "https://api.justclarify.xyz",
  "https://just-clarify-extension-bckend.vercel.app",
];

const JC_HOST_KEY = "jcHostBest";
const JC_API_HOST_KEY = "jcApiHostBest";

// A host that worked is worth remembering: on a filtered network EVERY request
// would otherwise pay the primary's timeout before reaching the mirror, and
// that is the difference between an answer and a user who gave up. Kept in a
// plain variable as well as storage so the URL builders below can stay
// synchronous, which is what their callers already are.
let jcHostBestCached = null;
let jcApiHostBestCached = null;

function jcHostValid(host, list) {
  return typeof host === "string" && list.includes(host);
}

// Fire and forget at load; the first ask may still race it, and that is fine
// because the ordering below falls back to the declared order.
chrome.storage.local
  .get([JC_HOST_KEY, JC_API_HOST_KEY])
  .then((res) => {
    if (jcHostValid(res[JC_HOST_KEY], JC_HOSTS)) jcHostBestCached = res[JC_HOST_KEY];
    if (jcHostValid(res[JC_API_HOST_KEY], JC_API_HOSTS)) {
      jcApiHostBestCached = res[JC_API_HOST_KEY];
    }
  })
  .catch(() => {});

// Every surface learns the moment any one of them finds a working host, so a
// popup opened after a content script recovered does not repeat the search.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[JC_HOST_KEY] && jcHostValid(changes[JC_HOST_KEY].newValue, JC_HOSTS)) {
    jcHostBestCached = changes[JC_HOST_KEY].newValue;
  }
  if (changes[JC_API_HOST_KEY] && jcHostValid(changes[JC_API_HOST_KEY].newValue, JC_API_HOSTS)) {
    jcApiHostBestCached = changes[JC_API_HOST_KEY].newValue;
  }
});

function jcHostOrder(list, best) {
  return best ? [best, ...list.filter((h) => h !== best)] : [...list];
}

function jcHostRemember(list, key, host) {
  if (list === JC_HOSTS) jcHostBestCached = host;
  else jcApiHostBestCached = host;
  chrome.storage.local.set({ [key]: host }).catch(() => {});
}

// The address to put in front of a person: a link they click, not a fetch.
// Uses whichever host last worked, because handing someone a link to a domain
// their own router blocks is how a broken feature becomes a broken bug report.
function jcSiteUrl(path) {
  const host = jcHostBestCached || JC_HOSTS[0];
  return `${host}${path.startsWith("/") ? path : `/${path}`}`;
}

// A filter that terminates TLS with its own certificate does not reject the
// fetch: it answers 200 with an HTML block page. That is worse than a refusal,
// because the JSON parse fails somewhere downstream and the error surfaces as
// nonsense. An HTML body where the caller asked for JSON or SSE is never us.
//
// Deliberately limited to SUCCESSFUL responses. Our own routes answer errors in
// JSON, but the platform underneath can answer a genuine 500 or 404 in HTML,
// and walking away from that to a mirror would turn a real outage into a false
// "your network is blocking us" — the exact misdiagnosis this file exists to
// end, pointed the other way.
function jcHostHijacked(response) {
  if (!response.ok) return false;
  const type = response.headers.get("content-type") || "";
  return type.includes("text/html");
}

// The failure this whole file is about, raised only once every host is spent.
class JcUnreachableError extends Error {
  constructor(blocked) {
    super(blocked ? "JC_HOSTS_BLOCKED" : "JC_HOSTS_UNREACHABLE");
    this.name = "JcUnreachableError";
    // true  -> the internet is fine and something is refusing US specifically
    // false -> the machine has no working connection at all
    this.blocked = blocked;
  }
}

// Is it us, or is it them? Asked only after every host has failed, so the cost
// lands on a path that is already lost. navigator.onLine alone is not enough:
// it reports the link, not the route, and a filtered network is very much
// "online". A HEAD to a neutral, universally-allowed endpoint settles it.
async function jcInternetReachable() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      // no-cors: the answer is opaque, and that is all this needs. A resolved
      // promise means packets went out and came back.
      await fetch("https://www.gstatic.com/generate_204", {
        method: "HEAD",
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal,
      });
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch (_) {
    return false;
  }
}

async function jcTryHosts(list, key, path, options = {}, ms) {
  const order = jcHostOrder(list, list === JC_HOSTS ? jcHostBestCached : jcApiHostBestCached);
  const { signal: callerSignal, ...rest } = options;

  // A caller that already gave up wants nothing tried, mirror included.
  if (callerSignal?.aborted) throw new DOMException("Aborted", "AbortError");

  for (const host of order) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms || 30_000);
    const relay = () => controller.abort();
    callerSignal?.addEventListener("abort", relay);
    try {
      const response = await fetch(`${host}${path}`, {
        ...rest,
        signal: controller.signal,
      });
      // Reached something, but not us. Keep walking.
      if (jcHostHijacked(response)) continue;
      jcHostRemember(list, key, host);
      return response;
    } catch (_) {
      // DNS failure, refused connection, a filter answering 443 with a non-TLS
      // record, or our own timeout. All of them mean: try the next address.
      if (callerSignal?.aborted) throw new DOMException("Aborted", "AbortError");
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", relay);
    }
  }

  // Nothing answered. The distinction that matters to the user is whether the
  // rest of the web works, so that is the one question asked before giving up.
  throw new JcUnreachableError(await jcInternetReachable());
}

// The two entry points. Same signature as a bare fetch, minus the origin.
function jcApiFetch(path, options, ms) {
  return jcTryHosts(JC_HOSTS, JC_HOST_KEY, path, options, ms);
}

function jcBackendFetch(path, options, ms) {
  return jcTryHosts(JC_API_HOSTS, JC_API_HOST_KEY, path, options, ms);
}

// The wording. Kept here so every surface says the same true thing, and so the
// blocked case never masquerades as an outage or as the user's fault.
function jcUnreachableMessage(error) {
  if (error instanceof JcUnreachableError && error.blocked) {
    return (
      "Your network is blocking JustClarify. The rest of the internet is reachable, so this is " +
      "a filter on your router, school or workplace, not an outage. Try another network, or " +
      "add your own AI key in the popup to answer without our servers."
    );
  }
  return (
    "JustClarify couldn't reach its own AI service. Check your connection, or add your own AI " +
    "key in the popup to answer through that instead."
  );
}
