-- FIX: the previous migration renamed premium buckets incorrectly
-- (title_clean → 'conversation', weekly_report → 'report'), which
-- made ai_premium_daily_cap() return NULL and count < NULL evaluate
-- to NULL — silently failing premium quota checks. Restore the
-- original mapping exactly and slot 'clarify' into 'capture' (it is
-- a capture-repair pass).

create or replace function public.ai_premium_bucket(k public.ai_kind)
returns text
language sql immutable
as $$
  select case k
    when 'brain_dump'    then 'conversation'
    when 'untangle'      then 'conversation'
    when 'followup'      then 'conversation'
    when 'title_clean'   then 'capture'
    when 'clarify'       then 'capture'
    when 'weekly_report' then 'weekly_report'
  end
$$;
