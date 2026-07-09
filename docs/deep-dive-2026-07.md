# Lumi · Four-Agent Deep Dive — Synthesis (Jul 9, 2026)

Panel: Product/UX strategist · Growth & monetization · Staff engineer ·
Feature archaeologist. Each read the codebase independently. This doc
is the merged, de-duplicated, orchestrator-verified result.

## 0 · Bugs found by the panel — ALREADY FIXED (commit c5cba46)

1. **Trial-start RPC missing** — the cap-hit sheet's "Try 7 days free"
   armed the trial locally only; the server kept 429ing. The app's
   highest-intent conversion moment silently failed.
2. **Deleted tasks resurrected** — deletes never synced; reinstall or
   second device brought them back. Tombstones now flush on push and
   filter on pull.
3. **Streak shield never recharged** — `rechargeShield()` had zero
   callers; one bad week burned the shield forever. Weekly recharge
   wired.
4. **addMany id booby trap** — batch-minted ids failed the UUID sync
   filter (silent cloud exclusion). Fixed.
   Plus: upgrade-sheet cap copy now shows the real per-kind number.

## 1 · Ship-this-week candidates (S effort, HIGH impact)

| # | Idea | From | Why |
|---|------|------|-----|
| 1 | **Open the Insights door** — `app/insights.tsx` is 100 % built (strong window, rhythm, "Lumi noticed", avoidance, win-of-week) and NOTHING navigates to it. One Me-tab row ships a retention surface. | Archaeologist | Highest impact-per-line in the repo |
| 2 | **Vent acknowledgment beat** — a vent-only capture currently does NOTHING (0 tasks, silent). Luna should say "That sounds heavy — want to untangle it?" + one-tap Untangle hand-off. All pieces exist. | Product | The most emotional input gets the most silent output today |
| 3 | **Untangle `complete` action** — user says "I already did X", Lumi can't check it off (prompt returns empty proposal). ~20 lines: prompt block + apply branch → completeQuest. | Archaeologist | Turns "Lumi listens" into "Lumi does" |
| 4 | **Streak reset reframe** — on break show "back again · 14 days total this month", not a shaming "1". | Product | "Coming back is the whole win" — make the mechanic say it |
| 5 | **Free-tier share card** — the Lumi Story share (with watermark) renders ONLY for Pro. Free users = 95 % of launch = zero share cards. Ship a lighter free card; keep narrative/energy Pro. | Growth | The only organic-growth surface, currently shown to almost nobody |
| 6 | **First-completion ritual** — first quest ever completed → one bespoke Luna beat. Milestone exists, pays silent XP today. | Product | Day-1 emotional peak predicts day-2 return |
| 7 | **client_errors TTL cron** — telemetry tables have no purge; add pg_cron 90-day cleanup (client throttle already exists). | Engineer | 30 min of insurance |

## 2 · First month after launch (M effort)

- **Trial-end arc** (Growth): day-5/6 notification, lapse-day sheet
  showing the user's own trial stats, lapsed-429 prompt leading with
  annual. Trial revenue concentrates at the deadline; today it
  evaporates silently.
- **"Does today fit?" day meter** (Product): sum task durations vs
  wake→sleep; one honest sentence ("~3h planned · fits before
  dinner"). The time-blindness aid in Lumi's voice. Never
  auto-reschedules — asks.
- **Hyperfocus protection** (Product): timer expiry offers "+10 more
  — you're in it"; early-end banks the minutes ("12 minutes is 12
  minutes"). Focus is currently the app's most perfectionist surface.
- **Waitlist activation** (Growth): launch email in Luna's voice +
  deep link that restores held thoughts into first capture + founding
  offer code. The table already stores their thoughts.
- **Sync merge test suite** (Engineer): extract mergeQuests /
  resolveSubscription as pure functions, test under the existing
  esbuild harness. The ONE suite that prevents the unrecoverable
  launch incident.
- **"Lumi noticed" Home cards** (Archaeologist): the learning layer
  computes peak windows/avoidance/wins that Home never shows. "It's
  9:40 — your sharp window; want the hard one now?"
- **Recap teaser: show don't tell** (Growth): blur the user's REAL
  energy curve behind the Pro teaser with one insight visible.
- **Pull-on-foreground + push retry on reconnect** (Engineer):
  closes most of the two-device divergence gap cheaply.
- **ASO pass** (Growth): keywords add `ai, voice, overwhelm,
  routine`; drop "to do list". Promoted in-app purchases + custom
  product page for "adhd" searches.

## 3 · Bigger bets (L effort — sequence deliberately)

- **Shards → room economy** (Archaeologist): UnlocksShop UI is built
  (hidden), petStore has a complete dormant layer — 2-h Adventures
  where Luna finds room items, an 18-item catalog, care traits — all
  synced to Supabase, none rendered. Recommended economy split: XP
  gates worlds/features (permanent), shards buy room decor
  (spendable). "Luna found something with the shards you've been
  saving" is the perfect day-30 beat.
- **Milestones system** (Archaeologist): milestones.ts + loot.ts are
  complete and dead. Earned skins (midnight cat at 30-day streak)
  beat paywall-only skins; milestone cards reuse the share engine.
- **SOS mode** (Archaeologist): `SosEvent` types for RSD /
  depersonalization, XP, milestone — all plumbed, zero UI. A
  grounding screen would be genuinely differentiating. Decide
  intent (App-Review sensitivity?) before building.
- **Referral "gift 7 days of Pro"** (Growth): gift-frame fits the
  soul; needs link infra + abuse guards.
- **Adventure Live Activity** (Archaeologist): "Luna's exploring,
  back at 3:12" on the Dynamic Island — the bridge already carries
  everything; Swift needs a variant view.
- **Home leaf-component extraction** (Engineer): ~900 lines of pure
  moves + the stylesheet. Post-launch, hooks one at a time. Never
  touch Home's effect ordering pre-launch.

## 4 · The DO-NOT line (all four agents, unanimous)

- Never quota/lock the deterministic parser, capture, focus, or task
  counts. Promised in code comments AND to Apple.
- No streak-repair paywall, no fake urgency timers, no "Luna misses
  Pro" — Luna's affection is unconditional; monetizing streak anxiety
  is guilt monetization.
- Don't copy Motion's silent auto-rescheduling (Lumi asks) or
  human body-doubling services (scheduling + social anxiety).
- No parser rewrite: regex + 157-case corpus + telemetry IS the right
  architecture (engineer's explicit verdict). Split files, grow corpus.

## 5 · Open questions for Bryan (agents asked; owner decides)

1. Waitlist size? (Ranks waitlist activation vs share card.)
2. Founding-member pricing: is a $49.99 offer code acceptable?
3. Shards vs XP economy: adopt the split above?
4. SOS mode: shelved deliberately or unfinished? Ship post-launch?
5. Multi-device: officially out of scope for v1 marketing? (Decides
   sync-retry urgency.)
6. Milestone-earned skins vs Pro gate: does earning override?
7. The six "Threshold" rank titles — placeholders needing copy?
