-- Waitlist v2 (interactive landing page): the demo's dumped thoughts
-- save WITH the email — the joined-state copy promises "we saved your
-- spot — and your thoughts", so the app can greet founding users with
-- their pre-launch pile actually waiting, sorted.
--
-- Same write-only posture as before: anon can INSERT and never read.
-- The thoughts payload is size-capped in-database so a hostile client
-- can't stuff megabytes through the public key.

alter table public.waitlist
  add column if not exists thoughts jsonb;

alter table public.waitlist
  drop constraint if exists waitlist_thoughts_cap;
alter table public.waitlist
  add constraint waitlist_thoughts_cap check (
    thoughts is null
    or (
      jsonb_typeof(thoughts) = 'array'
      and jsonb_array_length(thoughts) <= 20
      and pg_column_size(thoughts) <= 8192
    )
  );

-- Public count for the "N minds already in line" teaser + the "#N in
-- line" joined headline. SECURITY DEFINER so anon can learn the COUNT
-- without any read access to the rows themselves.
create or replace function public.waitlist_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.waitlist;
$$;

revoke all on function public.waitlist_count() from public;
grant execute on function public.waitlist_count() to anon;
