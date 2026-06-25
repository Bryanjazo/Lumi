# anthropic-proxy · deploy

This function moves Anthropic calls server-side so the API key never
ships in the mobile bundle (per `lumi-BUILD-STATUS-and-GAPS.md` §1).

## One-time setup

```bash
# 1. Apply the ai_usage migration (creates the table + has_ai_quota fn).
supabase db push

# 2. Store the Anthropic key as a server secret. NEVER commit it.
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

# 3. Deploy the function.
supabase functions deploy anthropic-proxy
```

That's it. The function reads `ANTHROPIC_API_KEY`, `SUPABASE_URL`,
and `SUPABASE_SERVICE_ROLE_KEY` from the runtime env — the last two
are injected automatically by Supabase.

## What the client does

`lib/anthropic.ts` calls the function via `supabase.functions.invoke
('anthropic-proxy', { body: { kind, system, messages, max_tokens } })`.
The user's session JWT goes through automatically.

The client treats:

- HTTP **200** → returns `{ text }`, parsed for JSON downstream.
- HTTP **429** → quota exhausted; falls back to the deterministic
  offline copy so the user still gets a response. No error toast.
- HTTP **401/500/502** → silent fallback to offline too. The app
  never blocks the user on an AI failure.

## Free-tier quotas

Per-kind weekly caps (rolling 7-day window) for users without
`has_access()`:

| kind | cap | rationale |
|---|---|---|
| brain_dump   | 5  | spec example — keeps the "high-touch" feature gated |
| checkin      | 5  | one heavy AI moment per day |
| followup     | 8  | follow-ups happen inside a checkin session |
| title_clean  | 30 | fires per capture; needs more headroom |
| weekly_report| 2  | one recap per week + one regenerate |

Premium (status='active' OR within the 7-day trial via
`has_access(uid)`) is unlimited.

## Verifying

```bash
# Tail logs while you trigger a capture from the app.
supabase functions logs anthropic-proxy --tail

# Check usage rows after a few calls.
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" \
  -c "select kind, count(*) from ai_usage where called_at > now() - interval '7 days' group by kind;"
```
