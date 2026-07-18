-- Per-device ledger slices (Jul 18 2026)
--
-- Two devices completing DIFFERENT tasks the same day used to
-- max-merge their aggregate done_log counts — max(3,2)=3 when the
-- truth was 5. Each device now writes its OWN delta slice under
-- ledgers[deviceId]; totals are legacy columns + sum of slices, which
-- is exact because each device is the only writer of its key.
--
-- The legacy columns (done_log / tasks_ever_completed /
-- focus_minutes_lifetime) freeze as the pre-cutover base for updated
-- clients; older builds keep max-merging into them, which stays
-- correct (their new work lands in the base, not in any slice).

alter table public.users
  add column if not exists ledgers jsonb not null default '{}'::jsonb;

-- Atomic own-key merge: jsonb || replaces only the caller's device
-- key, so concurrent devices can never clobber each other's slices.
create or replace function public.merge_device_ledger(
  p_device text,
  p_slice jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  update public.users
  set ledgers = coalesce(ledgers, '{}'::jsonb)
    || jsonb_build_object(p_device, p_slice)
  where id = auth.uid();
$$;

revoke all on function public.merge_device_ledger(text, jsonb) from anon;
grant execute on function public.merge_device_ledger(text, jsonb)
  to authenticated;
