-- Sync gaps found by the 9-tester audit (Jul 18 2026)
--
-- quests.recur_stopped — explicit "repeat turned OFF" tombstone.
--   Without it a cancelled recurrence (recur:null) was
--   indistinguishable from a pre-migration row, and the
--   local-preferred merge resurrected the rule on other devices.
-- checkins.mood_x/mood_y — the real coordinates the user placed.
--   Without them a 2nd device planted every synced check-in at a
--   fabricated neutral energy 50 (honest-data violation).
-- users.avatar / users.room_tint — the picked cat skin + room color.
--   These were device-local, so a reinstall reverted the cat.

alter table public.quests
  add column if not exists recur_stopped boolean not null default false;

alter table public.checkins
  add column if not exists mood_x double precision,
  add column if not exists mood_y double precision;

alter table public.users
  add column if not exists avatar text,
  add column if not exists room_tint text;
