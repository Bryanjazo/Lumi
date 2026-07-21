-- SECURITY hardening, round 2 (from the live-DB penetration audit).
--
-- (1) Close the INSERT sibling of the users self-escalation hole. The
--     BEFORE UPDATE guard (20260723000000) pins the privileged columns
--     on UPDATE, but the "users self upsert" INSERT policy still checks
--     only id = auth.uid() with no column restriction, and authenticated
--     /anon hold column-level INSERT grants. Today a direct INSERT is
--     blocked only incidentally — handle_new_user already created the
--     row in the signup transaction, so an INSERT hits a PK conflict and
--     a PostgREST upsert degrades to the guarded ON CONFLICT DO UPDATE.
--     That barrier is "a row exists," not enforcement: any future path
--     that leaves a user rowless (a handle_new_user change, a service
--     re-seed, a manual cleanup) would reopen free permanent Pro +
--     self-set is_tester. Extend the guard to fire on INSERT too, forcing
--     the privileged columns to safe baselines for end-user inserts.
--     handle_new_user (SECURITY DEFINER, current_user = owner) and the
--     service role are unaffected, so the real row-creation path keeps
--     its values.
--
-- (2) Stop client_errors spoofing. The insert policy's WITH CHECK (true)
--     let any caller attribute a forged crash row to ANOTHER user's uuid
--     (or null) with an attacker-controlled message that then surfaces in
--     the tester crash dashboard. Constrain the row to the caller.

create or replace function public.guard_user_privileged_cols()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only direct end-user requests are constrained. Service role (the
  -- webhook) and SECURITY DEFINER RPCs (start_trial, handle_new_user)
  -- run as a different current_user and pass through untouched.
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      -- No OLD on an insert — pin to safe baselines. has_access() only
      -- grants Pro on status='active' or a live trial_started_at, so
      -- 'trial'-without-timestamp + is_tester=false grants nothing.
      new.subscription_status             := 'trial';
      new.subscription_tier               := null;
      new.subscription_current_period_end := null;
      new.trial_started_at                := null;
      new.is_tester                       := false;
    else
      new.subscription_status             := old.subscription_status;
      new.subscription_tier               := old.subscription_tier;
      new.subscription_current_period_end := old.subscription_current_period_end;
      new.trial_started_at                := old.trial_started_at;
      new.is_tester                       := old.is_tester;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_user_privileged_cols on public.users;
create trigger guard_user_privileged_cols
  before insert or update on public.users
  for each row
  execute function public.guard_user_privileged_cols();

-- (2) client_errors: a caller may only file errors as themselves (or
-- anonymously pre-login, user_id null) — never spoofed onto another uid.
alter policy client_errors_insert_any on public.client_errors
  with check (user_id = auth.uid() or user_id is null);
