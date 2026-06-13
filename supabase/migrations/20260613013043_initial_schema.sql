-- Lumi · Supabase schema
-- Paste this into the Supabase SQL editor.
-- Requires: pgcrypto for gen_random_uuid().

create extension if not exists "pgcrypto";

-- ── users ───────────────────────────────────────────────────────────────
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  level int not null default 1,
  xp int not null default 0,
  streak int not null default 0,
  shield_available boolean not null default true,
  pet_name text not null default 'Luna',
  created_at timestamptz not null default now()
);

-- ── quests ──────────────────────────────────────────────────────────────
create table if not exists public.quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  difficulty text not null check (difficulty in ('easy','medium','hard')),
  xp_reward int not null,
  completed boolean not null default false,
  date date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists quests_user_date_idx on public.quests(user_id, date);

-- ── checkins ────────────────────────────────────────────────────────────
create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  mood text not null,
  text_input text,
  ai_response text,
  emotional_state text,
  created_at timestamptz not null default now()
);
create index if not exists checkins_user_created_idx on public.checkins(user_id, created_at desc);

-- ── sos_events ──────────────────────────────────────────────────────────
create table if not exists public.sos_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('rsd','depersonalization')),
  duration_seconds int not null,
  created_at timestamptz not null default now()
);

-- ── achievements ────────────────────────────────────────────────────────
create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  milestone_id text not null,
  unlocked_at timestamptz not null default now(),
  unique (user_id, milestone_id)
);

-- ── equipped_items ──────────────────────────────────────────────────────
create table if not exists public.equipped_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  category text not null check (category in ('rug','sofa','plant','lamp','toy','decor')),
  item_id text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, category)
);

-- ── brain_dumps ─────────────────────────────────────────────────────────
create table if not exists public.brain_dumps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  raw_text text not null,
  parsed_tasks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.users enable row level security;
alter table public.quests enable row level security;
alter table public.checkins enable row level security;
alter table public.sos_events enable row level security;
alter table public.achievements enable row level security;
alter table public.equipped_items enable row level security;
alter table public.brain_dumps enable row level security;

create policy "users self read"   on public.users for select using (auth.uid() = id);
create policy "users self upsert" on public.users for insert with check (auth.uid() = id);
create policy "users self update" on public.users for update using (auth.uid() = id);

create policy "quests own read"   on public.quests for select using (auth.uid() = user_id);
create policy "quests own write"  on public.quests for insert with check (auth.uid() = user_id);
create policy "quests own update" on public.quests for update using (auth.uid() = user_id);
create policy "quests own delete" on public.quests for delete using (auth.uid() = user_id);

create policy "checkins own read"  on public.checkins for select using (auth.uid() = user_id);
create policy "checkins own write" on public.checkins for insert with check (auth.uid() = user_id);

create policy "sos own read"  on public.sos_events for select using (auth.uid() = user_id);
create policy "sos own write" on public.sos_events for insert with check (auth.uid() = user_id);

create policy "ach own read"  on public.achievements for select using (auth.uid() = user_id);
create policy "ach own write" on public.achievements for insert with check (auth.uid() = user_id);

create policy "items own read"   on public.equipped_items for select using (auth.uid() = user_id);
create policy "items own write"  on public.equipped_items for insert with check (auth.uid() = user_id);
create policy "items own update" on public.equipped_items for update using (auth.uid() = user_id);

create policy "dumps own read"  on public.brain_dumps for select using (auth.uid() = user_id);
create policy "dumps own write" on public.brain_dumps for insert with check (auth.uid() = user_id);

-- ── auto-create users row on signup ─────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, name, pet_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), 'Luna');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
