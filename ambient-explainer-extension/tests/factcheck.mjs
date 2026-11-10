// The fact-check pipeline. Run with:
//   npm run test:factcheck          (pure logic only, offline)
//   FC_LIVE=1 npm run test:factcheck  (also hits the published-rulings proxy)
//
// Three things are worth pinning here, and none of them are style:
//   1. A publisher's own wording ("Pants on Fire", "Four Pinocchios") has to
//      land on the right verdict. Getting this wrong prints a confident FALSE
//      over a claim nobody ruled false.
//   2. factCheckLookup must distinguish "ran and found nothing" from "could not
//      run". Collapsing the two makes a broken proxy look like an unruled claim,
//      which is the failure mode a reader can never detect.
//   3. Model output is untrusted text. Both parsers must survive fences, prose
//      around the JSON, and shapes that are simply wrong, without throwing.
import fs from "node:fs";
import assert from "node:assert/strict";

const dir = new URL("../", import.meta.url);
const src = fs.readFileSync(new URL("factcheck.js", dir), "utf8");
const hostsSrc = fs.readFileSync(new URL("hosts.js", dir), "utf8");

function grab(text, name) {
  const start = text.search(new RegExp(`(async )?function ${name}\\(`));
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0, i = text.indexOf("{", start);
  for (; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) break; }
  }
  return text.slice(start, i + 1);
}

const verdictsTable = src.slice(src.indexOf("const FC_VERDICTS = ["), src.indexOf("];", src.indexOf("const FC_VERDICTS = [")) + 2);
const api = new Function(
  `${verdictsTable}\n` +
    ["factCheckRatingToVerdict", "factCheckParse", "factCheckParseClaims"].map((n) => grab(src, n)).join("\n") +
    "\nreturn { factCheckRatingToVerdict, factCheckParse, factCheckParseClaims, FC_VERDICTS };",
)();

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log("\nfact-check: publisher rating to verdict");
for (const [rating, want] of [
  ["Pants on Fire", "FALSE"],
  ["Four Pinocchios", "FALSE"],
  ["False", "FALSE"],
  ["Mostly False", "MOSTLY_FALSE"],
  ["Misleading", "FALSE"],
  ["Half True", "MIXED"],
  ["Missing context", "MIXED"],
  ["Mostly true", "MOSTLY_TRUE"],
  ["True", "TRUE"],
  ["Correct", "TRUE"],
  ["", "MIXED"],
  ["some wording nobody has ever used", "MIXED"],
]) {
  check(`"${rating}" -> ${want}`, () =>
    assert.equal(api.factCheckRatingToVerdict(rating), want));
}

console.log("\nfact-check: verdict parsing survives untrusted model output");
check("plain JSON", () => {
  const r = api.factCheckParse('{"verdict":"FALSE","confidence":"high","summary":"No.","sources":[{"title":"S","url":"https://a.com"}]}');
  assert.equal(r.verdict, "FALSE");
  assert.equal(r.sources.length, 1);
});
check("markdown fence and chatter around it", () => {
  const r = api.factCheckParse('Sure!\n```json\n{"verdict":"mostly true","confidence":"medium","summary":"Broadly."}\n```\nHope that helps');
  assert.equal(r.verdict, "MOSTLY_TRUE");
});
check("unknown verdict falls back to UNVERIFIABLE, never a guess", () =>
  assert.equal(api.factCheckParse('{"verdict":"PROBABLY_OK"}').verdict, "UNVERIFIABLE"));
check("bad confidence falls back to low", () =>
  assert.equal(api.factCheckParse('{"verdict":"TRUE","confidence":"certain"}').confidence, "low"));
check("non-http sources are dropped", () => {
  const r = api.factCheckParse('{"verdict":"TRUE","sources":[{"url":"javascript:alert(1)"},{"url":"https://ok.com"}]}');
  assert.deepEqual(r.sources.map((s) => s.url), ["https://ok.com"]);
});
check("sources capped at 6", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://s${i}.com` }));
  assert.equal(api.factCheckParse(JSON.stringify({ verdict: "TRUE", sources: many })).sources.length, 6);
});
check("garbage returns null rather than throwing", () => {
  assert.equal(api.factCheckParse("no json at all"), null);
  assert.equal(api.factCheckParse('{"verdict":'), null);
  assert.equal(api.factCheckParse(""), null);
});

console.log("\nfact-check: claim extraction parsing");
check("object form", () => {
  const c = api.factCheckParseClaims('[{"quote":"Unemployment fell to 3.4% in January.","claim":"Unemployment fell to 3.4% in January."}]', 6);
  assert.equal(c.length, 1);
  assert.equal(c[0].quote, "Unemployment fell to 3.4% in January.");
});
check("bare string form still tolerated", () => {
  const c = api.factCheckParseClaims('["The agency opened no inquiry since 2019."]', 6);
  assert.equal(c[0].claim, c[0].quote);
});
check("claims of 12 chars or fewer are dropped", () =>
  assert.equal(api.factCheckParseClaims('["too short","A properly long checkable claim here."]', 6).length, 1));
check("limit is respected", () => {
  const many = JSON.stringify(Array.from({ length: 30 }, (_, i) => `Claim number ${i} which is long enough to keep.`));
  assert.equal(api.factCheckParseClaims(many, 6).length, 6);
});
check("garbage returns [] rather than throwing", () => {
  assert.deepEqual(api.factCheckParseClaims("nope", 6), []);
  assert.deepEqual(api.factCheckParseClaims('{"not":"an array"}', 6), []);
});

console.log("\nfact-check: lookup separates 'found nothing' from 'could not run'");
check("empty query short-circuits as ok, not as failure", () => {
  assert.match(src, /if \(!query\) return \{ ok: true, results: \[\] \}/);
});
check("non-ok response reports ok:false", () => {
  assert.match(src, /if \(!res\.ok\)[\s\S]{0,200}return \{ ok: false, results: \[\] \}/);
});
check("network throw reports ok:false", () => {
  assert.match(src, /catch \(error\)[\s\S]{0,200}return \{ ok: false, results: \[\] \}/);
});
check("own Google key bypasses the proxy entirely", () => {
  assert.match(src, /const res = ownKey \? await fetch\(url\) : await jcBackendFetch\(url\)/);
});

// The live leg. Off by default so the suite stays offline and deterministic.
if (process.env.FC_LIVE) {
  console.log("\nfact-check: live published-rulings proxy");
  const hosts = JSON.parse(
    hostsSrc.slice(hostsSrc.indexOf("const JC_API_HOSTS = ["), hostsSrc.indexOf("]", hostsSrc.indexOf("const JC_API_HOSTS = [")) + 1)
      .replace("const JC_API_HOSTS = ", "")
      .replace(/,\s*\]/, "]"),
  );
  for (const host of hosts) {
    const q = encodeURIComponent("the great wall of china is visible from space");
    try {
      const res = await fetch(`${host}/factcheck/lookup?query=${q}`, { signal: AbortSignal.timeout(20000) });
      const body = await res.json();
      const reviews = (body.claims || []).flatMap((c) => c.claimReview || []);
      check(`${host} answers with rulings`, () => {
        assert.equal(res.status, 200);
        assert.ok(reviews.length > 0, "no claimReview entries came back");
        assert.ok(reviews[0].textualRating, "a ruling with no textualRating cannot be mapped");
      });
      if (reviews[0]) {
        console.log(`       ${reviews[0].publisher?.name}: "${reviews[0].textualRating}" -> ${api.factCheckRatingToVerdict(reviews[0].textualRating)}`);
      }
    } catch (e) {
      failed++;
      console.log(`  FAIL ${host} unreachable\n       ${e.message}`);
    }
  }
}

console.log(failed ? `\n${failed} failing\n` : "\nall passing\n");
process.exit(failed ? 1 : 0);
