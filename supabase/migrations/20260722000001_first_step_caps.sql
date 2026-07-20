-- Cap + premium-bucket mappings for the new 'first_step' kind.
-- (Separate migration: ALTER TYPE ... ADD VALUE must commit before
-- the new value is usable in function bodies.)
--
-- first_step is FREE-usable (weekly cap 5), unlike Pro-only clarify:
-- the "one small first step" promise is made to every user in
-- onboarding, and the call is a ~15-output-token Haiku one-liner —
-- cheap enough to honor for everyone. Premium slots into the
-- 'capture' bucket alongside title_clean/clarify (it's a capture-
-- adjacent micro-pass, not a conversation).

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
    when 'first_step'    then 5   -- free: ~one heavy task split per weekday
  end
$$;

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
    when 'first_step'    then 'capture'
    when 'weekly_report' then 'weekly_report'
  end
$$;
