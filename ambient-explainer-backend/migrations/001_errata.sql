-- Shared errata cache.
--
-- One row per article revision, not per reader. That is the whole point: the
-- cost of checking a page stops scaling with how many people read it.

create table if not exists public.errata (
  id            bigserial primary key,

  -- Normalized URL (see errata.normalize_url) — groups every reader of an
  -- article onto one row despite tracking params and fragments.
  url_key       text        not null,

  -- sha256 of the whitespace-and-case-normalized article body. Pairing this
  -- with url_key is what makes an edited article miss the cache and re-check
  -- itself, with no invalidation logic to maintain.
  content_hash  text        not null,

  title         text,
  verdicts      jsonb       not null default '[]'::jsonb,
  model         text,

  checked_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),

  -- Required for the read-through upsert: PostgREST's
  -- `resolution=merge-duplicates` needs a unique constraint to conflict on.
  constraint errata_article_unique unique (url_key, content_hash)
);

-- The read path filters on both columns together and is hit on essentially
-- every page view, so it must never touch the heap for a miss.
create index if not exists errata_lookup_idx
  on public.errata (url_key, content_hash);

-- Sweeping expired rows scans by age.
create index if not exists errata_checked_at_idx
  on public.errata (checked_at);


-- Reader corrections. Kept in their own table on purpose: a report must never
-- be able to edit a verdict, only to be counted against one.
create table if not exists public.errata_reports (
  id            bigserial primary key,
  url_key       text        not null,
  content_hash  text        not null,
  claim         text,
  reason        text,
  created_at    timestamptz not null default now()
);

create index if not exists errata_reports_article_idx
  on public.errata_reports (url_key, content_hash);


-- Lock both tables down. Every access goes through the backend using the
-- service_role key, which bypasses RLS. Enabling RLS with no policies means the
-- anon and authenticated keys — the ones that would ship in a public extension
-- bundle — can neither read nor write. Without this, anyone could poison the
-- cache for every user by POSTing verdicts straight at PostgREST.
alter table public.errata          enable row level security;
alter table public.errata_reports  enable row level security;
