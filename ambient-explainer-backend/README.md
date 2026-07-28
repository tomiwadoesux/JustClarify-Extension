# JustClarify Backend

Backend service for the JustClarify application.

## Setup

1. Create virtual environment: `python -m venv venv`
2. Activate: `source venv/bin/activate`
3. Install dependencies: `pip install -r requirements.txt`
4. Run server: `uvicorn app.main:app --reload`

## Vercel Deployment

This folder is ready to be deployed as its own Vercel project.

1. Create a new Vercel project from this repository.
2. Set the project Root Directory to `ambient-explainer-backend`.
3. Add the environment variables `HF_API_TOKEN` and `RESEND_API_KEY` in Vercel Project Settings.
4. Deploy the project.
5. Attach your custom domain, for example `api.justclarify.xyz`.

Vercel will use [index.py](./index.py) as the FastAPI entrypoint.
Routes like `/health` and `/explain` will be served directly by the FastAPI app.

## Shared errata cache

A fact-check verdict belongs to the article, not to the reader who triggered it.
The cache keys each result on a normalized URL plus a hash of the article body,
so the cost of checking a page scales with the number of *articles*, not the
number of readers — and the second reader of any page gets verdicts instantly,
with no API key of their own.

| Route | Cost | What it does |
|---|---|---|
| `GET /errata` | free | Cached verdicts for one article revision. Never computes. |
| `POST /errata/check` | paid on miss | Read-through: serves the cache, or runs the check server-side and stores it. |
| `POST /errata/report` | free | Flags a cached verdict as wrong. |

### Setup

1. Apply [migrations/001_errata.sql](./migrations/001_errata.sql) to your
   Supabase project (SQL Editor, or `supabase db push`).
2. Add these environment variables:

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Project URL. Without it the cache is skipped entirely and the extension falls back to checking locally. |
| `SUPABASE_SERVICE_KEY` | yes | **service_role** key. Both tables have RLS on with no policies, so only this key can reach them — that is what stops anyone POSTing forged verdicts straight at PostgREST. Never ship it to a client. |
| `AI_GATEWAY_API_KEY` | yes | Pays for server-side checks. Without it `/errata/check` returns `no-gateway-key` and readers fall back to their own key. |
| `GOOGLE_FACTCHECK_API_KEY` | no | Free published-ruling lookups. Strongly recommended — it is the cheapest and most accurate tier. |
| `ERRATA_TTL_DAYS` | no | How long a verdict stays servable (default `14`). Stale rows are re-checked rather than served. |
| `FACTCHECK_MAX_CLAIMS` | no | Claims checked per article (default `6`). This is the main cost lever. |
| `FACTCHECK_SEARCH_MODEL` | no | Search-native verdict model (default `perplexity/sonar`). |
| `FACTCHECK_EXTRACT_MODEL` | no | Cheap model for claim extraction (default `openai/gpt-5.4-mini`). |

### What is deliberately not cached

A shared cache multiplies whatever you put in it, mistakes included — one wrong
verdict cached is a wrong verdict shown to every future reader of that page. So
the bar to enter the cache is higher than the bar to show something live.
Excluded: any verdict whose `origin` is `error`, `no-key` or `lookup-failed`
(those record a failure to check, not the result of one), any low-confidence
verdict that isn't a published human ruling, and anything with an empty summary.
