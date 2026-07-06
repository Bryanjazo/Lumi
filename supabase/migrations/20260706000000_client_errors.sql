-- Client crash/error telemetry — the ErrorBoundary and global JS
-- handler previously logged to console only, so production crashes
-- were invisible. Write-only for clients (no select policy); user_id
-- nullable because auth-screen crashes happen signed-out (anon may
-- insert). Message/stack are truncated client-side; no user content
-- beyond what an Error message carries. Diagnostics under the
-- published Usage Data label.

create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  message text not null,
  stack text,
  source text not null default 'boundary', -- boundary | global | promise
  fatal boolean not null default false,
  app_version text,
  platform text,
  created_at timestamptz not null default now()
);

alter table public.client_errors enable row level security;

create policy client_errors_insert_any on public.client_errors
  for insert to anon, authenticated
  with check (true);
