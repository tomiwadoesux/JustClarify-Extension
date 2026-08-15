-- Applied 2026-08-13 by hand in the Supabase SQL editor (project
-- rwqkngtllxoljxccodod), so it is NOT in Supabase's own migration history.
-- This file is the record. Both statements are idempotent, so re-running it
-- through the CLI later is safe and would reconcile the two.
--
-- Numbered 004 rather than 002 despite landing first: 002 was taken by the
-- report-notes migration in the same week, and a sequence with two 002s is a
-- sequence you cannot read. The number is a label here, not an order of
-- execution, because every file in this folder is independent.
--
-- It must land before the fix-target code deploys: the board's select list
-- asks for these columns and PostgREST refuses the whole query if either is
-- missing.
--
-- fix_target      where the candidate fix landed, computed by the agent from
--                 the files it touched: 'site' | 'extension' | 'mixed'.
-- fix_shipped_in  null until the fix is actually in users' hands. For a site
--                 fix that means merged and deployed ("live"); for an
--                 extension fix it is the store version that carries it
--                 ("v0.6.2"). Set from the admin panel, never automatically,
--                 because only a human knows when the store review finished.
--
-- Why they exist: an extension fix is not runnable by anyone until a new
-- version clears the Chrome Web Store, so inviting "did this fix it?" votes
-- the moment the pull request opens collects honest No votes that really mean
-- "the store has not updated yet". These two columns let the board hold the
-- vote until there is something to test.

alter table jc_reports add column if not exists fix_target text;
alter table jc_reports add column if not exists fix_shipped_in text;
