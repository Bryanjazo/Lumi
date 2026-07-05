# Lumi · App Privacy questionnaire answers (ASC → Trust & Safety → App Privacy)

Grounded in the actual stack: Supabase (auth + DB, RLS), Anthropic via our
proxy, RevenueCat (subscription status only), on-device speech, no ad SDKs,
no analytics SDK, no crash-reporting SDK (verified — nothing to declare
under Diagnostics).

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
- Collect? **Yes** (server-side AI usage rows per account for quota
  enforcement — tokens per feature)
- Purposes: **App Functionality**
- Linked to identity: **Yes**

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
  **Sensitive Info**, **Diagnostics** (no crash SDK in the app today —
  if you add Sentry later, come back and add Crash Data + Performance Data,
  not linked, App Functionality)

## Sanity checks reviewers do
- Privacy Policy URL content must AGREE with these labels (the drafted
  policy in docs/site/privacy.md matches exactly).
- The policy must mention third-party processors by category — it names
  Supabase, Anthropic, RevenueCat, Apple. ✓
- Account deletion must be reachable in-app. ✓ (Profile → Delete account)
