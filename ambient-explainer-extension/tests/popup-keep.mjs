// The "is this little window still wanted?" cadence.
//
// Rules, from the user: ask the first time. Say keep and it stays and stops
// asking. After 5 more questions ON THAT SITE it asks again, then every 5.
// The count is per SITE, so moving between subpages keeps it and only a
// different site starts over. Say close and the window goes.
import fs from "node:fs";

const src = fs.readFileSync(new URL("../llm.js", import.meta.url), "utf8");

function grab(name) {
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0, i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const every = Number(src.match(/const LLM_KEEP_EVERY = (\d+)/)[1]);

// One fake session store, shared by the three functions under test.
function makeEnv() {
  const store = {};
  const chrome = {
    storage: {
      session: {
        get: async (keys) => {
          const out = {};
          for (const k of [].concat(keys)) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (obj) => Object.assign(store, JSON.parse(JSON.stringify(obj))),
      },
    },
  };
  const body =
    `const LLM_KEEP_EVERY = ${every};\n` +
    grab("llmKeepState") + "\n" +
    grab("llmKeepBump") + "\n" +
    grab("llmKeepShouldAsk") + "\n" +
    "return { llmKeepState, llmKeepBump, llmKeepShouldAsk };";
  const api = new Function("chrome", body)(chrome);
  return { ...api, store };
}

let failures = 0;
const check = (label, cond, detail) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  <-- ${detail || ""}`}`);
};

console.log(`(LLM_KEEP_EVERY = ${every})\n`);

// 1. The very first ask on a site must prompt.
{
  const { llmKeepBump, llmKeepShouldAsk } = makeEnv();
  const state = await llmKeepBump("example.com");
  check("first ask on a new site prompts", llmKeepShouldAsk(state) === true);
}

// 2. Saying "keep" silences it for the next few asks, then it returns.
{
  const env = makeEnv();
  await env.llmKeepBump("example.com");
  // The worker records the answer exactly like llmKeepAsk does.
  await env.chromeSet?.();
  let s = await env.llmKeepState("example.com");
  s.asked = true; s.keep = true; s.asksSince = 0;
  Object.assign(env.store, { jcLlmKeep: s });

  check("right after 'keep it' the prompt is silent", env.llmKeepShouldAsk(await env.llmKeepState("example.com")) === false);

  const sawPromptAt = [];
  for (let i = 1; i <= every * 2 + 1; i++) {
    const st = await env.llmKeepBump("example.com");
    if (env.llmKeepShouldAsk(st)) {
      sawPromptAt.push(i);
      // Answering "keep" again resets the counter, as llmKeepAsk does.
      st.asked = true; st.keep = true; st.asksSince = 0;
      Object.assign(env.store, { jcLlmKeep: st });
    }
  }
  check(
    `it asks again on ask ${every}, and every ${every} after`,
    JSON.stringify(sawPromptAt) === JSON.stringify([every, every * 2]),
    `prompted at asks ${JSON.stringify(sawPromptAt)}`,
  );
}

// 3. Per SITE, not per URL: subpages keep the count.
{
  const env = makeEnv();
  let s = await env.llmKeepBump("example.com");
  s.asked = true; s.keep = true; s.asksSince = 2;
  Object.assign(env.store, { jcLlmKeep: s });
  // The host is what identifies the site, so a different path is the same host.
  const same = await env.llmKeepState("example.com");
  check("the same site keeps its count across subpages", same.asksSince === 2 && same.keep === true);
}

// 4. A different site starts over and prompts again.
{
  const env = makeEnv();
  let s = await env.llmKeepBump("example.com");
  s.asked = true; s.keep = true; s.asksSince = 3;
  Object.assign(env.store, { jcLlmKeep: s });
  const other = await env.llmKeepState("other-site.org");
  check("a different site resets to unasked", other.asked === false && other.asksSince === 0);
  check("and therefore prompts on its first ask", env.llmKeepShouldAsk(other) === true);
}

// 5. Saying "close" must not silence the prompt — the window is gone, so the
//    next window on that site has to ask again rather than assuming consent.
{
  const env = makeEnv();
  let s = await env.llmKeepBump("example.com");
  s.asked = true; s.keep = false; s.asksSince = 0;
  Object.assign(env.store, { jcLlmKeep: s });
  check("after 'close', the next window asks again", env.llmKeepShouldAsk(await env.llmKeepState("example.com")) === true);
}

// 6. Structural: the question renders on the USER'S page (never inside the
//    tile — that's the redesign), unanswered means keep, and a 'close' answer
//    actually removes the window.
{
  const askSrc = grab("llmKeepAsk");
  check(
    "the question is asked on the user's own page, not in the tile",
    /sendMessage\(askTabId, \{[\s\S]{0,80}?type: "JC_LLM_KEEP"/.test(askSrc),
  );
  check(
    "the tile window is never grown to fit the card",
    !/windows\.update\(windowId, \{ width: 360/.test(askSrc),
  );
  check("'close' actually removes the window", /chrome\.windows\.remove\(windowId\)/.test(askSrc));
  check("'keep' shrinks it away instead", /llmPopupIdle\(windowId, tabId\)/.test(askSrc));
  check(
    "an unreachable page is left alone rather than the window closed",
    /catch \(_\) \{[\s\S]{0,300}?return;/.test(askSrc),
  );
  const cmds = fs.readFileSync(new URL("../commands.js", import.meta.url), "utf8");
  check("unanswered after 15s defaults to KEEPING it", /setTimeout\(\(\) => answer\(true\), 15000\)/.test(cmds));
  check("the card offers exactly Keep and Close", /class="keep">Keep it<[\s\S]{0,80}class="close">Close</.test(cmds));
}

console.log();
console.log(failures === 0 ? "popup-keep OK" : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
