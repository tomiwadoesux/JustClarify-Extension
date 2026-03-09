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
3. Add the environment variable `HF_API_TOKEN` in Vercel Project Settings.
4. Deploy the project.
5. Attach your custom domain, for example `api.justclarify.ayotomcs.me`.

Vercel will use [app.py](./app.py) as the FastAPI entrypoint.
