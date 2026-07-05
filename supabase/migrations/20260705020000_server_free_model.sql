-- Align the SERVER subscription model with the client's opt-in-trial
-- model. Two stacked bugs made free caps decorative:
--   1. ai_usage was never written (lazy supabase-js builder — fixed
--      in the proxy), so counts were always 0.
--   2. has_access() granted access to ANY account younger than 7
--      days (legacy "everyone starts on trial"), so caps never even
--      applied in week one — the client had long moved to opt-in
--      trials (trialStartedAt) but the server was never migrated.
--
-- New model: default 'free'; trial is an explicit, once-only opt-in
-- recorded in trial_started_at via the start_trial() RPC (clients
-- can't push subscription columns directly — a client that could
-- set trial_started_at freely could farm trials).

alter table public.users
  drop constraint if exists users_subscription_status_check;
alter table public.users
  add constraint users_subscription_status_check
  check (subscription_status in ('free','trial','active','past_due','cancelled','expired'));
alter table public.users
  alter column subscription_status set default 'free';

alter table public.users
  add column if not exists trial_started_at timestamptz;

-- Existing rows: 'trial' was the old default, not a choice — reset
-- to 'free'. (Anyone mid-legacy-trial keeps client-side access via
-- their local trialStartedAt and can start_trial() to register it.)
update public.users set subscription_status = 'free'
  where subscription_status = 'trial';

create or replace function public.has_access(u uuid)
returns boolean
language sql stable
as $$
  select
    case
      when (select subscription_status from public.users where id = u) = 'active'
        then true
      when (select trial_started_at from public.users where id = u)
             > now() - interval '7 days'
        then true
      else false
    end
$$;

-- Once-only trial opt-in. SECURITY DEFINER so it can write the
-- column the client can't touch; auth.uid() scoping so you can only
-- start your own; coalesce makes it immutable after first call.
create or replace function public.start_trial()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  started timestamptz;
begin
  update public.users
     set trial_started_at = coalesce(trial_started_at, now()),
         subscription_status = case
           when subscription_status = 'free' then 'trial'
           else subscription_status
         end
   where id = auth.uid()
   returning trial_started_at into started;
  return started;
end;
$$;

revoke all on function public.start_trial() from public;
grant execute on function public.start_trial() to authenticated;
