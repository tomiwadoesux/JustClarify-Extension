# The maintenance agent

One user report in, one pull request out. Nothing ships without you merging it.

```
/tellme            a person reports a problem, in their own words
  |                the board votes on whether it is real
  v
/tellme/admin      you press "Send to agent"
  |
  v
classify           copy | ui | logic | sensitive | unclear
  |
  |-- sensitive or unclear --> stops here, writes an explanation, touches no code
  |
  v
sandbox            an ephemeral Firecracker VM clones the repo (about 1 second)
  |
  v
read + patch       the agent may only list, search, read and edit files.
  |                It has NO shell, so it cannot curl, install, or read secrets.
  v
verify             extension tests always; npm install + next build only when
  |                the patch touches the site (see verificationPlan)
  v
branch, push, PR   a human reviews and merges
  |
  v
/tellme            the board shows the candidate fix and asks the people who
                   reported it: "did this fix it?" Enough yeses turn it green.
```

One asymmetry the board respects: a fix that touches the site is testable
minutes after merge, but a fix that touches `ambient-explainer-extension/` is
in nobody's hands until a new version clears the Chrome Web Store. The run
records where the fix landed (`fix_target`: site | extension | mixed), and for
extension and mixed fixes the "did this fix it?" vote stays closed until you
press "Mark fix shipped" in the admin panel (`fix_shipped_in`), so a No vote
can never mean "the store has not updated yet". The packaging and upload step
itself stays manual on purpose: the packaging script is in `FORBIDDEN_PATHS`.

## The two votes, which must never be merged into one

- `jc_report_votes` — "this problem is real". Gated behind opening the agent's
  reading of the report, and behind a one-time "did you actually test it?".
- `jc_fix_votes` — "this specific fix solved it". Only exists once a pull
  request has been opened.

Green means the second one reached consensus, not that a branch was merged.

## Safety, in order of how much it matters

1. **The agent only opens pull requests.** It has no deploy token, no write
   access to `main`, and never touches production. You merge.
2. **`FORBIDDEN_PATHS` in policy.js.** Enforced in code after the model has
   chosen, so no prompt can talk past it. The manifest, `api-guard.js`, the
   admin route, the privacy policy, the packaging script and CI are all off
   limits, because a convincing-looking diff to any of them could hurt users
   even after a review.
3. **Category decides autonomy.** Anything that smells of permissions, keys,
   privacy or billing routes to `diagnose`, which cannot write code at all.
4. **No shell tool.** The agent edits files. It cannot run arbitrary commands.

## Environment

| Variable | Needed for | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | everything | already set in production |
| `AI_GATEWAY_API_KEY` | the models, by default | already set |
| `JC_ADMIN_KEY` | the dashboard and starting runs | **must be added to production** |
| `GITHUB_TOKEN` | pushing the branch and opening the PR | **must be added**; needs `repo` scope. Without it a run does all the work and stops before pushing, saying so. |
| `JC_AGENT_MODEL` | which model writes the patch | default `openai/gpt-4o` |
| `JC_AGENT_CLASSIFY_MODEL` | triage | default `openai/gpt-4o-mini` |
| `JC_AGENT_BASE_URL`, `JC_AGENT_API_KEY` | using a provider other than the Gateway | any OpenAI-compatible endpoint |
| `VERCEL_OIDC_TOKEN` | the sandbox, locally | automatic in production; `vercel env pull` locally |

## Choosing a model, which is the thing that most affects quality

A coding agent makes ten to twenty model calls per run. That is a completely
different load from the one-shot summaries the rest of the site makes, and it
is why the agent runs out of budget long before anything else does.

Two things to know about this project's current accounts:

- The **AI Gateway is on the free tier**. Claude and Gemini return
  "free tier users do not have access"; `gpt-4o` and `gpt-4o-mini` work but are
  rate-limited in a short window, which an agent loop exhausts. `withModelFallback`
  waits and retries, but that only stretches so far.
- **Hugging Face** (`HF_API_TOKEN`) works and has good tool-calling models, but
  its monthly included credits are currently depleted.

When credits exist, the single highest-value change to this whole system is one
environment variable:

```
JC_AGENT_MODEL=anthropic/claude-sonnet-5
```

Two model traps already hit here, both worth remembering:

- **Reasoning models with a small token cap return nothing.** `gpt-oss-120b`
  spent its entire 16-token budget on hidden reasoning and emitted empty
  content, and an empty classification silently became "unclear", which looks
  exactly like an agent that refuses to work. Hence the generous cap in
  `classify()`. This project already learned this once with `gpt-5-nano`; see
  the model notes in `app/api/explain/route.js`.
- **Some providers reject their own `reasoning_content` on the next turn.**
  Hugging Face's router does, which breaks multi-turn tool loops with reasoning
  models. `Qwen/Qwen3-235B-A22B-Instruct-2507` and
  `meta-llama/Llama-3.3-70B-Instruct` were verified there to do a full
  call-tool, take-result, answer loop without it.

## What has actually been exercised

Verified end to end against the live project: filing a report and its AI gist,
classification (a permissions report correctly routed to `sensitive`/diagnose, a
wording report to `copy`/patch), the diagnose lane producing a real explanation
without touching code, sandbox create plus clone plus the repo's test suite plus
the `writeFiles`/`readFile` round trip in about five seconds total, the public
diff endpoint (including that it does not leak run logs), the fix vote, and the
admin endpoints including the voting kill switch.

The **push and pull-request path is verified too**, separately: a scripted run
created a branch, committed, pushed, opened a real pull request on the
repository, then closed it and deleted the branch. Sandbox, git and the GitHub
API all work with the token in `GITHUB_TOKEN`.

The one thing still unexercised is the **multi-step patch loop itself**, and the
reason is only budget. Triage and the sandbox both complete; the loop then needs
ten to twenty model calls in a row, and the Gateway free tier allows roughly one
per window. Top up Gateway credits (a Vercel plan is a separate purchase and
does not lift this) and the same code path should run through.
