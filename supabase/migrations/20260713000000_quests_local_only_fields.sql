-- Lumi · persist the quest fields the cloud round-trip was dropping.
--
-- The `quests` table historically covered only a subset of the client
-- Quest model. window / note / comment / recur / last_spawned_date /
-- xp_paid had NO columns, so pushQuests never sent them and the pull
-- rebuilt each quest without them — silently wiping recurrence (habits
-- stopped repeating), notes/comments, window placement, and the
-- once-ever xp_paid stamp (which re-opened an XP double-pay farm) on
-- every cold start for signed-in users.
--
-- The client now MERGES these local-only fields on pull so the primary
-- device stops losing data immediately. This migration adds the
-- columns so the data can actually round-trip to the cloud (real
-- multi-device / reinstall durability). Additive + idempotent; safe to
-- run on a live DB. After applying, wire pushQuests + pullAll to
-- read/write these columns.

alter table public.quests
  -- "window" is a reserved keyword in Postgres — MUST be quoted in the
  -- ADD COLUMN clause or the entire ALTER fails to parse. The actual
  -- column name is still lowercase `window`, so client reads (r.window
  -- via PostgREST) are unaffected.
  add column if not exists "window" text,
  add column if not exists note text,
  add column if not exists comment text,
  add column if not exists recur jsonb,
  add column if not exists last_spawned_date text,
  add column if not exists xp_paid boolean not null default false;

comment on column public.quests.window is
  'Fuzzy time window (morning/midday/afternoon/evening/someday) for unanchored tasks; the client owns this.';
comment on column public.quests.recur is
  'Recurrence rule (RecurRule JSON) — null for one-off tasks.';
comment on column public.quests.last_spawned_date is
  'YMD of the last spawned instance of a recurring template.';
comment on column public.quests.xp_paid is
  'Once-ever economy stamp — a task that has paid XP/shards must never pay again.';
