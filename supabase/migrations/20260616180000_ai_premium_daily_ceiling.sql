-- Lumi · Premium daily AI ceiling
--
-- Per lumi-ai-cost-economics-v2.md §5: premium is "unlimited in feel"
-- but bounded by a generous, mostly-invisible daily ceiling that
-- collapses the whale case toward the heavy case. Without this, a
-- tiny % of whales could exceed $70/yr of AI cost on a $51 net plan
-- (the one real money-losing failure mode in the new economics).
--
-- Free users keep the per-kind weekly cap (migration ..._ai_usage).
-- Premium users now ALSO have a per-bucket DAILY cap; hitting it
-- returns the same 429 the free cap uses, so the client falls back
-- to the deterministic path silently — graceful degradation, never
-- a hard "you're cut off."
--
-- Cap buckets (grouping kinds the user perceives as one feature):
--   conversation  — brain_dump (Untangle conversation + brain dump
--                   reuse this kind) + checkin + followup. The
--                   chatty surface. ~60/day is far above normal use.
--   capture       — title_clean (smart capture's structured extract
--                   fires here). ~50/day handles even a heavy day
--                   of ADHD-rapid capture without throttling.
--   weekly_report — recap is per-week and cheap; 2/day is generous.

-- Map ai_kind → its premium-daily bucket. Used inside has_ai_quota.
create or replace function public.ai_premium_bucket(k public.ai_kind)
returns text
language sql immutable
as $$
  select case k
    when 'brain_dump'    then 'conversation'
    when 'checkin'       then 'conversation'
    when 'followup'      then 'conversation'
    when 'title_clean'   then 'capture'
    when 'weekly_report' then 'weekly_report'
  end
$$;

-- Per-bucket premium daily cap. Numbers picked so normal use never
-- approaches them; only the whale tail hits.
create or replace function public.ai_premium_daily_cap(bucket text)
returns int
language sql immutable
as $$
  select case bucket
    when 'conversation'  then 60
    when 'capture'       then 50
    when 'weekly_report' then 2
  end
$$;

-- Replace has_ai_quota so it now layers the premium daily ceiling
-- on top of the existing free weekly cap. The signature is the
-- same — the Edge Function doesn't change.
--
-- Logic:
--   1. If no access (free / trial-ended / past-due) → keep the
--      existing per-kind weekly cap behavior.
--   2. If access (active subscription / inside trial) → check the
--      premium daily cap for this kind's bucket; allow if under.
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

-- Index that makes the premium-daily count cheap. The earlier
-- (user_id, called_at desc) index covers the 1-day window, but a
-- combined (user_id, kind, called_at) index already exists from the
-- prior migration so we don't add another.
