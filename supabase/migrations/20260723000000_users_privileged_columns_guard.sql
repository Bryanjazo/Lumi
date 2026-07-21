-- SECURITY (critical): the "users self update" RLS policy scopes to
-- auth.uid() = id but places NO column restriction, and authenticated
-- holds table-level UPDATE — so any user with a valid JWT could PATCH
-- their OWN users row to set subscription_status = 'active' (permanent
-- free Pro, since has_access() treats 'active' as unexpiring) or
-- is_tester = true (which unlocks fatal_error_summary() and leaks other
-- users' crash data across the client_errors RLS wall).
--
-- RLS can't express "these columns are read-only for the owner" (a
-- policy's WITH CHECK can't see OLD), and column-level REVOKE is inert
-- while the table-level UPDATE grant stands. So we guard with a BEFORE
-- UPDATE trigger that pins the privileged columns to their OLD values
-- for ordinary end-user writes, while letting the legitimate writers
-- through untouched:
--   • the RevenueCat webhook writes with the SERVICE ROLE key
--     (current_user = 'service_role');
--   • start_trial() is SECURITY DEFINER (current_user = the function
--     owner, not 'authenticated'), so it still stamps trial_started_at
--     + subscription_status = 'trial'.
-- A normal sync push never touches these columns, so pinning them to
-- their existing values is a no-op there — this cannot break sync.

create or replace function public.guard_user_privileged_cols()
returns trigger
language plpgsql
-- INVOKER (default): current_user must reflect the TRUE caller so a
-- direct PostgREST update runs as 'authenticated'/'anon' and a
-- SECURITY DEFINER RPC runs as its owner.
set search_path = ''
as $$
begin
  -- Only direct end-user requests are constrained. Service role (the
  -- webhook) and SECURITY DEFINER RPCs (start_trial) are the sanctioned
  -- writers and pass through unchanged.
  if current_user in ('authenticated', 'anon') then
    new.subscription_status             := old.subscription_status;
    new.subscription_tier               := old.subscription_tier;
    new.subscription_current_period_end := old.subscription_current_period_end;
    new.trial_started_at                := old.trial_started_at;
    new.is_tester                       := old.is_tester;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_user_privileged_cols on public.users;
create trigger guard_user_privileged_cols
  before update on public.users
  for each row
  execute function public.guard_user_privileged_cols();
