-- Lumi · fatal_error_summary(): the day-one pager
--
-- recent_fatal_errors (20260721000000_ai_cost_breaker.sql) is the right
-- triage query, but it's service-role-only by design: it's a
-- security_invoker view over client_errors, which has RLS with no SELECT
-- policy — so anon/authenticated hit the RLS wall and see zero rows. That
-- makes it perfect for the SQL editor during an incident and useless from
-- inside the app.
--
-- Bryan opens his own TestFlight build every day. Giving that build a
-- tiny "is anything on fire?" readout means crashes surface where a human
-- actually looks, instead of only when someone remembers to open the SQL
-- editor. This function is the bridge — the day-one pager until a real
-- alerting channel (email/push on a fatal spike) exists.
--
-- SECURITY DEFINER so it can read client_errors past that RLS wall, but
-- it's gated HARD: it returns rows ONLY when the caller is a flagged
-- tester (public.users.is_tester — the same server column that flows
-- server → sync → userStore.isTester). Everyone else gets an empty set,
-- so a leaked call from an ordinary account learns nothing.
--
-- It reads public.client_errors DIRECTLY, not through recent_fatal_errors:
-- that view is security_invoker, so a definer function querying it would
-- run the view body as the *invoker* and hit the same RLS wall we're
-- trying to step past. Going straight to the base table keeps the definer
-- privilege intact.
--
-- Aggregate-only, no group by → always exactly one row for a tester
-- (fatal_24h = 0 with null message/timestamp on a quiet day). One RPC,
-- one row, no per-message fan-out — the client only needs the headline.
--
-- search_path = '' so every object is schema-qualified and can't be
-- shadowed; this is the standard hardening for a definer function.
create or replace function public.fatal_error_summary()
returns table (
  fatal_24h       int,
  affected_users  int,
  latest_message  text,
  latest_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Gate: testers only. auth.uid() is null for the service role and for
  -- unauthenticated callers, so both fall through to the empty return —
  -- exactly the RLS-equivalent posture we want. A non-tester gets zero
  -- rows, not a row of zeros.
  if not exists (
    select 1 from public.users
    where id = auth.uid() and is_tester
  ) then
    return;
  end if;

  return query
    select
      count(*)::int                                             as fatal_24h,
      count(distinct ce.user_id)::int                           as affected_users,
      (array_agg(ce.message order by ce.created_at desc))[1]    as latest_message,
      max(ce.created_at)                                        as latest_at
    from public.client_errors ce
    where ce.fatal = true
      and ce.created_at > now() - interval '24 hours';
end;
$$;

-- anon never needs this; only a signed-in tester does. Fail-closed
-- surface area: revoke the default execute, then grant to authenticated.
revoke all on function public.fatal_error_summary() from public, anon;
grant execute on function public.fatal_error_summary() to authenticated;
