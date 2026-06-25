-- Lumi · ai_usage tracking + server-side AI quota
--
-- Backs the anthropic-proxy Edge Function so the Anthropic API key
-- never ships in the client bundle (security-critical per
-- BUILD-STATUS §1). The Edge Function inserts a row per LLM call,
-- and reads has_ai_quota() before invoking Anthropic so free users
-- can't bypass the weekly cap by editing the client.
--
-- Premium (active subscription OR within the 7-day trial) is
-- unlimited; the cap only applies to users without access.

create type public.ai_kind as enum (
  'brain_dump',
  'checkin',
  'followup',
  'title_clean',
  'weekly_report'
);

create table if not exists public.ai_usage (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        public.ai_kind not null,
  called_at   timestamptz not null default now(),
  tokens_in   int,
  tokens_out  int
);

create index if not exists ai_usage_user_called_idx
  on public.ai_usage (user_id, called_at desc);

create index if not exists ai_usage_user_kind_week_idx
  on public.ai_usage (user_id, kind, called_at);

alter table public.ai_usage enable row level security;

-- Users can SELECT their own usage (so the client can show "X of 5
-- brain-dumps used this week" in Profile / Insights later). They
-- can't write — the Edge Function uses the service role to insert.
create policy ai_usage_select_own
  on public.ai_usage for select
  using (auth.uid() = user_id);

-- Per-kind weekly caps for free users. Premium = unlimited.
-- brain_dump 5/week is the spec's named example; the others are
-- proportional to expected volume. title_clean fires per capture so
-- it's the highest; weekly_report is once.
create or replace function public.ai_weekly_cap(k public.ai_kind)
returns int
language sql immutable
as $$
  select case k
    when 'brain_dump'    then 5
    when 'checkin'       then 5
    when 'followup'      then 8
    when 'title_clean'   then 30
    when 'weekly_report' then 2
  end
$$;

-- True if the user has remaining quota for this kind THIS week.
-- Premium (has_access = true) skips the count entirely. Week resets
-- on a rolling 7-day window from now() — simpler than calendar
-- weeks, no DST/timezone confusion, and matches user mental model
-- ("you've made 5 in the last 7 days").
create or replace function public.has_ai_quota(u uuid, k public.ai_kind)
returns boolean
language sql stable
as $$
  select
    case
      when public.has_access(u) then true
      else (
        select count(*) < public.ai_weekly_cap(k)
        from public.ai_usage
        where user_id = u
          and kind = k
          and called_at > now() - interval '7 days'
      )
    end
$$;
