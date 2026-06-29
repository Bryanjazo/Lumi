-- Lumi · subscription_columns
-- Required-auth model: every user starts on a 7-day trial (derived from
-- users.created_at) and must subscribe to continue. The IAP wiring lands
-- in a later migration; for now we just store the state.

alter table public.users
  add column if not exists subscription_status text
    not null default 'trial'
    check (subscription_status in ('trial','active','past_due','cancelled','expired')),
  add column if not exists subscription_tier text
    check (subscription_tier in ('monthly','annual')),
  add column if not exists subscription_current_period_end timestamptz;

-- Helper used by both client and (future) server checks.
create or replace function public.has_access(u uuid)
returns boolean
language sql stable
as $$
  select
    case
      when (select subscription_status from public.users where id = u) = 'active'
        then true
      when (select subscription_status from public.users where id = u) in ('past_due','cancelled','expired')
        then false
      else
        (select created_at from public.users where id = u) > now() - interval '7 days'
    end
$$;
