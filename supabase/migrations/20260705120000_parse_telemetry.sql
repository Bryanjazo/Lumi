-- Parse-quality telemetry (tier 1) + tester capture feedback (tier 3).
--
-- parse_metrics: ZERO text content by design — route/reason/edited
-- only. Answers "where does parsing fail" (edit-rate per route) with
-- nothing to leak. Client-write-only: no select policy, dashboards
-- read with service role. Falls under the Usage Data privacy label
-- already published.
--
-- capture_feedback: RAW capture text + parse result, ONLY from
-- accounts with users.is_tester = true (internal/TestFlight testers,
-- disclosed in beta notes). RLS enforces the flag server-side; the
-- client also checks it so non-tester text never even leaves the
-- device.

alter table public.users
  add column if not exists is_tester boolean not null default false;

create table if not exists public.parse_metrics (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  client_date date not null,
  route text not null,
  reason text not null,
  latency_ms integer not null default 0,
  edited boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);

alter table public.parse_metrics enable row level security;

create policy parse_metrics_insert_own on public.parse_metrics
  for insert to authenticated
  with check (user_id = auth.uid());

-- Upsert needs UPDATE on conflict — allow updating ONLY your own row
-- (edited flag settles after first sync).
create policy parse_metrics_update_own on public.parse_metrics
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.capture_feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  raw text not null,
  parsed jsonb,
  route text,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.capture_feedback enable row level security;

create policy capture_feedback_insert_testers on public.capture_feedback
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.is_tester = true
    )
  );
