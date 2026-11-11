-- The tables the report board and the usage meter have always needed, written
-- down for the first time.
--
-- WHY THIS FILE EXISTS. The original database (project rwqkngtllxoljxccodod)
-- was created through a connector and its tables were never saved as SQL. In
-- November 2026 that project became unreachable and nobody could restore it,
-- so there was nothing to rebuild from except the code. This file is that
-- reconstruction: every table, column and function below was derived from how
-- app/api/tellme/*, lib/tellme.js, lib/agent/run.js and lib/api-guard.js read
-- and write them. Migrations 003 and 004 (the `kind`, `fix_target` and
-- `fix_shipped_in` columns) are folded in.
--
-- Applied 2026-11-10 to the "Trilorah" Supabase project (lmuuvwetrgmrphpkfywm),
-- which JustClarify now shares because the account's two free project slots
-- were taken. Everything here is prefixed jc_ and is invisible to that app's
-- own users: row level security is on with no policies, and the functions
-- cannot be executed by the anon or authenticated roles.
--
-- What was NOT recoverable: the old reports, votes, agent runs and usage
-- counts. Every install's free-use counter starts again from zero.
--
-- Idempotent. Safe to run again, and safe to run on a brand new project.
--
-- No check constraints on the status-like text columns, on purpose. The code
-- is the authority on which values exist (status, fix_state, kind, category),
-- and a constraint reconstructed from a reading of the code that then rejected
-- a real write would lose somebody's report.

-- A generic key/value table: the voting switch, the interview switch, the
-- keep-alive heartbeat, and the note threads (see lib/tellme.js).
create table if not exists public.jc_flags (
  key   text  primary key,
  value jsonb
);

-- One row per report filed at /tellme.
create table if not exists public.jc_reports (
  id             uuid        primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  body           text        not null,
  context        text,
  -- 'web' or 'extension'
  source         text        not null default 'web',
  -- 'open' or 'fixed'
  status         text        not null default 'open',
  -- One line, written by a model: what the person means.
  gist           text,
  -- 'bug' | 'suggestion' | 'filtered'. Null reads as 'bug'. (Was 003.)
  kind           text,
  -- The agent's triage of how to fix it: copy | ui | logic | sensitive | unclear.
  category       text,
  ups            integer     not null default 0,
  downs          integer     not null default 0,
  -- 'none' | 'proposed' | 'verified'
  fix_state      text        not null default 'none',
  fix_pr_url     text,
  fix_branch     text,
  -- 'site' | 'extension' | 'mixed'. (Was 004.)
  fix_target     text,
  -- Null until the fix is in users' hands. (Was 004.)
  fix_shipped_in text,
  fix_ups        integer     not null default 0,
  fix_downs      integer     not null default 0,
  screenshot_url text
);

create index if not exists jc_reports_created_idx
  on public.jc_reports (created_at desc);

-- One vote per person per report. `voter` is a random string minted in the
-- browser: a bucket key, never an identity.
create table if not exists public.jc_report_votes (
  report_id  uuid        not null references public.jc_reports (id) on delete cascade,
  voter      text        not null,
  dir        smallint    not null check (dir in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (report_id, voter)
);

-- "Did this fix it?" votes, kept apart from the votes on the report itself.
create table if not exists public.jc_fix_votes (
  report_id  uuid        not null references public.jc_reports (id) on delete cascade,
  voter      text        not null,
  dir        smallint    not null check (dir in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (report_id, voter)
);

-- One row per run of the maintenance agent against a report.
create table if not exists public.jc_agent_runs (
  id          uuid        primary key default gen_random_uuid(),
  report_id   uuid        not null references public.jc_reports (id) on delete cascade,
  created_at  timestamptz not null default now(),
  finished_at timestamptz,
  -- 'queued' | 'running' | 'succeeded' | 'blocked' | 'failed'
  status      text        not null default 'queued',
  category    text,
  autonomy    text,
  summary     text,
  -- The paths the run touched, as a JSON array.
  files       jsonb,
  branch      text,
  pr_url      text,
  -- Progress lines, as a JSON array, rewritten as the run goes.
  log         jsonb,
  error       text,
  diff        text,
  -- { before, after } screenshot URLs.
  shots       jsonb
);

create index if not exists jc_agent_runs_report_idx
  on public.jc_agent_runs (report_id, created_at desc);

-- The hosted-API meter: how many times each install has used each scope, per
-- UTC day. lib/api-guard.js reads today's count for the daily limit and the
-- sum for the free allowance.
create table if not exists public.jc_usage (
  install text    not null,
  scope   text    not null,
  day     date    not null,
  uses    integer not null default 0,
  primary key (install, scope, day)
);

alter table public.jc_flags        enable row level security;
alter table public.jc_reports      enable row level security;
alter table public.jc_report_votes enable row level security;
alter table public.jc_fix_votes    enable row level security;
alter table public.jc_agent_runs   enable row level security;
alter table public.jc_usage        enable row level security;

-- Vote on a report. The same direction again takes the vote back; the other
-- direction switches it. Returns the new totals, or no row if the report is
-- gone (the route turns that into a 404).
create or replace function public.jc_report_vote(
  p_report uuid,
  p_voter  text,
  p_dir    integer
) returns table (ups integer, downs integer)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_old smallint;
begin
  if p_dir not in (-1, 1) then
    return;
  end if;
  perform 1 from public.jc_reports r where r.id = p_report for update;
  if not found then
    return;
  end if;

  select v.dir into v_old
    from public.jc_report_votes v
   where v.report_id = p_report and v.voter = p_voter;

  if v_old is null then
    insert into public.jc_report_votes (report_id, voter, dir)
    values (p_report, p_voter, p_dir);
  elsif v_old = p_dir then
    delete from public.jc_report_votes v
     where v.report_id = p_report and v.voter = p_voter;
  else
    update public.jc_report_votes v
       set dir = p_dir
     where v.report_id = p_report and v.voter = p_voter;
  end if;

  return query
    update public.jc_reports r
       set ups   = (select count(*)::integer from public.jc_report_votes v
                     where v.report_id = p_report and v.dir = 1),
           downs = (select count(*)::integer from public.jc_report_votes v
                     where v.report_id = p_report and v.dir = -1)
     where r.id = p_report
    returning r.ups, r.downs;
end $$;

-- The same, for "did this fix it?".
create or replace function public.jc_fix_vote(
  p_report uuid,
  p_voter  text,
  p_dir    integer
) returns table (ups integer, downs integer)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_old smallint;
begin
  if p_dir not in (-1, 1) then
    return;
  end if;
  perform 1 from public.jc_reports r where r.id = p_report for update;
  if not found then
    return;
  end if;

  select v.dir into v_old
    from public.jc_fix_votes v
   where v.report_id = p_report and v.voter = p_voter;

  if v_old is null then
    insert into public.jc_fix_votes (report_id, voter, dir)
    values (p_report, p_voter, p_dir);
  elsif v_old = p_dir then
    delete from public.jc_fix_votes v
     where v.report_id = p_report and v.voter = p_voter;
  else
    update public.jc_fix_votes v
       set dir = p_dir
     where v.report_id = p_report and v.voter = p_voter;
  end if;

  return query
    update public.jc_reports r
       set fix_ups   = (select count(*)::integer from public.jc_fix_votes v
                         where v.report_id = p_report and v.dir = 1),
           fix_downs = (select count(*)::integer from public.jc_fix_votes v
                         where v.report_id = p_report and v.dir = -1)
     where r.id = p_report
    returning r.fix_ups, r.fix_downs;
end $$;

-- Count one use. Returns today's count for this install and scope, and the
-- total across all days.
create or replace function public.jc_increment_usage(
  p_install text,
  p_scope   text
) returns table (day_count integer, lifetime_count bigint)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_day   date := (now() at time zone 'utc')::date;
  v_today integer;
begin
  insert into public.jc_usage (install, scope, day, uses)
  values (p_install, p_scope, v_day, 1)
  on conflict (install, scope, day)
  do update set uses = public.jc_usage.uses + 1
  returning uses into v_today;

  return query
    select v_today,
           (select coalesce(sum(u.uses), 0)::bigint
              from public.jc_usage u
             where u.install = p_install and u.scope = p_scope);
end $$;

-- PostgREST exposes every public function to the anon key by default. These
-- are for the server only.
revoke all on function public.jc_report_vote(uuid, text, integer)   from public, anon, authenticated;
revoke all on function public.jc_fix_vote(uuid, text, integer)      from public, anon, authenticated;
revoke all on function public.jc_increment_usage(text, text)        from public, anon, authenticated;
grant execute on function public.jc_report_vote(uuid, text, integer)  to service_role;
grant execute on function public.jc_fix_vote(uuid, text, integer)     to service_role;
grant execute on function public.jc_increment_usage(text, text)       to service_role;

-- Screenshots attached to reports, and the agent's before/after pictures. A
-- public bucket: the board shows them to anyone. Uploads go through the
-- server with the service key, which checks the file is really an image first
-- (app/api/tellme/upload/route.js).
insert into storage.buckets (id, name, public)
values ('tellme', 'tellme', true)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
