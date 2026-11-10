-- The student interview at /interview.
--
-- NOT YET APPLIED. Paste this whole file into the Supabase SQL editor and run
-- it once. Every statement is idempotent, so running it twice is safe.
--
-- What it is for: a student opens a share link, agrees to talk to an AI, and
-- answers about six short questions by typing or by voice note. The server
-- keeps the transcript and, at the end, a typed summary of which problems the
-- student raised. That is all these tables hold.
--
-- What is deliberately NOT stored: no IP address, no IP hash, no user agent,
-- no audio (a voice note is transcribed in memory and dropped), and no session
-- token (only its sha256). Names, emails, phone numbers and ID-like strings
-- are redacted by lib/interview/redact.mjs before a row is written.
--
-- Why the logic lives in functions rather than in the routes: Vercel functions
-- are stateless and two requests for the same turn can race. Each function
-- takes a row lock, so "is this the current turn, is another answer already in
-- flight, is today's budget spent" is decided in one place and atomically.
-- The routes can only reach these tables through the service key.
--
-- Security shape, same as the other tables here: row level security is on with
-- NO policies, so the anon and authenticated keys can read nothing. The
-- functions additionally have execute revoked from those roles, because
-- PostgREST exposes every public function to the anon key by default.
--
-- The interview is seeded CLOSED (jc_flags.interview_enabled = false). It is
-- opened from the board at /interview/admin once a share link exists.

-- jc_flags already exists on the live project. This block only matters on a
-- fresh project, where it creates the same key/value shape the code expects.
do $$
begin
  if to_regclass('public.jc_flags') is null then
    create table public.jc_flags (
      key   text  primary key,
      value jsonb
    );
    alter table public.jc_flags enable row level security;
  end if;
end $$;

-- A share link is the real gate on who can spend. A whole class behind campus
-- Wi-Fi shares one IP, so per-IP limits have to be loose; the link carries the
-- cap instead. One link per group chat, so the board can tell groups apart.
create table if not exists public.jc_iv_links (
  code          text        primary key check (code ~ '^[a-z0-9-]{4,40}$'),
  label         text        not null check (char_length(label) between 1 and 120),
  max_sessions  integer     not null default 60 check (max_sessions between 1 and 5000),
  sessions_used integer     not null default 0,
  expires_at    timestamptz,
  active        boolean     not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.jc_iv_sessions (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  token_hash      text        not null unique,
  link_code       text        references public.jc_iv_links (code) on delete set null,

  -- active     the interview is running
  -- done       it reached its last turn or ran out of time
  -- support    the student mentioned distress; the script stopped and showed
  --            the fixed support message
  -- ended      the student chose to stop
  -- abandoned  the deadline passed with no final answer (set by the daily cron)
  status          text        not null default 'active'
                  check (status in ('active', 'done', 'support', 'ended', 'abandoned')),
  stop_reason     text,

  -- The turn the student is on, and the question waiting for their answer. The
  -- question lives here, not only in jc_iv_turns, so a reload or a duplicate
  -- request can be handed the current question again.
  turn            smallint    not null default 1,
  question        text        not null,
  question_topic  text,
  question_via    text,

  deadline_at     timestamptz not null,
  -- A short lease while one answer is being processed, so a double tap cannot
  -- spend two model calls. It frees itself when it lapses.
  busy_until      timestamptz,

  -- topic -> the turn it was asked at / the first turn the student mentioned
  -- it. "Raised unprompted" is computed from these two, never taken from the
  -- model's word.
  asked           jsonb       not null default '{}'::jsonb,
  mentioned       jsonb       not null default '{}'::jsonb,

  stt_calls       smallint    not null default 0,
  safety_degraded boolean     not null default false,
  finished_at     timestamptz,
  extracted_at    timestamptz,
  summary         jsonb,
  extract_error   text
);

create index if not exists jc_iv_sessions_created_idx
  on public.jc_iv_sessions (created_at desc);
create index if not exists jc_iv_sessions_deadline_idx
  on public.jc_iv_sessions (deadline_at) where status = 'active';
create index if not exists jc_iv_sessions_link_idx
  on public.jc_iv_sessions (link_code, created_at);
create index if not exists jc_iv_sessions_pending_idx
  on public.jc_iv_sessions (finished_at) where extracted_at is null;

create table if not exists public.jc_iv_turns (
  id             bigint      generated always as identity primary key,
  session_id     uuid        not null references public.jc_iv_sessions (id) on delete cascade,
  idx            smallint    not null,
  question       text        not null,
  question_topic text,
  -- How the question was produced: 'schema' (native structured output),
  -- 'prompt' (JSON asked for in the prompt), or 'script' (a written fallback).
  question_via   text,
  answer         text        not null check (char_length(answer) <= 4000),
  answer_via     text        check (answer_via in ('typed', 'voice')),
  redactions     smallint    not null default 0,
  created_at     timestamptz not null default now(),
  unique (session_id, idx)
);

-- One row per UTC day. The caps in lib/interview/config.mjs are checked
-- against these counters inside the functions below.
create table if not exists public.jc_iv_usage (
  day         date    primary key,
  sessions    integer not null default 0,
  turns       integer not null default 0,
  llm_calls   integer not null default 0,
  stt_calls   integer not null default 0,
  stt_seconds integer not null default 0
);

alter table public.jc_iv_links    enable row level security;
alter table public.jc_iv_sessions enable row level security;
alter table public.jc_iv_turns    enable row level security;
alter table public.jc_iv_usage    enable row level security;

-- Start a session. Costs no model call: the first question is scripted.
create or replace function public.jc_iv_start(
  p_token_hash   text,
  p_link         text,
  p_require_link boolean,
  p_question     text,
  p_minutes      integer,
  p_cap_sessions integer
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_day      date := (now() at time zone 'utc')::date;
  v_link     public.jc_iv_links%rowtype;
  v_sessions integer;
  v_id       uuid;
  v_deadline timestamptz;
begin
  if p_link is not null and p_link <> '' then
    select * into v_link from public.jc_iv_links where code = p_link for update;
    if not found
       or not v_link.active
       or (v_link.expires_at is not null and v_link.expires_at < now())
       or v_link.sessions_used >= v_link.max_sessions then
      return jsonb_build_object('ok', false, 'reason', 'link');
    end if;
  elsif p_require_link then
    return jsonb_build_object('ok', false, 'reason', 'link');
  end if;

  insert into public.jc_iv_usage (day) values (v_day) on conflict (day) do nothing;
  select sessions into v_sessions from public.jc_iv_usage where day = v_day for update;
  if v_sessions >= p_cap_sessions then
    return jsonb_build_object('ok', false, 'reason', 'cap');
  end if;
  update public.jc_iv_usage set sessions = sessions + 1 where day = v_day;

  if v_link.code is not null then
    update public.jc_iv_links set sessions_used = sessions_used + 1 where code = v_link.code;
  end if;

  insert into public.jc_iv_sessions
    (token_hash, link_code, deadline_at, question, question_topic, question_via)
  values
    (p_token_hash, v_link.code, now() + make_interval(mins => p_minutes),
     p_question, 'opener', 'script')
  returning id, deadline_at into v_id, v_deadline;

  return jsonb_build_object('ok', true, 'id', v_id, 'deadline_at', v_deadline);
end $$;

-- Claim the right to process one request for the current turn.
--   p_kind = 'turn'  an answer: takes the lease and returns the transcript
--   p_kind = 'stt'   a voice note: counts it against the session's allowance
create or replace function public.jc_iv_claim(
  p_token_hash    text,
  p_turn          integer,
  p_kind          text,
  p_lease_seconds integer,
  p_cap_llm       integer,
  p_cap_stt_secs  integer,
  p_max_stt       integer
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_day   date := (now() at time zone 'utc')::date;
  v_s     public.jc_iv_sessions%rowtype;
  v_u     public.jc_iv_usage%rowtype;
  v_turns jsonb;
begin
  select * into v_s from public.jc_iv_sessions where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'token');
  end if;
  if v_s.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'closed', 'status', v_s.status);
  end if;
  if v_s.turn <> p_turn then
    return jsonb_build_object('ok', false, 'reason', 'turn',
                              'turn', v_s.turn, 'question', v_s.question);
  end if;

  insert into public.jc_iv_usage (day) values (v_day) on conflict (day) do nothing;
  select * into v_u from public.jc_iv_usage where day = v_day for update;

  if p_kind = 'stt' then
    if v_s.stt_calls >= p_max_stt then
      return jsonb_build_object('ok', false, 'reason', 'stt-limit');
    end if;
    if v_u.stt_seconds >= p_cap_stt_secs then
      return jsonb_build_object('ok', false, 'reason', 'cap');
    end if;
    update public.jc_iv_sessions set stt_calls = stt_calls + 1 where id = v_s.id;
    update public.jc_iv_usage set stt_calls = stt_calls + 1 where day = v_day;
    return jsonb_build_object('ok', true, 'id', v_s.id,
                              'deadline_at', v_s.deadline_at, 'now', now());
  end if;

  if v_s.busy_until is not null and v_s.busy_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  if v_u.llm_calls >= p_cap_llm then
    return jsonb_build_object('ok', false, 'reason', 'cap');
  end if;

  update public.jc_iv_sessions
     set busy_until = now() + make_interval(secs => p_lease_seconds)
   where id = v_s.id;
  update public.jc_iv_usage set turns = turns + 1 where day = v_day;

  select coalesce(jsonb_agg(jsonb_build_object(
           'idx', t.idx, 'question', t.question,
           'topic', t.question_topic, 'answer', t.answer) order by t.idx), '[]'::jsonb)
    into v_turns
    from public.jc_iv_turns t
   where t.session_id = v_s.id;

  return jsonb_build_object(
    'ok', true, 'id', v_s.id, 'turn', v_s.turn,
    'created_at', v_s.created_at, 'deadline_at', v_s.deadline_at, 'now', now(),
    'asked', v_s.asked, 'mentioned', v_s.mentioned,
    'question', v_s.question, 'question_topic', v_s.question_topic,
    'question_via', v_s.question_via, 'turns', v_turns);
end $$;

-- Write the answered turn and either queue the next question or close.
--   p_status = 'active'  continue with p_question
--   anything else        the final status ('done', 'support', 'ended')
create or replace function public.jc_iv_commit(
  p_token_hash  text,
  p_turn        integer,
  p_answer      text,
  p_answer_via  text,
  p_redactions  integer,
  p_status      text,
  p_stop_reason text,
  p_question    text,
  p_topic       text,
  p_via         text,
  p_asked       jsonb,
  p_mentioned   jsonb,
  p_degraded    boolean,
  p_llm_calls   integer
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_s   public.jc_iv_sessions%rowtype;
begin
  select * into v_s from public.jc_iv_sessions where token_hash = p_token_hash for update;
  if not found or v_s.status <> 'active' or v_s.turn <> p_turn then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;

  insert into public.jc_iv_turns
    (session_id, idx, question, question_topic, question_via, answer, answer_via, redactions)
  values
    (v_s.id, v_s.turn, v_s.question, v_s.question_topic, v_s.question_via,
     p_answer, p_answer_via, coalesce(p_redactions, 0));

  if p_status = 'active' then
    update public.jc_iv_sessions
       set turn = turn + 1,
           question = p_question, question_topic = p_topic, question_via = p_via,
           asked = coalesce(p_asked, asked), mentioned = coalesce(p_mentioned, mentioned),
           busy_until = null,
           safety_degraded = safety_degraded or coalesce(p_degraded, false)
     where id = v_s.id;
  else
    update public.jc_iv_sessions
       set status = p_status, stop_reason = p_stop_reason, finished_at = now(),
           asked = coalesce(p_asked, asked), mentioned = coalesce(p_mentioned, mentioned),
           busy_until = null,
           safety_degraded = safety_degraded or coalesce(p_degraded, false)
     where id = v_s.id;
  end if;

  insert into public.jc_iv_usage (day, llm_calls) values (v_day, coalesce(p_llm_calls, 0))
  on conflict (day) do update set llm_calls = public.jc_iv_usage.llm_calls + excluded.llm_calls;

  return jsonb_build_object('ok', true, 'id', v_s.id);
end $$;

-- Close an active session without an answer: the student pressed stop, or the
-- clock ran out before they replied.
create or replace function public.jc_iv_finish(
  p_token_hash  text,
  p_status      text,
  p_stop_reason text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_s public.jc_iv_sessions%rowtype;
begin
  select * into v_s from public.jc_iv_sessions where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'token');
  end if;
  if v_s.status <> 'active' then
    return jsonb_build_object('ok', true, 'id', v_s.id, 'status', v_s.status, 'turn', v_s.turn);
  end if;
  update public.jc_iv_sessions
     set status = p_status, stop_reason = p_stop_reason,
         finished_at = now(), busy_until = null
   where id = v_s.id;
  return jsonb_build_object('ok', true, 'id', v_s.id, 'status', p_status, 'turn', v_s.turn);
end $$;

-- Add spend that happens outside a turn commit: transcription seconds, and the
-- extractor's model call.
create or replace function public.jc_iv_count(
  p_llm_calls   integer,
  p_stt_seconds integer
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  insert into public.jc_iv_usage (day, llm_calls, stt_seconds)
  values (v_day, coalesce(p_llm_calls, 0), coalesce(p_stt_seconds, 0))
  on conflict (day) do update
    set llm_calls   = public.jc_iv_usage.llm_calls + excluded.llm_calls,
        stt_seconds = public.jc_iv_usage.stt_seconds + excluded.stt_seconds;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.jc_iv_start(text, text, boolean, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.jc_iv_claim(text, integer, text, integer, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.jc_iv_commit(text, integer, text, text, integer, text, text, text, text, text, jsonb, jsonb, boolean, integer)
  from public, anon, authenticated;
revoke all on function public.jc_iv_finish(text, text, text)
  from public, anon, authenticated;
revoke all on function public.jc_iv_count(integer, integer)
  from public, anon, authenticated;

grant execute on function public.jc_iv_start(text, text, boolean, text, integer, integer) to service_role;
grant execute on function public.jc_iv_claim(text, integer, text, integer, integer, integer, integer) to service_role;
grant execute on function public.jc_iv_commit(text, integer, text, text, integer, text, text, text, text, text, jsonb, jsonb, boolean, integer) to service_role;
grant execute on function public.jc_iv_finish(text, text, text) to service_role;
grant execute on function public.jc_iv_count(integer, integer) to service_role;

-- Seeded closed. Written without "on conflict" so it does not depend on which
-- constraint jc_flags.key happens to carry on the live project.
insert into public.jc_flags (key, value)
select 'interview_enabled', 'false'::jsonb
where not exists (select 1 from public.jc_flags where key = 'interview_enabled');

-- Tell PostgREST about the new tables and functions straight away.
notify pgrst, 'reload schema';
