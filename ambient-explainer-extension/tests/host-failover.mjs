// Mirror failover + the honest diagnosis. Run with:  npm run test:hosts
//
// WHY THIS IS TESTED HARD: the bug it fixes is invisible from the inside. A
// user on Charter/Spectrum Advanced WiFi (CUJO AI) has justclarify.xyz on a
// blocklist — port 80 answers a 302 to a block page, port 443 answers a
// non-TLS record — and from the extension that is indistinguishable from our
// servers being down. They were told "check your connection" while their
// connection was perfect, and the "Tell us about this error" link pointed at
// the very domain their router refuses to load.
//
// Everything below is the behaviour that must not silently regress:
//   - a blocked primary must reach a mirror, not an error card;
//   - a filter's own 200 HTML block page must count as a failure, because it
//     is not a refusal and never throws;
//   - a genuine 500 from OUR server must NOT be laundered into "blocked",
//     which would hide a real outage behind a network excuse;
//   - a working host must be remembered, or every request pays the block's
//     timeout again;
//   - "blocked" and "offline" must produce different words to the user.
//
// hosts.js is a plain script sharing one scope with the rest of the worker, so
// it is run in a vm context with chrome and fetch stubbed, exactly as it will
// run in the browser.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "hosts.js"), "utf8");

let failures = 0;
function check(ok, label, detail = "") {
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ------------------------------------------------------------------- harness

function reply(status, contentType, body = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body,
  };
}

// `routes` maps a hostname to what that host does: a reply, or a thrown error
// standing in for DNS failure / refused connection / a filter answering 443
// with a non-TLS record.
function makeContext(routes, { online = true } = {}) {
  const stored = {};
  const listeners = [];
  const calls = [];

  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    DOMException,
    AbortController,
    navigator: { onLine: online },
    chrome: {
      storage: {
        local: {
          get: async (keys) => {
            const out = {};
            for (const k of [].concat(keys)) if (k in stored) out[k] = stored[k];
            return out;
          },
          set: async (obj) => {
            Object.assign(stored, obj);
            const changes = {};
            for (const [k, v] of Object.entries(obj)) changes[k] = { newValue: v };
            for (const fn of listeners) fn(changes, "local");
          },
        },
        onChanged: { addListener: (fn) => listeners.push(fn) },
      },
    },
    fetch: async (url, options = {}) => {
      // The reachability probe is a different question from "can we reach a
      // JustClarify host", and answering it is the whole basis of the verdict.
      if (url.includes("gstatic.com/generate_204")) {
        if (!online) throw new Error("offline");
        return reply(204, "");
      }
      const host = new URL(url).origin;
      calls.push(host);
      const route = routes[host];
      if (typeof route === "function") return route(url, options);
      if (route instanceof Error) throw route;
      throw new Error(`no route for ${host}`);
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // Top-level const/function in a vm script land in the global LEXICAL scope,
  // not on the context object, so the epilogue hands them over explicitly.
  // Same file, same scope the service worker gives it — only the reach differs.
  vm.runInContext(
    `${source}\n;Object.assign(globalThis, { JC_HOSTS, JC_API_HOSTS, jcApiFetch, jcBackendFetch, jcSiteUrl, jcUnreachableMessage });`,
    ctx,
  );
  return { ctx, stored, calls };
}

const PRIMARY = "https://justclarify.xyz";
const MIRROR = "https://just-clarify.vercel.app";

// Storage is read asynchronously at load; let that settle before asserting.
const settle = () => new Promise((r) => setTimeout(r, 0));

// --------------------------------------------------------------------- tests

console.log("host failover");

// The declared hosts are the ones the manifest must allow, and a mirror on the
// same blocked domain would be no mirror at all.
{
  const { ctx } = makeContext({});
  check(ctx.JC_HOSTS[0] === PRIMARY, "primary host is the branded address");
  check(ctx.JC_HOSTS.length > 1, "a mirror exists at all");
  check(
    ctx.JC_HOSTS.slice(1).every((h) => !h.includes("justclarify.xyz")),
    "mirrors are on a different domain",
    "a filter blocks the DOMAIN, so a subdomain of it is not a fallback",
  );
  check(
    ctx.JC_API_HOSTS.slice(1).every((h) => !h.includes("justclarify.xyz")),
    "backend mirrors are on a different domain",
  );
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const allowed = manifest.host_permissions.join(" ");
  for (const host of [...ctx.JC_HOSTS, ...ctx.JC_API_HOSTS].slice(1)) {
    check(allowed.includes(host), `manifest permits ${host}`);
  }
  check(
    manifest.content_scripts[0].js.indexOf("hosts.js") <
      manifest.content_scripts[0].js.indexOf("content.js"),
    "hosts.js loads before content.js",
    "jcSiteUrl is called synchronously by the error card",
  );
}

// The happy path must not have grown a mirror hop.
{
  const { ctx, calls } = makeContext({ [PRIMARY]: () => reply(200, "application/json", "{}") });
  await settle();
  const res = await ctx.jcApiFetch("/api/explain", { method: "POST" });
  check(res.status === 200, "primary answers");
  check(calls.length === 1 && calls[0] === PRIMARY, "mirror untouched when primary works");
}

// The reported bug: TLS refused by a filter. fetch throws, and the mirror must
// carry the request rather than the user getting an error card.
{
  const { ctx, calls, stored } = makeContext({
    [PRIMARY]: new Error("wrong version number"),
    [MIRROR]: () => reply(200, "application/json", "{}"),
  });
  await settle();
  const res = await ctx.jcApiFetch("/api/explain", { method: "POST" });
  check(res.status === 200, "blocked primary falls through to the mirror");
  check(calls.join(",") === `${PRIMARY},${MIRROR}`, "primary is tried first, then the mirror");
  check(stored.jcHostBest === MIRROR, "the working host is remembered");
}

// A remembered mirror must be tried FIRST next time. Without this every single
// ask on a filtered network pays the block's timeout before doing anything.
{
  const { ctx, calls } = makeContext({
    [PRIMARY]: new Error("wrong version number"),
    [MIRROR]: () => reply(200, "application/json", "{}"),
  });
  await settle();
  await ctx.jcApiFetch("/api/explain", {});
  calls.length = 0;
  await ctx.jcApiFetch("/api/explain", {});
  check(calls[0] === MIRROR, "remembered host goes first on the next request");
  check(calls.length === 1, "and the blocked primary is not retried");
}

// The nastier filter: it terminates TLS with its own certificate and answers
// 200 with an HTML block page. Nothing throws. Without this check the HTML
// reaches a JSON parse and surfaces as gibberish.
{
  const { ctx, calls } = makeContext({
    [PRIMARY]: () => reply(200, "text/html; charset=utf-8", "<html>Blocked by CUJO</html>"),
    [MIRROR]: () => reply(200, "application/json", "{}"),
  });
  await settle();
  const res = await ctx.jcApiFetch("/api/explain", {});
  check(res.status === 200, "an HTML block page is treated as a failure");
  check(calls.join(",") === `${PRIMARY},${MIRROR}`, "and the mirror is used instead");
}

// The mirror image of that, and the one that would be a regression: our own
// server having a genuine 500 must stay a 500. Laundering it into "your
// network is blocking us" hides an outage behind an excuse.
{
  const { ctx, calls } = makeContext({
    [PRIMARY]: () => reply(500, "text/html", "<html>500</html>"),
    [MIRROR]: () => reply(200, "application/json", "{}"),
  });
  await settle();
  const res = await ctx.jcApiFetch("/api/explain", {});
  check(res.status === 500, "a real 500 is returned, not routed around");
  check(calls.length === 1, "and the mirror is not consulted for it");
}

console.log("diagnosis");

// Every host down, but the internet is fine: that is a block, and it must say
// so. This is the sentence the user was owed and did not get.
{
  const { ctx } = makeContext(
    { [PRIMARY]: new Error("blocked"), [MIRROR]: new Error("blocked") },
    { online: true },
  );
  await settle();
  let error;
  try {
    await ctx.jcApiFetch("/api/explain", {});
  } catch (e) {
    error = e;
  }
  check(error?.blocked === true, "all hosts down + internet up = blocked");
  const message = ctx.jcUnreachableMessage(error);
  check(/network is blocking/i.test(message), "the message names the network as the cause");
  check(
    !/check your connection/i.test(message),
    "and does NOT tell someone with a working connection to check it",
  );
  check(/own AI key/i.test(message), "and still offers the way out that works today");
}

// Genuinely offline: the old wording is the right wording.
{
  const { ctx } = makeContext(
    { [PRIMARY]: new Error("offline"), [MIRROR]: new Error("offline") },
    { online: false },
  );
  await settle();
  let error;
  try {
    await ctx.jcApiFetch("/api/explain", {});
  } catch (e) {
    error = e;
  }
  check(error?.blocked === false, "all hosts down + internet down = not blocked");
  check(/check your connection/i.test(ctx.jcUnreachableMessage(error)), "offline says so plainly");
}

console.log("links");

// A link to a domain the user's router refuses is a second dead end stapled to
// the first. The report page has to follow the mirror.
{
  const { ctx } = makeContext({
    [PRIMARY]: new Error("blocked"),
    [MIRROR]: () => reply(200, "application/json", "{}"),
  });
  await settle();
  check(ctx.jcSiteUrl("/tellme").startsWith(PRIMARY), "unproven networks get the branded address");
  await ctx.jcApiFetch("/api/explain", {});
  check(
    ctx.jcSiteUrl("/tellme") === `${MIRROR}/tellme`,
    "once the primary is known blocked, links point at the mirror",
  );
  check(ctx.jcSiteUrl("tellme") === `${MIRROR}/tellme`, "a missing leading slash is tolerated");
}

// Callers that abort (a voice command that gave up) must not have the mirror
// tried on their behalf after they stopped caring.
{
  const controller = new AbortController();
  const { ctx, calls } = makeContext({
    [PRIMARY]: async () => {
      controller.abort();
      throw new Error("aborted");
    },
    [MIRROR]: () => reply(200, "application/json", "{}"),
  });
  await settle();
  let error;
  try {
    await ctx.jcApiFetch("/api/explain", { signal: controller.signal });
  } catch (e) {
    error = e;
  }
  check(error?.name === "AbortError", "a caller abort surfaces as AbortError");
  check(!calls.includes(MIRROR), "and stops the walk instead of continuing to the mirror");
}

// -------------------------------------------------------------------- report

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall host-failover tests passed");
