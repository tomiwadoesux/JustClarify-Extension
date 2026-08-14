-- The back-and-forth on a report.
--
-- A blocked agent run usually ends with a question rather than a refusal:
-- "which text was in the pill?", "a screenshot would let me fix this
-- precisely". Without somewhere to answer, the only reply available is filing
-- a second report, which loses the thread and gives the agent no more to go on
-- the next time it runs.
--
-- NOT YET APPLIED. lib/tellme.js currently keeps these notes as a jsonb value
-- in public.jc_flags under the key `notes:<report_id>`, because the deployment
-- has no DDL path right now (PostgREST cannot create tables and the Supabase
-- connector is unavailable). That works, and the only thing it costs is the
-- cascade below, which the admin delete action does by hand instead.
--
-- Run this when you can, then switch tellmeNotes/tellmeAddNote over and copy
-- the existing keys across.

create table if not exists public.jc_report_notes (
  id          uuid        primary key default gen_random_uuid(),
  report_id   uuid        not null references public.jc_reports (id) on delete cascade,
  created_at  timestamptz not null default now(),

  -- Who is speaking. 'agent' is what a run wrote when it stopped; 'admin' is
  -- the maintainer answering it. Kept apart so the board can label them, and
  -- so a future reporter lane can be added without guessing.
  author      text        not null check (author in ('agent', 'admin', 'reporter')),
  body        text        not null check (char_length(body) between 1 and 4000)
);

create index if not exists jc_report_notes_report_idx
  on public.jc_report_notes (report_id, created_at);

alter table public.jc_report_notes enable row level security;
