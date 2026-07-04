-- Waitlist for the lumitasks.app landing page (pre-launch signups).
--
-- Security model: the static site inserts with the PUBLIC anon key,
-- so the table is write-only from the outside — anon can INSERT and
-- nothing else. No select/update/delete policies exist, so the anon
-- key can never read the email list back out. Reading is dashboard /
-- service-role only.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null
    check (char_length(email) <= 320 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  source text not null default 'landing'
    check (char_length(source) <= 40),
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness — the page treats a duplicate as
-- "you're already in" (23505), not an error.
create unique index if not exists waitlist_email_key
  on public.waitlist (lower(email));

alter table public.waitlist enable row level security;

drop policy if exists "anon can join waitlist" on public.waitlist;
create policy "anon can join waitlist"
  on public.waitlist for insert
  to anon
  with check (true);
