-- Lumi · split Untangle from brain_dump quota; drop dead `checkin`
--
-- Per lumi-untangle-quota-split-spec.md:
--   1) The Untangle conversation currently rides on the brain_dump
--      kind, sharing capture's 5/week budget. Give it its own kind so
--      the two don't cannibalize and each can be tuned independently.
--   2) The `checkin` AI kind is dead (retired emotional Check-in —
--      no client code references it). Remove it.
--
-- Postgres can't drop an enum value in place, so we recreate the
-- type. Order matters: drop functions that reference it, swap the
-- column over, drop the old type, then re-create the functions
-- against the new type.

-- ── 1. Drop functions that bind to the old enum ────────────────────
-- Both the original quota helpers and the premium-daily ceiling
-- helper from the prior migration reference the type — they all
-- need to come down so the type can be renamed.
drop function if exists public.has_ai_quota(uuid, public.ai_kind);
drop function if exists public.ai_weekly_cap(public.ai_kind);
drop function if exists public.ai_premium_bucket(public.ai_kind);

-- ── 2. Rename old type → temp, create new type with the split ──────
alter type public.ai_kind rename to ai_kind_old;

create type public.ai_kind as enum (
  'brain_dump',
  'untangle',          -- NEW: Untangle conversation, its own budget
  'followup',
  'title_clean',
  'weekly_report'
);

-- ── 3. Migrate the ai_usage.kind column to the new type ────────────
-- Legacy 'checkin' rows map to 'untangle' — closest live feature, so
-- historical usage counts aren't simply orphaned. (Harmless either
-- way; these are 7-day rolling counts that age out fast.)
alter table public.ai_usage
  alter column kind type public.ai_kind
  using (
    case
      when kind::text = 'checkin' then 'untangle'
      else kind::text
    end
  )::public.ai_kind;

drop type public.ai_kind_old;

-- ── 4. Re-create the free weekly caps on the new enum ──────────────
-- 'untangle' gets its own 5/week start — sensible mirror of brain_dump;
-- tune freely later (3 to make the premium hook sharper, etc.).
create or replace function public.ai_weekly_cap(k public.ai_kind)
returns int
language sql immutable
as $$
  select case k
    when 'brain_dump'    then 5    -- capture parsing
    when 'untangle'      then 5    -- Untangle conversation (own budget)
    when 'followup'      then 8
    when 'title_clean'   then 30
    when 'weekly_report' then 2
  end
$$;

-- ── 5. Re-create the premium-daily bucket map on the new enum ──────
-- Conversation bucket now groups brain_dump + untangle + followup
-- (all chatty surfaces). Capture stays its own bucket so heavy
-- captures don't eat conversation headroom.
create or replace function public.ai_premium_bucket(k public.ai_kind)
returns text
language sql immutable
as $$
  select case k
    when 'brain_dump'    then 'conversation'
    when 'untangle'      then 'conversation'
    when 'followup'      then 'conversation'
    when 'title_clean'   then 'capture'
    when 'weekly_report' then 'weekly_report'
  end
$$;

-- ── 6. Re-create has_ai_quota (same shape, new enum binding) ───────
-- Premium: per-bucket daily ceiling (from ai_premium_daily_cap, set
-- in the prior migration — that function takes a text bucket so it
-- doesn't depend on the enum).
-- Free: per-kind weekly cap (rolling 7-day window).
create or replace function public.has_ai_quota(u uuid, k public.ai_kind)
returns boolean
language sql stable
as $$
  select
    case
      when public.has_access(u) then (
        select count(*) < public.ai_premium_daily_cap(public.ai_premium_bucket(k))
        from public.ai_usage usage
        where usage.user_id = u
          and public.ai_premium_bucket(usage.kind) = public.ai_premium_bucket(k)
          and usage.called_at > now() - interval '1 day'
      )
      else (
        select count(*) < public.ai_weekly_cap(k)
        from public.ai_usage
        where user_id = u
          and kind = k
          and called_at > now() - interval '7 days'
      )
    end
$$;
