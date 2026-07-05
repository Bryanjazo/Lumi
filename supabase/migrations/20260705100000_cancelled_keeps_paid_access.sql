-- CANCELLATION ≠ lost access. In RevenueCat, a CANCELLATION event
-- means the user turned OFF auto-renew — they stay PAID until the
-- period ends (RC fires EXPIRATION then, and the webhook already
-- writes 'expired'). has_access() treated 'cancelled' as free
-- instantly, so a paying customer who disabled auto-renew lost AI
-- features mid-period (found live: dev account went 'cancelled' via
-- a sandbox auto-cancel and clarify started 429ing while the client
-- correctly showed Pro). 'past_due' gets the same courtesy — Apple
-- billing-retry grace shouldn't cut features while RC still shows
-- the entitlement.

create or replace function public.has_access(u uuid)
returns boolean
language sql stable
as $$
  select coalesce((
    select
      subscription_status = 'active'
      or (
        subscription_status in ('cancelled', 'past_due')
        and subscription_current_period_end > now()
      )
      or trial_started_at > now() - interval '7 days'
    from public.users
    where id = u
  ), false)
$$;
