// The user's own API key, sent to the company it belongs to. Run with:
//   npm run test:providers
//
// The key slot used to accept only a Vercel AI Gateway key. Now it takes the
// key the user actually has — Anthropic, OpenAI, Gemini, Hugging Face, or a
// Gateway key — detects whose it is from the prefix, and calls that provider
// directly. Two invariants here are safety, not style:
//   1. gateway.js must REFUSE a non-Gateway key: an Anthropic key sent to
//      ai-gateway.vercel.sh in a Bearer header is a leak to a third party.
//   2. Only a 401/403 may blame the key. Everything else must say what
//      actually happened — the "your API is not connected (it was)" bug.
import fs from "node:fs";

const dir = new URL("../", import.meta.url);
const providers = fs.readFileSync(new URL("providers.js", dir), "utf8");
const gateway = fs.readFileSync(new URL("gateway.js", dir), "utf8");
const popup = fs.readFileSync(new URL("popup.js", dir), "utf8");
const background = fs.readFileSync(new URL("background.js", dir), "utf8");

function grab(src, name) {
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0, i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const table = providers.slice(
  providers.indexOf("const JC_PROVIDERS = {"),
  providers.indexOf("};", providers.indexOf("const JC_PROVIDERS = {")) + 2,
);
const system = providers.slice(
  providers.indexOf("const PROVIDER_SYSTEM ="),
  providers.indexOf(";", providers.indexOf("formatting instructions")) + 1,
);

const load = new Function(
  `${table}\n${system}\n` +
    ["jcDetectProvider", "providerLabel", "providerDefaultModel", "providerRequest", "providerDelta", "providerText", "providerFailure"]
      .map((n) => grab(providers, n))
      .join("\n") +
    "\nreturn { jcDetectProvider, providerLabel, providerDefaultModel, providerRequest, providerDelta, providerText, providerFailure, JC_PROVIDERS };",
);
const P = load();

let failures = 0;
const check = (label, cond, detail) => {
  if (!cond) { failures++; console.log(`FAIL  ${label}${detail ? `  <-- ${detail}` : ""}`); }
  else console.log(`PASS  ${label}`);
};

// ---- 1. whose key is this ------------------------------------------------

const KEYS = [
  ["sk-ant-api03-xyz", "anthropic"],
  ["sk-proj-abcdef", "openai"],       // sk- but NOT sk-ant-
  ["AIzaSyD-fakefake", "gemini"],
  ["hf_abcdefg", "huggingface"],
  ["vck_abcdefg", "vercel"],
  ["not-a-key", null],
  ["", null],
];
for (const [key, want] of KEYS) {
  check(`detect ${JSON.stringify(key.slice(0, 10))} -> ${want}`, P.jcDetectProvider(key) === want);
}
check(
  "sk-ant- is tested BEFORE sk- (order is the whole trick)",
  P.jcDetectProvider("sk-ant-x") === "anthropic" && P.jcDetectProvider("sk-x") === "openai",
);

// ---- 2. the popup's copy of the table agrees with the worker's -----------

for (const slug of Object.keys(P.JC_PROVIDERS)) {
  check(`popup knows provider "${slug}"`, popup.includes(`${slug}:`) || popup.includes(`"${slug}"`));
  check(
    `popup and worker agree on ${slug}'s default model`,
    popup.includes(P.JC_PROVIDERS[slug].defaultModel),
    P.JC_PROVIDERS[slug].defaultModel,
  );
}

// ---- 3. request shapes ---------------------------------------------------

const history = [
  { role: "user", content: "earlier question" },
  { role: "assistant", content: "earlier answer" },
];

const anth = P.providerRequest({ provider: "anthropic", apiKey: "k", model: "claude-haiku-4-5" }, history, "hi", { stream: true });
check("anthropic: system rides the top-level param, not a message", typeof anth.body.system === "string" && !anth.body.messages.some((m) => m.role === "system"));
check("anthropic: history precedes the prompt", anth.body.messages.length === 3 && anth.body.messages[2].content === "hi");
check("anthropic: max_tokens present (the API requires it)", Number.isFinite(anth.body.max_tokens));

const gem = P.providerRequest({ provider: "gemini", apiKey: "k", model: "gemini-2.5-flash-lite" }, history, "hi", { stream: true });
check("gemini: streaming URL uses streamGenerateContent?alt=sse", /streamGenerateContent\?alt=sse$/.test(gem.url));
check("gemini: assistant history becomes role 'model'", gem.body.contents[1].role === "model");
check("gemini: system rides systemInstruction", !!gem.body.systemInstruction);

const oai = P.providerRequest({ provider: "openai", apiKey: "k", model: "gpt-5.4-nano" }, history, "hi", { stream: true });
check("openai: classic messages array with a system head", oai.body.messages[0].role === "system" && oai.body.stream === true);

const gemPlain = P.providerRequest({ provider: "gemini", apiKey: "k", model: "m" }, [], "hi", { stream: false });
check("gemini: non-streaming URL uses generateContent", /:generateContent$/.test(gemPlain.url));

// ---- 4. stream parsing per family ---------------------------------------

check("anthropic delta: content_block_delta text is taken",
  P.providerDelta("anthropic", { type: "content_block_delta", delta: { text: "tok" } }) === "tok");
check("anthropic delta: message_start and ping are ignored",
  P.providerDelta("anthropic", { type: "message_start", message: {} }) === "" &&
  P.providerDelta("anthropic", { type: "ping" }) === "");
check("gemini delta: candidate parts are joined",
  P.providerDelta("gemini", { candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }] }) === "ab");
check("openai-family delta: choices[0].delta.content",
  P.providerDelta("openai", { choices: [{ delta: { content: "x" } }] }) === "x");
check("unknown shapes contribute nothing, never garbage",
  P.providerDelta("anthropic", { foo: 1 }) === "" && P.providerDelta("gemini", {}) === "" && P.providerDelta("openai", null) === "");

check("anthropic text: first text block",
  P.providerText("anthropic", { content: [{ type: "tool_use" }, { type: "text", text: "answer" }] }) === "answer");
check("gemini text: candidate parts",
  P.providerText("gemini", { candidates: [{ content: { parts: [{ text: "answer" }] } }] }) === "answer");
check("openai text: message content",
  P.providerText("openai", { choices: [{ message: { content: "answer" } }] }) === "answer");

// ---- 5. only 401/403 may blame the key -----------------------------------

const spec = { label: "Anthropic" };
check("401 blames the key", /key/i.test(P.providerFailure(spec, 401, "")));
check("429 talks about rate limits, NOT the key", !/key/i.test(P.providerFailure(spec, 429, "")) && /rate|seconds/i.test(P.providerFailure(spec, 429, "")));
check("500 talks about the provider, NOT the key", !/key/i.test(P.providerFailure(spec, 500, "")));
check("bad model names the model", /model/i.test(P.providerFailure(spec, 404, "")));

// ---- 6. the safety rails, source-level -----------------------------------

check(
  "gateway.js refuses a key that isn't the Gateway's own",
  /jcDetectProvider\(apiKey\)\s*!==\s*"vercel"/.test(gateway),
  "an Anthropic key in a Bearer header to vercel.sh is a leak, not a 401",
);
check(
  "background routes non-vercel keys to providerAsk, vercel to gatewayAsk",
  /own\.provider === 'vercel'\s*\?\s*.*gatewayAsk|own\.provider === 'vercel'\)\s*return gatewayAsk/.test(background) ||
    (/providerGetSettings\(\)/.test(background) && /providerAsk\(/.test(background)),
);
check(
  "the voice classifier rides the provider chain too",
  /providerClassify\(system, user\)/.test(background),
);
check(
  "popup never writes the saved key back into an editable input",
  !/byokKeyInput\.value = res\[JC_BYOK_KEY_KEY\]/.test(popup),
  "delete-or-replace means the key is shown masked, never editable",
);
check("popup has a delete handler that clears the key", /byokDeleteBtn/.test(popup) && /storage\.local\.remove\(\[JC_BYOK_KEY_KEY/.test(popup));

// ---- 7. early access -----------------------------------------------------

const hosted = fs.readFileSync(new URL("hosted.js", dir), "utf8");
check("the free period has one date constant", /JC_FREE_UNTIL = Date\.parse\("2026-08-28/.test(hosted));
check("the meter chip is silenced during the free period", /if \(jcFreePeriod\(\)\) return;/.test(hosted));
check(
  "the device engine slot answers from the hosted API (early access)",
  /engine === 'device'[\s\S]{0,900}return hostedAsk\(/.test(background),
);
check("the on-device code is commented out, not deleted",
  /\/\/ const local = await onDeviceAsk/.test(background) && /\/\/ importScripts\('ondevice\.js'\)/.test(background));

console.log(failures ? `\nproviders: ${failures} failing` : "\nproviders OK");
process.exit(failures ? 1 : 0);
