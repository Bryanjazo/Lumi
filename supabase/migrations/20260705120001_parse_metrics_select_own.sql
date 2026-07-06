-- Upsert (INSERT … ON CONFLICT DO UPDATE) needs to read the
-- conflicting row, which requires a SELECT policy — without it the
-- edited-flag re-sync 403s. Scope: your own rows only; nobody reads
-- anyone else's telemetry.
create policy parse_metrics_select_own on public.parse_metrics
  for select to authenticated
  using (user_id = auth.uid());
