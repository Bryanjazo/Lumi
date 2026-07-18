-- RLS hardening (security audit, Jul 17 2026)
--
-- 1. owned_items had no UPDATE policy, so pushOwned's upsert was
--    RLS-denied on the ON CONFLICT DO UPDATE path (functional
--    durability bug — re-owned items never updated).
-- 2. UPDATE policies on users/pet_state/equipped_items had a USING
--    clause but no WITH CHECK — not exploitable (USING already scopes
--    the row), but WITH CHECK is the defense-in-depth guarantee that
--    an update can't REWRITE the row to another user's id.

create policy "owned own update"
  on public.owned_items for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter policy "users self update"
  on public.users
  with check (auth.uid() = id);

alter policy "pet own update"
  on public.pet_state
  with check (auth.uid() = user_id);

alter policy "items own update"
  on public.equipped_items
  with check (auth.uid() = user_id);
