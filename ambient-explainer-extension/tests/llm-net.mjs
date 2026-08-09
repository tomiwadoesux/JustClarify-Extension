// Reading the answer off the NETWORK rather than the screen. Run with:
//   npm run test:net
//
// llm-net.js tees the provider's SSE stream and reconstructs the answer from
// it. It is the PRIMARY answer source — the DOM poll is only the fallback — so
// when its extraction silently matches nothing, the whole engine goes quiet
// while the provider's own page streams normally. That is exactly what
// happened: a real service-worker trace showed netChars:0 for an entire run,
// because ChatGPT had moved from whole-message snapshots to a JSON-patch delta
// protocol that `extract` did not recognise at all.
//
// The functions are EXTRACTED from source rather than imported, like the other
// tests here, so they cannot drift from the shipping code.
import fs from "node:fs";

const src = fs.readFileSync(new URL("../llm-net.js", import.meta.url), "utf8");

function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0, i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const load = new Function(`${grab("extract")}\n${grab("makeDeltaReader")}\nreturn { extract, makeDeltaReader };`);
const { extract, makeDeltaReader } = load();

let failures = 0;
const check = (label, cond, detail) => {
  if (!cond) { failures++; console.log(`FAIL  ${label}${detail ? `  <-- ${detail}` : ""}`); }
  else console.log(`PASS  ${label}`);
};

// Replay a stream the way readStream does: classic shapes first, delta only
// when nothing classic matched, so the two can never count the same token.
function replay(events) {
  const delta = makeDeltaReader();
  let appended = "";
  let replaced = "";
  for (const obj of events) {
    const got = extract(obj);
    if (!got) {
      appended += delta(obj);
      continue;
    }
    if (got.append) appended += got.append;
    if (got.replace && got.replace.length > replaced.length) replaced = got.replace;
  }
  return appended.length >= replaced.length ? appended : replaced;
}

// ---- the shape that broke: ChatGPT's delta encoding ----------------------

const CHATGPT = [
  // The opening snapshot carries the message with empty parts.
  { p: "", o: "add", v: { message: { id: "m", content: { content_type: "text", parts: [""] } }, conversation_id: "c" } },
  // First append names the path...
  { o: "append", p: "/message/content/parts/0", v: "In this passage, " },
  // ...and every later bare {"v"} inherits it.
  { v: '"make ideas work' },
  { v: ' on the web" means' },
  // A batch of ops in one event, with a metadata op sitting LAST inside it.
  { o: "patch", v: [
    { p: "/message/content/parts/0", o: "append", v: " turning concepts" },
    { p: "/message/metadata/citations", o: "add", v: "METADATA" },
  ] },
  // The batch is atomic: this continuation must still inherit the ANSWER path,
  // not the metadata path the batch happened to end on. Letting it leak
  // truncated every answer at the token before the batch.
  { v: " into practical websites." },
  // End-of-turn metadata, then a stray continuation that is NOT answer text.
  { p: "/message/metadata/finish_details", o: "add", v: { type: "stop" } },
  { v: "NOT-ANSWER-TEXT" },
];

const answer = replay(CHATGPT);
check(
  "ChatGPT's delta stream reconstructs the whole answer",
  answer === 'In this passage, "make ideas work on the web" means turning concepts into practical websites.',
  JSON.stringify(answer),
);
check("a patch batch does not leak its path into the next continuation", answer.includes(" into practical websites."));
check("metadata never lands in the answer", !/METADATA|NOT-ANSWER-TEXT/.test(answer));

// ---- the classic shapes must keep working -------------------------------

check("OpenAI-compatible delta", replay([
  { choices: [{ delta: { content: "Hello" } }] },
  { choices: [{ delta: { content: " world" } }] },
]) === "Hello world");

check("Anthropic content_block_delta", replay([
  { delta: { text: "Hel" } },
  { delta: { text: "lo" } },
]) === "Hello");

check("older ChatGPT whole-message snapshots (cumulative)", replay([
  { message: { content: { parts: ["Hel"] } } },
  { message: { content: { parts: ["Hello there"] } } },
]) === "Hello there");

check("older claude.ai cumulative completion", replay([
  { completion: "Hel" },
  { completion: "Hello" },
]) === "Hello");

// ---- a misread must show LESS, never something wrong --------------------

check("unknown event shapes contribute nothing", replay([
  { foo: 1 },
  { v: { a: 1 } },
  { v: [1, 2, 3] },
  { type: "ping" },
  { o: "remove", p: "/message/content/parts/0", v: "x" },
  { o: "replace", p: "/message/content/parts/0", v: "wholesale replacement" },
]) === "");

// A stream we joined late: the snapshot already holds text, and it is taken.
check("a snapshot carrying existing parts is not dropped", replay([
  { p: "", o: "add", v: { message: { content: { parts: ["already streaming"] } } } },
  { o: "append", p: "/message/content/parts/0", v: " onwards" },
]) === "already streaming onwards");

// Two independent streams must not share continuation state.
const a = makeDeltaReader();
const b = makeDeltaReader();
a({ o: "append", p: "/message/content/parts/0", v: "A" });
check("readers are independent", b({ v: "should-not-append" }) === "");

// ---- the first-ask echo: the user's own message must never be the answer --
//
// A brand-new ?q= conversation streams the USER message down the same pipe
// first, complete with its parts. Taking those rendered the entire prompt in
// the answer card on the very first "Your LLM" ask — and only the first,
// because later asks continue an existing conversation whose user turns are
// added client-side. The role guard is what keeps the prompt out.

const FIRST_ASK = [
  // The user's message arrives as a full snapshot: the prompt, echoed.
  { p: "", o: "add", v: { message: { id: "u", author: { role: "user" }, content: { parts: ['Passage: "Hi!" — explain this.'] } } } },
  // A stray continuation while the user message is still current must die too.
  { v: "still-the-user's-text" },
  // Then the assistant's message opens (empty) and streams normally.
  { p: "", o: "add", v: { message: { id: "m", author: { role: "assistant" }, content: { parts: [""] } } } },
  { o: "append", p: "/message/content/parts/0", v: "The passage greets" },
  { v: " the reader." },
];
const firstAsk = replay(FIRST_ASK);
check(
  "a user-message snapshot never becomes the answer",
  firstAsk === "The passage greets the reader.",
  JSON.stringify(firstAsk),
);
check("the echoed prompt is fully absent", !firstAsk.includes("Passage:"));

// The same guard in the classic whole-message family.
check("classic snapshots skip user messages too", replay([
  { message: { author: { role: "user" }, content: { parts: ["the whole prompt"] } } },
  { message: { author: { role: "assistant" }, content: { parts: ["the answer"] } } },
]) === "the answer");

// No author at all keeps the old behaviour — degrade to showing, not silence.
check("a snapshot with no author is still taken", replay([
  { p: "", o: "add", v: { message: { content: { parts: ["already streaming"] } } } },
]) === "already streaming");

console.log(failures ? `\nllm-net: ${failures} failing` : "\nllm-net OK");
process.exit(failures ? 1 : 0);
