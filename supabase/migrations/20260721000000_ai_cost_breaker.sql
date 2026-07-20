-- Lumi · Global AI cost breaker + kill switch + day-one triage view
--
-- Per-user quotas (has_ai_quota, earlier migrations) cap what any ONE
-- account can spend. They do NOT cap the WHOLE app: a bug that fans
-- AI calls across many accounts — each comfortably under its own cap —
-- can still run the aggregate Anthropic bill away, and there was no
-- single lever to cut all AI in an emergency without shipping a client
-- release. This migration adds both:
--
--   1. app_config      — a tiny key/value store for server-flippable
--                        switches (no client, no deploy needed to change
--                        a value — just UPDATE the row).
--   2. global_ai_budget_ok()
--                      — one RPC the anthropic-proxy calls right before
--                        hitting Anthropic. Returns FALSE if the kill
--                        switch is on OR today's total logged usage
--                        crosses a generous, whole-app daily ceiling.
--                        The proxy turns a FALSE into the same 429 a
--                        quota hit produces, so every client falls back
--                        to its deterministic engine with zero changes.
--   3. recent_fatal_errors
--                      — the day-one triage view: fatal client_errors
--                        from the last 24h, grouped with a count and the
--                        latest sample per message.
--
-- DEPLOY NOTE: this is repo-only. It must be applied to the database
-- (`supabase db push` / migration deploy) AND the anthropic-proxy
-- function must be redeployed (`supabase functions deploy anthropic-
-- proxy`) for the new RPC call to resolve. Apply the migration FIRST,
-- then deploy the function — otherwise the proxy's rpc() call 500s
-- until the function exists (the client would just fall back to
-- deterministic in the meantime, but avoid the noise).

-- ── 1. app_config: server-flippable switches ──────────────────────
-- key/value with a jsonb value so a switch can be a scalar (a bool
-- flag) or a small object (a budget with named ceilings) without a
-- schema change per switch.
create table if not exists public.app_config (
  key   text primary key,
  value jsonb not null
);

-- No RLS policies on purpose: RLS is ON and no policy is defined, so
-- ordinary users (anon/authenticated) can neither read nor write it.
-- Only the service role — which bypasses RLS — touches app_config,
-- and that is exactly the anthropic-proxy Edge Function. A leaked kill
-- switch or budget number would be a griefing lever, so it stays
-- server-only.
alter table public.app_config enable row level security;

-- Seeds:
--   ai_killswitch  — master off-switch for ALL AI. false = normal.
--                    Flip to true (UPDATE app_config SET value = 'true'
--                    WHERE key = 'ai_killswitch') to cut every AI call
--                    app-wide within one request, no deploy.
--   ai_daily_budget — the generous whole-app ceiling, checked over a
--                    rolling 24h window. Two independent caps, either
--                    of which trips the breaker:
--                      max_requests — count of ai_usage rows / day.
--                        200k requests/day is far above any real day —
--                        this is a runaway/abuse backstop, not a
--                        throttle.
--                      max_tokens   — sum of (tokens_in + tokens_out)
--                        across those rows. ~200k requests × ~3k tokens
--                        ≈ 600M; seeded there so the two caps trip at a
--                        similar scale. Rows with null token counts
--                        contribute 0 to the sum (coalesced below).
insert into public.app_config (key, value) values
  ('ai_killswitch',  'false'::jsonb),
  ('ai_daily_budget', '{"max_requests": 200000, "max_tokens": 600000000}'::jsonb)
on conflict (key) do nothing;

-- ── 2. global_ai_budget_ok(): the breaker the proxy calls ──────────
-- Returns true when AI is allowed to proceed globally. The proxy calls
-- this AFTER the per-user has_ai_quota check and treats anything but an
-- explicit true as a trip (fail-closed, mirroring has_ai_quota).
--
-- Reads two app_config rows + one aggregate over ai_usage's last 24h.
-- Called via the service role (RLS bypassed), so no SECURITY DEFINER is
-- needed — matching how has_ai_quota is invoked from the proxy.
create or replace function public.global_ai_budget_ok()
returns boolean
language plpgsql
stable
as $$
declare
  kill         boolean;
  budget       jsonb;
  max_requests bigint;
  max_tokens   bigint;
  req_count    bigint;
  tok_sum      bigint;
begin
  -- Kill switch first — cheapest short-circuit. `#>> '{}'` extracts a
  -- scalar jsonb (`true`/`false`) as text so it can cast to boolean.
  select coalesce((value #>> '{}')::boolean, false)
    into kill
    from public.app_config
    where key = 'ai_killswitch';
  if coalesce(kill, false) then
    return false;
  end if;

  select value into budget
    from public.app_config
    where key = 'ai_daily_budget';
  -- Missing budget row → fail OPEN. A cost ceiling that vanished
  -- should not silently take AI down for everyone; the kill switch is
  -- the intentional off-lever, not a missing config row.
  if budget is null then
    return true;
  end if;

  max_requests := coalesce((budget ->> 'max_requests')::bigint, 200000);
  max_tokens   := coalesce((budget ->> 'max_tokens')::bigint,   600000000);

  -- One pass over the rolling 24h window. tokens_in/tokens_out are
  -- nullable (the proxy writes null when Anthropic omits usage), so
  -- coalesce each to 0 before summing.
  select
      count(*),
      coalesce(sum(coalesce(tokens_in, 0) + coalesce(tokens_out, 0)), 0)
    into req_count, tok_sum
    from public.ai_usage
    where called_at > now() - interval '1 day';

  return req_count < max_requests and tok_sum < max_tokens;
end;
$$;

-- ── 3. recent_fatal_errors: day-one triage ─────────────────────────
-- The fastest "what's on fire right now" query. Groups the last 24h of
-- FATAL client_errors (uncaught JS / unhandled rejection / render
-- boundary — see lib/errorReport.ts) by message so a single crashing
-- code path shows as one row with an occurrence count instead of N
-- near-identical rows. Carries the latest sample (stack + versions +
-- who) so triage can jump straight to the newest reproduction.
--
-- client_errors has RLS with no SELECT policy, so this view is meant to
-- be queried by the service role / SQL editor during an incident, not
-- by app clients. security_invoker is REQUIRED for that to hold: a
-- plain view runs with its owner's rights and would silently bypass
-- client_errors' RLS for anyone Supabase auto-grants SELECT to. With
-- invoker rights, anon/authenticated hit the RLS wall (no SELECT
-- policy → zero rows); service role bypasses RLS as always. Belt and
-- braces: revoke the auto-grants too.
create or replace view public.recent_fatal_errors
  with (security_invoker = true) as
  select
    message,
    count(*)                              as occurrences,
    count(distinct user_id)               as affected_users,
    min(created_at)                       as first_seen,
    max(created_at)                       as last_seen,
    (array_agg(stack       order by created_at desc))[1] as latest_stack,
    (array_agg(app_version order by created_at desc))[1] as latest_app_version,
    (array_agg(platform    order by created_at desc))[1] as latest_platform,
    (array_agg(user_id     order by created_at desc))[1] as latest_user_id
  from public.client_errors
  where fatal = true
    and created_at > now() - interval '24 hours'
  group by message
  order by occurrences desc, last_seen desc;

revoke all on public.recent_fatal_errors from anon, authenticated;
