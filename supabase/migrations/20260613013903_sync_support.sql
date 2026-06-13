-- Lumi · sync_support
-- Adds tables + columns needed for full cloud sync of local Zustand state.

-- ── extend users with sync-relevant profile fields ──────────────────────
alter table public.users
  add column if not exists adhd_type text
    check (adhd_type in ('inattentive','hyperactive','combined')),
  add column if not exists last_active_date date,
  add column if not exists shield_used_this_week boolean not null default false,
  add column if not exists offline_mode boolean not null default false,
  add column if not exists onboarded boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- ── quests: timestamps + scheduling fields ──────────────────────────────
alter table public.quests
  add column if not exists completed_at timestamptz,
  add column if not exists scheduled_hour int,
  add column if not exists scheduled_minute int,
  add column if not exists duration_minutes int,
  add column if not exists accent text,
  add column if not exists updated_at timestamptz not null default now();

-- ── owned_items (skins + room items the user has unlocked) ──────────────
create table if not exists public.owned_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('item','skin')),
  ref_id text not null,
  unlocked_at timestamptz not null default now(),
  unique (user_id, kind, ref_id)
);
alter table public.owned_items enable row level security;
create policy "owned own read"   on public.owned_items for select using (auth.uid() = user_id);
create policy "owned own write"  on public.owned_items for insert with check (auth.uid() = user_id);
create policy "owned own delete" on public.owned_items for delete using (auth.uid() = user_id);

-- ── pet_state: traits + skin + adventure ────────────────────────────────
create table if not exists public.pet_state (
  user_id uuid primary key references public.users(id) on delete cascade,
  skin_id text not null default 'cream',
  trait_presence int not null default 40,
  trait_groundedness int not null default 40,
  trait_momentum int not null default 35,
  trait_curiosity int not null default 50,
  adventure jsonb,
  last_care jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.pet_state enable row level security;
create policy "pet own read"   on public.pet_state for select using (auth.uid() = user_id);
create policy "pet own write"  on public.pet_state for insert with check (auth.uid() = user_id);
create policy "pet own update" on public.pet_state for update using (auth.uid() = user_id);

-- ── updated_at auto-bump trigger (shared) ───────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'users_touch_updated_at') then
    create trigger users_touch_updated_at before update on public.users
      for each row execute function public.touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'quests_touch_updated_at') then
    create trigger quests_touch_updated_at before update on public.quests
      for each row execute function public.touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'pet_touch_updated_at') then
    create trigger pet_touch_updated_at before update on public.pet_state
      for each row execute function public.touch_updated_at();
  end if;
end $$;
