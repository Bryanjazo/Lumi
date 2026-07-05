-- Cap + premium-bucket mappings for the new 'clarify' kind.
-- (Separate migration: ALTER TYPE ... ADD VALUE must commit before
-- the new value is usable in function bodies.)

create or replace function public.ai_weekly_cap(k public.ai_kind)
returns int
language sql immutable
as $$
  select case k
    when 'brain_dump'    then 3
    when 'untangle'      then 5
    when 'followup'      then 5
    when 'title_clean'   then 10
    when 'weekly_report' then 2
    when 'clarify'       then 0   -- Pro-only: free never spends here
  end
$$;

create or replace function public.ai_premium_bucket(k public.ai_kind)
returns text
language sql immutable
as $$
  select case k
    when 'weekly_report' then 'report'
    when 'clarify'       then 'conversation'
    else 'conversation'
  end
$$;
