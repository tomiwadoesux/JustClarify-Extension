// The agent run: one report in, one pull request out.
//
// Shape of a run, and why it is this shape:
//
//   classify -> (sensitive? stop and explain) -> sandbox -> read -> patch
//            -> verify -> branch, commit, push -> open PR -> back to the board
//
// The agent never touches production and never pushes to main. It works inside
// an ephemeral Firecracker VM that is thrown away at the end, and its only
// output that survives is a branch and a pull request a human has to merge.
// That is the whole safety story in one sentence, and it is worth keeping true
// even when the agent gets good enough that it feels unnecessary.
//
// Two constraints shaped the rest:
//
//   TIME. A Vercel function has 300s. npm install plus a Next build eats most
//   of it, so verification is chosen to fit the patch: an extension-only change
//   is checked with `node --check` and the repo's own dependency-free test
//   suite, which needs no install at all. Only a patch that touches the site
//   pays for node_modules. See verificationPlan in policy.js.
//
//   HONESTY. Every stage writes its progress to jc_agent_runs before it starts
//   the slow part, so a run that is killed mid-flight leaves a record saying
//   where it died rather than silently disappearing.

import { generateText, tool, stepCountIs } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { Sandbox } from '@vercel/sandbox';
import { tellmeDb } from '@/lib/tellme';
import { CATEGORIES, categoryOf, autonomyOf, pathAllowed, verificationPlan, fixTargetOf } from './policy';
import { harnessInstallBrowser, harnessShoot, harnessUpload, harnessFrameFor } from './harness';

// Both models are env-configurable, and the defaults are deliberately the two
// this project's Gateway account can actually call today: on the free tier the
// Claude and Gemini families answer 429 "free tier requests on this model are
// rate-limited", and gpt-5-mini accepts tool definitions but never calls them,
// which for an agent is the same as not working.
//
// Writing a patch is the hardest thing here by a distance, so when credits are
// topped up the single highest-value change to this whole system is:
//   JC_AGENT_MODEL=anthropic/claude-sonnet-5
// No code change needed. gpt-4o is a stand-in, not the intended brain.
// The agent can be pointed at ANY OpenAI-compatible endpoint, not just the
// Vercel AI Gateway. That is not architecture for its own sake: a coding agent
// makes ten to twenty model calls per run, and a rate limit that a one-shot
// summary never notices will stop an agent loop dead every time. Being able to
// move the agent to a provider with room, while the site's own summaries stay
// on the Gateway, is the difference between this working and not.
//
//   JC_AGENT_BASE_URL   e.g. https://router.huggingface.co/v1
//   JC_AGENT_API_KEY    that provider's key
// Leave both unset to use the Gateway with the project's AI_GATEWAY_API_KEY.
const AGENT_BASE_URL = process.env.JC_AGENT_BASE_URL || '';
const AGENT_API_KEY = process.env.JC_AGENT_API_KEY || '';

const custom = AGENT_BASE_URL
  ? createOpenAICompatible({
      name: 'jc-agent-provider',
      baseURL: AGENT_BASE_URL,
      apiKey: AGENT_API_KEY,
    })
  : null;

// A model id becomes either a bare string (the Gateway resolves it) or a model
// from the configured provider. Everything downstream is identical.
function modelFor(id) {
  return custom ? custom(id) : id;
}

const CLASSIFY_MODEL = process.env.JC_AGENT_CLASSIFY_MODEL || 'openai/gpt-4o-mini';
const CODE_MODEL = process.env.JC_AGENT_MODEL || 'openai/gpt-4o';
// Tried in order when the preferred model is unavailable, strongest first,
// because this list is what writes code when the first choice cannot.
//
// The Gateway's free tier rate-limits per model, so a second model is often the
// difference between a run and an error and costs nothing to try. Once credits
// are topped up the Claude entries start answering and the OpenAI ones become
// what they should be: a last resort. A custom provider gets no fallback list,
// because these are Gateway ids and would 404 elsewhere.
const MODEL_FALLBACKS = custom
  ? []
  : ['anthropic/claude-opus-5', 'anthropic/claude-sonnet-5', 'openai/gpt-4o', 'openai/gpt-4o-mini'];
const MAX_STEPS = 26;
const READ_LIMIT = 40_000; // chars per readFile call

const REPO = 'tomiwadoesux/JustClarify-Extension';
const REPO_URL = `https://github.com/${REPO}.git`;
const BASE_BRANCH = 'main';

// A model being rate-limited is the single most likely way a run fails on this
// account, and "GatewayRateLimitError: Free tier requests on this model are
// rate-limited…" in a dashboard is a stack trace, not an explanation. Try the
// alternatives, then say the true thing in words.
function quotaProblem(error) {
  const text = `${error?.message || error} ${error?.responseBody || ''}`;
  return /rate.?limit|quota|429|402|free tier|depleted|insufficient|no_providers_available/i.test(
    text,
  );
}

// Out of credit and rate-limited are different problems with different fixes,
// and telling them apart is the whole value of the message.
function outOfCredit(error) {
  const text = `${error?.message || error} ${error?.responseBody || ''}`;
  return /402|depleted|insufficient|purchase|out of credit/i.test(text);
}

// The free tier's limit is a short window rather than a hard wall: a call that
// is refused now usually succeeds twenty seconds later. Since a run already
// takes minutes, waiting is nearly always better than failing, so this tries
// every model, then waits, then tries them all again.
const QUOTA_WAITS_MS = [15_000, 30_000, 45_000];

async function withModelFallback(preferred, call) {
  const chain = [preferred, ...MODEL_FALLBACKS.filter((m) => m !== preferred)];
  let last = null;

  for (let round = 0; round <= QUOTA_WAITS_MS.length; round++) {
    for (const model of chain) {
      try {
        return await call(model);
      } catch (error) {
        last = error;
        if (!quotaProblem(error)) throw error;
      }
    }
    const wait = QUOTA_WAITS_MS[round];
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  const readable = new Error(
    outOfCredit(last)
      ? 'The AI account this agent uses is out of credit, so no model would answer. A coding ' +
        'agent makes ten to twenty model calls per run, which is far more than a one-off ' +
        'summary, so it runs out long before the rest of the site does. Add credit to the ' +
        'provider set in JC_AGENT_BASE_URL, or point that at one that has some.'
      : 'Every available model is rate-limited right now. On the AI Gateway free tier the limit ' +
        'is a short window and an agent loop exhausts it. Paid credits fix it, and also unlock ' +
        'much better models for writing code (set JC_AGENT_MODEL=anthropic/claude-sonnet-5).',
  );
  readable.cause = last;
  throw readable;
}

// --- run bookkeeping ---------------------------------------------------------

async function patchRun(runId, fields) {
  try {
    await tellmeDb(`jc_agent_runs?id=eq.${runId}`, { method: 'PATCH', body: fields });
  } catch (_) {
    // A metering failure must never take the run down with it.
  }
}

function makeLogger(runId) {
  const lines = [];
  return {
    lines,
    async say(message) {
      lines.push({ at: new Date().toISOString(), message });
      await patchRun(runId, { log: lines });
    },
  };
}

// --- seeing -------------------------------------------------------------------

// A reporter's screenshot, fetched and handed to the model as bytes. Fetched
// server-side on purpose: the model gets the pixels we validated at upload
// time, not a URL it is trusted to go and dereference.
async function fetchScreenshot(url) {
  if (!url || !url.startsWith(`${process.env.SUPABASE_URL}/storage/v1/object/public/tellme/`)) {
    return null;
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 4 * 1024 * 1024) return null;
    return { bytes, mediaType: response.headers.get('content-type') || 'image/png' };
  } catch (_) {
    return null;
  }
}

// Text-or-multimodal prompt: the same brief, with the reporter's screenshot
// attached when there is one.
function withImage(text, shot) {
  if (!shot) return text;
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text },
        { type: 'image', image: shot.bytes, mediaType: shot.mediaType },
      ],
    },
  ];
}

// --- step 1: what kind of report is this ------------------------------------

const CLASSIFY_SYSTEM = `You triage bug reports for JustClarify, a Chrome extension that explains
highlighted text, fact-checks pages, and has hold-to-talk voice control, plus its marketing site
built in Next.js.

Choose exactly one category:
- copy: the wording of something a user reads is wrong, confusing or a typo.
- ui: how something looks or is laid out. Spacing, colour, size, position, overlap.
- logic: how something behaves. Something does the wrong thing, crashes, or does nothing.
- sensitive: touches extension permissions, API keys, privacy, billing, or who is allowed to call
  the API. Choose this whenever the fix would plausibly involve any of those, even partly.
- unclear: not enough information to know what is wrong, or not reproducible from what was written.

Judge only how the report should be ROUTED, not how hard the fix is. A report that quotes an exact
message it saw on screen, or names an exact button, is specific enough to act on. Reserve "unclear"
for reports that do not say what happened or where.

Examples:
"the button says Open a regular webpage first and I had no idea what that meant" -> copy
"the popup text is confusing, it should explain what went wrong" -> copy
"the answer card overlaps the text I highlighted at the bottom of the page" -> ui
"the popup is too narrow on my laptop and the buttons wrap" -> ui
"voice does nothing when I hold shift on youtube, it just spins forever" -> logic
"it says my API key is not connected but it is" -> logic
"why does it need permission to read every website I visit" -> sensitive
"I was charged twice" -> sensitive
"it broke" -> unclear

Prefer "sensitive" over a guess when the fix would touch permissions, keys, privacy or billing.
Answer with the single word only.`;

// The token cap here is generous on purpose, and it is not about the length of
// the answer: the answer is one word. Reasoning models spend their budget on
// hidden reasoning BEFORE emitting anything, so a tight cap returns
// finish_reason "length" with empty content, and an empty answer silently
// becomes "unclear" -- an agent that quietly refuses to work on everything.
// This project already learned this once with gpt-5-nano; see the model notes
// in app/api/explain/route.js.
async function classify(report, shot) {
  const brief = `Report: ${report.body}\n\nAttached context: ${report.context || '(none)'}${shot ? '\n\nThe reporter attached the screenshot shown.' : ''}\n\nAnswer with one word: copy, ui, logic, sensitive, or unclear.`;
  const text = await withModelFallback(CLASSIFY_MODEL, async (model) => {
    const result = await generateText({
      model: modelFor(model),
      system: CLASSIFY_SYSTEM,
      ...(shot ? { messages: withImage(brief, shot) } : { prompt: brief }),
      maxOutputTokens: 1200,
      temperature: 0,
    });
    return result.text;
  });

  // Read the LAST category word in the reply, so a model that thinks out loud
  // before answering is scored on its conclusion rather than its first guess.
  const said = String(text || '').toLowerCase();
  let found = null;
  for (const name of ['copy', 'ui', 'logic', 'sensitive', 'unclear']) {
    const at = said.lastIndexOf(name);
    if (at >= 0 && (!found || at > found.at)) found = { name, at };
  }
  return categoryOf(found?.name);
}

// --- the sandbox and its tools ----------------------------------------------

// Everything the agent can do to the checkout, and nothing else. Note what is
// absent: no arbitrary shell. The agent cannot run commands, so it cannot curl
// anything, install anything, or read a secret out of the environment. It reads
// and writes files inside a repo that gets deleted, and that is all.
function makeTools({ sandbox, repoDir, log, touched }) {
  const sh = async (cmd, args, opts = {}) =>
    sandbox.runCommand({ cmd, args, cwd: repoDir, ...opts });

  return {
    listFiles: tool({
      description:
        'List repository files under a directory. Use this before guessing a path. Returns repo-relative paths.',
      inputSchema: z.object({
        dir: z.string().describe('Repo-relative directory, e.g. "ambient-explainer-extension" or "app"'),
      }),
      execute: async ({ dir }) => {
        const result = await sh('sh', [
          '-c',
          `find ${JSON.stringify(dir)} -type f \\( -name '*.js' -o -name '*.jsx' -o -name '*.css' -o -name '*.html' -o -name '*.json' -o -name '*.md' \\) -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/venv/*' | head -200`,
        ]);
        return (await result.stdout()) || '(nothing found)';
      },
    }),

    searchRepo: tool({
      description:
        'Search the repository for a string or regex. This is the fastest way to find where a behaviour or a piece of on-screen text lives.',
      inputSchema: z.object({
        pattern: z.string().describe('Regex or literal string to search for'),
        dir: z.string().optional().describe('Optional directory to narrow the search to'),
      }),
      execute: async ({ pattern, dir }) => {
        const where = dir || '.';
        const result = await sh('sh', [
          '-c',
          `grep -rn --binary-files=without-match ${JSON.stringify(pattern)} ${JSON.stringify(where)} --include='*.js' --include='*.jsx' --include='*.css' --include='*.html' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=venv --exclude-dir=.git | head -60`,
        ]);
        return (await result.stdout()) || '(no matches)';
      },
    }),

    readFile: tool({
      description:
        'Read a repository file. Large files are truncated, so pass startLine to page through one if you need a later part of it.',
      inputSchema: z.object({
        path: z.string().describe('Repo-relative file path'),
        startLine: z.number().optional().describe('1-indexed line to start from'),
      }),
      execute: async ({ path, startLine }) => {
        const from = Math.max(1, startLine || 1);
        const result = await sh('sh', [
          '-c',
          `sed -n '${from},${from + 700}p' ${JSON.stringify(path)} | head -c ${READ_LIMIT}`,
        ]);
        const body = await result.stdout();
        if (!body) return `(${path} is empty, missing, or that line range is past the end)`;
        return `${path} from line ${from}:\n${body}`;
      },
    }),

    writeFile: tool({
      description:
        'Replace one exact snippet in a file with another. oldText must appear exactly once in the file. Make the smallest change that fixes the problem, and match the surrounding code style.',
      inputSchema: z.object({
        path: z.string().describe('Repo-relative file path'),
        oldText: z.string().describe('The exact text to replace, including indentation'),
        newText: z.string().describe('What to replace it with'),
      }),
      execute: async ({ path, oldText, newText }) => {
        // The policy gate runs here, after the model has chosen, so no prompt
        // can talk its way around it.
        const verdict = pathAllowed(path);
        if (!verdict.ok) {
          await log.say(`refused a write to ${path}: ${verdict.why}`);
          return `REFUSED. ${path} cannot be edited by the agent: ${verdict.why}. Do not try again; work within the files you are allowed to change, or explain that this needs a human.`;
        }

        const current = await sandbox.readFileToBuffer({ path, cwd: repoDir });
        if (!current) return `${path} does not exist.`;
        const text = current.toString('utf8');

        const count = text.split(oldText).length - 1;
        if (count === 0) return 'oldText was not found in that file. Read the file again and copy the snippet exactly, including indentation.';
        if (count > 1) return `oldText appears ${count} times. Include more surrounding lines so it matches exactly once.`;

        await sandbox.writeFiles([
          { path: `${repoDir}/${path}`, content: text.replace(oldText, newText) },
        ]);
        touched.add(path);
        await log.say(`edited ${path}`);
        return `Edited ${path}.`;
      },
    }),

    checkSyntax: tool({
      description:
        'Syntax-check the JavaScript files you have edited. Always do this before you finish.',
      inputSchema: z.object({}),
      execute: async () => {
        const js = [...touched].filter((p) => p.endsWith('.js') || p.endsWith('.jsx'));
        if (!js.length) return 'No JavaScript files edited yet.';
        const out = [];
        for (const path of js) {
          const result = await sh('node', ['--check', path]);
          out.push(`${path}: ${result.exitCode === 0 ? 'OK' : `FAILED\n${await result.stderr()}`}`);
        }
        return out.join('\n');
      },
    }),
  };
}

const CODE_SYSTEM = `You are the JustClarify maintenance agent. You are given one problem report from
a real user and a checkout of the repository, and you make the smallest change that fixes it.

The repository:
- ambient-explainer-extension/ is a Manifest V3 Chrome extension in plain JavaScript. No build step,
  no framework, no TypeScript. background.js is the service worker; content.js is injected into
  pages; popup.js/popup.html are the toolbar popup; voice.js is hold-to-talk.
- app/, components/ and lib/ are a Next.js App Router site in plain JavaScript with Tailwind.

How to work:
1. Find the code the report is about. searchRepo on a distinctive phrase from the report is usually
   the fastest route. Never guess a path.
2. Read enough of the file to understand the surrounding style before editing.
3. Make the smallest change that fixes the reported problem. Do not refactor, do not tidy unrelated
   code, do not add features nobody asked for.
4. Match the file's existing conventions exactly: naming, quoting, comment density and voice.
5. Never use em dashes in any user-facing text you write.
6. Run checkSyntax before you finish.

Some files are off limits and writeFile will refuse them. That refusal is final: do not look for
another way in. If the only real fix lives in a forbidden file, stop and say so.

If you cannot reproduce or locate the problem from what the user wrote, do not invent a change.
Say what you looked at and what you would need to know. A run that changes nothing and explains
why is a good outcome; a plausible-looking change to the wrong code is not.

When you are done, reply with a short plain-English summary of what you changed and why. Write it
for the person who filed the report, not for a developer.`;

// --- verification ------------------------------------------------------------

async function verify({ sandbox, repoDir, paths, log }) {
  const plan = verificationPlan(paths);
  const sh = (cmd, args, opts = {}) => sandbox.runCommand({ cmd, args, cwd: repoDir, ...opts });

  await log.say('running the extension test suite');
  const tests = await sh('sh', [
    '-c',
    'node ambient-explainer-extension/tests/providers.mjs && node ambient-explainer-extension/tests/voice-coach.mjs && node ambient-explainer-extension/tests/voice-frame.mjs',
  ]);
  if (tests.exitCode !== 0) {
    const detail = `${await tests.stdout()}\n${await tests.stderr()}`;
    return { ok: false, detail: detail.slice(-3000) };
  }

  if (!plan.needsInstall) {
    await log.say('extension-only change, so no npm install needed');
    return { ok: true, detail: 'Extension tests passed.' };
  }

  await log.say('site files changed, installing dependencies (this is the slow part)');
  const install = await sh('npm', ['ci', '--no-audit', '--no-fund'], { timeoutMs: 240_000 });
  if (install.exitCode !== 0) {
    return { ok: false, detail: (await install.stderr()).slice(-3000) };
  }

  await log.say('building the site');
  const build = await sh('npx', ['next', 'build'], { timeoutMs: 300_000 });
  if (build.exitCode !== 0) {
    const detail = `${await build.stdout()}\n${await build.stderr()}`;
    return { ok: false, detail: detail.slice(-3000) };
  }
  return { ok: true, detail: 'Extension tests and the site build both passed.' };
}

// --- shipping it -------------------------------------------------------------

async function openPullRequest({ sandbox, repoDir, branch, report, summary, runId, log }) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { prUrl: null, why: 'GITHUB_TOKEN is not set, so the branch could not be pushed.' };

  const sh = (cmd, args) => sandbox.runCommand({ cmd, args, cwd: repoDir });

  await sh('git', ['config', 'user.email', 'agent@justclarify.xyz']);
  await sh('git', ['config', 'user.name', 'JustClarify agent']);
  await sh('git', ['checkout', '-b', branch]);
  await sh('git', ['add', '-A']);

  const message = `Fix: ${report.body.slice(0, 60).replace(/\s+/g, ' ')}\n\nReported at /tellme.\n\n${summary.slice(0, 500)}`;
  const commit = await sh('git', ['commit', '-m', message]);
  if (commit.exitCode !== 0) {
    return { prUrl: null, why: 'Nothing was committed, so there is no pull request.' };
  }

  await log.say('pushing the branch');
  const push = await sandbox.runCommand({
    cmd: 'git',
    args: ['push', `https://x-access-token:${token}@github.com/${REPO}.git`, branch],
    cwd: repoDir,
  });
  if (push.exitCode !== 0) {
    return { prUrl: null, why: `Push failed: ${(await push.stderr()).slice(-400)}` };
  }

  await log.say('opening the pull request');
  const response = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Agent fix: ${report.body.slice(0, 60).replace(/\s+/g, ' ')}`,
      head: branch,
      base: BASE_BRANCH,
      body: [
        '### What a user reported',
        '',
        `> ${report.body.replace(/\n/g, '\n> ')}`,
        '',
        '### What the agent changed',
        '',
        summary,
        '',
        '---',
        `Opened automatically from [/tellme](https://justclarify.xyz/tellme). Run \`${runId}\`.`,
        'A human merges this. Nothing here has shipped.',
      ].join('\n'),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[agent] pr failed', response.status, detail.slice(0, 300));
    return { prUrl: null, why: `GitHub refused the pull request (HTTP ${response.status}).` };
  }
  const data = await response.json();
  return { prUrl: data.html_url, why: '' };
}

// --- the run ------------------------------------------------------------------

export async function runAgent({ runId, report }) {
  const log = makeLogger(runId);
  let sandbox = null;

  try {
    await patchRun(runId, { status: 'running' });
    await log.say('reading the report');

    // The reporter's screenshot, when they attached one — it sharpens both the
    // triage and the patch, because "the popup looks broken" plus pixels is a
    // different quality of brief than the words alone.
    const reporterShot = await fetchScreenshot(report.screenshot_url);
    if (reporterShot) await log.say("looking at the reporter's screenshot");

    const category = await classify(report, reporterShot);
    const autonomy = autonomyOf(category);
    await patchRun(runId, { category, autonomy });
    await tellmeDb(`jc_reports?id=eq.${report.id}`, { method: 'PATCH', body: { category } });
    await log.say(`categorised as ${CATEGORIES[category].label} (${autonomy})`);

    // The sensitive and unclear lanes stop here by design. They still produce
    // something useful: an explanation a human can act on.
    if (autonomy === 'diagnose') {
      const text = await withModelFallback(CODE_MODEL, async (model) => {
        const result = await generateText({
          model: modelFor(model),
          system:
            'You triage JustClarify bug reports. You may NOT propose code. Explain in plain English what ' +
            'this report is probably about, what you would check first, and why a human rather than an ' +
            'agent should handle it. Be brief. Never use em dashes.',
          prompt: `Report: ${report.body}\n\nContext: ${report.context || '(none)'}\n\nCategory: ${category}.`,
          maxOutputTokens: 400,
        });
        return result.text;
      });
      await patchRun(runId, {
        status: 'blocked',
        summary: text,
        finished_at: new Date().toISOString(),
      });
      await log.say('stopped before touching code, on purpose');
      return { status: 'blocked', summary: text };
    }

    await log.say('starting a sandbox and cloning the repo');
    sandbox = await Sandbox.create({
      source: {
        type: 'git',
        url: REPO_URL,
        depth: 1,
        revision: BASE_BRANCH,
        ...(process.env.GITHUB_TOKEN
          ? { username: 'x-access-token', password: process.env.GITHUB_TOKEN }
          : {}),
      },
      runtime: 'node24',
      timeout: 600_000,
      resources: { vcpus: 4 },
    });

    // Where the clone landed is an implementation detail of the SDK, so ask
    // rather than assume.
    const pwd = await sandbox.runCommand('pwd');
    const repoDir = (await pwd.stdout()).trim() || '/vercel/sandbox';
    await log.say(`repo ready at ${repoDir}`);

    // UI runs get photographed. The "before" is taken from the clean checkout
    // BEFORE the agent edits anything, so the pair differs only by the patch.
    const shots = {};
    let browserReady = false;
    const frame = harnessFrameFor(`${report.body} ${report.context || ''}`);
    if (category === 'ui') {
      browserReady = await harnessInstallBrowser(sandbox, log);
      if (browserReady) {
        const before = await harnessShoot(sandbox, repoDir, 'before', frame);
        shots.before = await harnessUpload(runId, 'before', before);
        if (shots.before) await log.say('photographed the UI as it stands now');
        else await log.say("couldn't render the harness, continuing without pictures");
      } else {
        await log.say('browser install failed, continuing without pictures');
      }
    }

    const touched = new Set();
    const tools = makeTools({ sandbox, repoDir, log, touched });

    const brief = [
      'A user reported this at /tellme:',
      '',
      report.body,
      '',
      report.context ? `Attached automatically from the extension:\n${report.context}` : '',
      report.gist ? `An earlier read of it: ${report.gist}` : '',
      reporterShot ? 'Their screenshot of the problem is attached to this message.' : '',
      '',
      `Triaged as: ${CATEGORIES[category].label}. ${CATEGORIES[category].blurb}`,
    ]
      .filter(Boolean)
      .join('\n');

    const summary = await withModelFallback(CODE_MODEL, async (model) => {
      const result = await generateText({
        model: modelFor(model),
        system: CODE_SYSTEM,
        ...(reporterShot ? { messages: withImage(brief, reporterShot) } : { prompt: brief }),
        tools,
        stopWhen: stepCountIs(MAX_STEPS),
      });
      return result.text;
    });

    const paths = [...touched];
    if (!paths.length) {
      await patchRun(runId, {
        status: 'blocked',
        summary: summary || 'The agent did not find a change it was confident in.',
        finished_at: new Date().toISOString(),
      });
      await log.say('finished without changing anything');
      return { status: 'blocked', summary };
    }

    await patchRun(runId, { files: paths, summary });

    const diffResult = await sandbox.runCommand({ cmd: 'git', args: ['diff'], cwd: repoDir });
    const diff = (await diffResult.stdout()).slice(0, 60_000);
    await patchRun(runId, { diff });

    // The "after" comes from the patched tree, same fixtures, same viewport —
    // taken before verification so even a failed run leaves evidence of what
    // the patch would have looked like.
    if (browserReady && shots.before) {
      const after = await harnessShoot(sandbox, repoDir, 'after', frame);
      shots.after = await harnessUpload(runId, 'after', after);
      if (shots.after) await log.say('photographed the UI with the fix applied');
    }
    if (shots.before || shots.after) await patchRun(runId, { shots });

    const check = await verify({ sandbox, repoDir, paths, log });
    if (!check.ok) {
      await patchRun(runId, {
        status: 'failed',
        error: `Verification failed.\n${check.detail}`,
        finished_at: new Date().toISOString(),
      });
      await log.say('verification failed, so nothing was pushed');
      return { status: 'failed', summary, error: check.detail };
    }

    const branch = `agent/report-${String(report.id).slice(0, 8)}-${String(runId).slice(0, 6)}`;
    const { prUrl, why } = await openPullRequest({
      sandbox,
      repoDir,
      branch,
      report,
      summary,
      runId,
      log,
    });

    await patchRun(runId, {
      status: prUrl ? 'succeeded' : 'failed',
      branch,
      pr_url: prUrl,
      error: prUrl ? null : why,
      finished_at: new Date().toISOString(),
    });

    if (prUrl) {
      // Where the fix landed decides when the board may ask "did this fix
      // it?". A site fix is testable minutes after merge; an extension fix is
      // testable by nobody until a new version clears the store. The board
      // holds the vote on extension (and mixed) fixes until the admin marks
      // the version shipped.
      const target = fixTargetOf(paths);
      await tellmeDb(`jc_reports?id=eq.${report.id}`, {
        method: 'PATCH',
        body: { fix_state: 'proposed', fix_pr_url: prUrl, fix_branch: branch, fix_target: target },
      });
      await log.say(
        target === 'site'
          ? 'pull request opened, waiting on a human'
          : 'pull request opened, waiting on a human, and then on an extension release',
      );
    }

    return { status: prUrl ? 'succeeded' : 'failed', summary, prUrl };
  } catch (error) {
    console.error('[agent] run failed', error);
    await patchRun(runId, {
      status: 'failed',
      error: String(error?.message || error).slice(0, 1000),
      finished_at: new Date().toISOString(),
    });
    return { status: 'failed', error: String(error?.message || error) };
  } finally {
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch (_) {}
    }
  }
}
