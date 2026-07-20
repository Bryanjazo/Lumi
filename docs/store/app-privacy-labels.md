# Lumi · App Privacy questionnaire answers (ASC → Trust & Safety → App Privacy)

Grounded in the actual stack: Supabase (auth + DB, RLS), Anthropic via our
proxy, RevenueCat (subscription status only), on-device speech, no ad SDKs,
no analytics SDK, no third-party crash-reporting SDK (no Sentry) — BUT we
ship our own first-party crash/error logging (lib/errorReport.ts writes the
crash message + trimmed stack to the client_errors table), so Diagnostics →
Crash Data IS declared below (item 7). "No SDK" is not the same as "nothing
to declare": the code collects it, so we declare it.

## Q: "Do you or your third-party partners collect data from this app?"
**Yes.**

## Data types to declare — and every answer inside each

For each type ASC asks three things: purpose(s), "linked to the user's
identity?", and "used for tracking?". **"Used for tracking" is NO for
every single item below** (no ads, no data brokers, no cross-app tracking
— this is also why no App Tracking Transparency prompt is needed).

### 1. Contact Info → Email Address
- Collect? **Yes** (account sign-in, Supabase auth)
- Purposes: **App Functionality**
- Linked to identity: **Yes**

### 2. Contact Info → Name
- Collect? **Yes** (from Sign in with Apple/Google when shared; profile name)
- Purposes: **App Functionality**
- Linked to identity: **Yes**

### 3. User Content → Other User Content
- Collect? **Yes** (tasks, check-ins, conversation text — synced to Supabase;
  text sent to AI features is processed by Anthropic through our proxy)
- Purposes: **App Functionality**
- Linked to identity: **Yes**

### 4. Identifiers → User ID
- Collect? **Yes** (Supabase account id; RevenueCat app user id)
- Purposes: **App Functionality**
- Linked to identity: **Yes**

### 5. Purchases → Purchase History
- Collect? **Yes** (subscription status via RevenueCat/Apple)
- Purposes: **App Functionality**
- Linked to identity: **Yes**

### 6. Usage Data → Product Interaction
- Collect? **Yes** — two write-only server tables, no third-party analytics:
  - `ai_usage` — one row per AI call for quota enforcement (kind + token
    counts, no text) — anthropic-proxy Edge Function.
  - `parse_metrics` — per-capture parse quality (route / reason / latency /
    edited flag, ZERO text content) — lib/telemetry.ts `syncParseMetrics`.
- Purposes: **App Functionality**
- Linked to identity: **Yes**

### 7. Diagnostics → Crash Data
- Collect? **Yes** (lib/errorReport.ts uploads the crash message + a
  trimmed stack trace to the write-only `client_errors` table on an
  uncaught JS error, an unhandled promise rejection, or a render-boundary
  crash — first-party, no crash SDK)
- Purposes: **App Functionality** (diagnosing real-world breakage so we can
  ship fixes) — NOT used for tracking, NOT used for third-party analytics
- Linked to identity: **Yes** — each row carries `user_id` when the crash
  happens signed-in. Sign-in-screen crashes are logged with a null user_id,
  but because the crash data CAN be tied to an account we declare it linked
  (the safe, over-declaring answer). Message + stack only — no user content,
  no device IDs.
- ⚠️ This is the Crash Data category ONLY. We do NOT collect Apple's
  "Performance Data" or "Other Diagnostic Data" (no perf/energy/hang SDK).

## Explicitly NOT collected — answer No everywhere else
- **Audio Data** — voice is transcribed by iOS on the device; no audio leaves it
- **Health & Fitness** — tasks are not health data; do NOT declare this
  (declaring health data invites the medical scrutiny we correctly avoided)
- **Location**, **Contacts**, **Photos** (avatar picker uses the photo ON
  device only — if the avatar photo is never uploaded to Supabase, don't
  declare; if it IS synced, add "User Content → Photos or Videos", linked,
  App Functionality) ⚠️ CHECK: does the custom avatar photo sync to the
  server? If unsure, declare it — over-declaring is safe, under-declaring
  is a rejection.
- **Financial Info**, **Browsing History**, **Search History**,
  **Sensitive Info**
- **Diagnostics → Performance Data / Other Diagnostic Data** — NOT collected.
  (Crash Data IS collected and declared — see item 7 above. We only lack the
  *performance* metrics an SDK like Sentry would add; if you adopt one later,
  revisit whether Performance Data also needs declaring.)

## Sanity checks reviewers do
- Privacy Policy URL content must AGREE with these labels (the drafted
  policy in docs/site/privacy.md matches exactly). Cross-checked: the
  policy's "Diagnostics. Basic crash and error information to keep the app
  working." line is the plain-language pair for item 7 (Crash Data), and
  its "Learning signals" / content sections cover the Usage Data in item 6.
  All three surfaces — code (lib/errorReport.ts, lib/telemetry.ts), this
  label sheet, and privacy.md — now agree on Crash Data = collected, linked,
  App Functionality, no tracking.
- The policy must mention third-party processors by category — it names
  Supabase, Anthropic, RevenueCat, Apple. ✓
- Account deletion must be reachable in-app. ✓ (Profile → Delete account)
