-- Lumi · persist the lifetime ledgers so history survives reinstall
-- and reaches a second device.
--
-- done_log (per-day completion counts), tasks_ever_completed, and
-- focus_minutes_lifetime were local-only on the users row, so a
-- reinstall or 2nd device showed empty Patterns and "N tasks ever" = 0
-- even for a user with real history — an honest-data gap that
-- UNDER-states progress. These are monotonic ledgers; the client
-- max-merges cloud into local ON PULL (per-day max for done_log) and
-- only pushes the ledgers AFTER that merge, so normal single-device
-- sync keeps history. Additive + idempotent.

alter table public.users
  add column if not exists done_log jsonb not null default '{}'::jsonb,
  add column if not exists tasks_ever_completed integer not null default 0,
  add column if not exists focus_minutes_lifetime integer not null default 0;

comment on column public.users.done_log is
  'Deletion-proof per-day completion ledger {YMD: count} — powers Patterns/recap even after quests are deleted.';
comment on column public.users.tasks_ever_completed is
  'Lifetime count of completed tasks; monotonic, merged by max.';
comment on column public.users.focus_minutes_lifetime is
  'Lifetime focus-session minutes; monotonic, merged by max.';
