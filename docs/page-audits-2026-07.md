# Lumi · Six-Page Audit — Results (Jul 9-10)

One agent per surface, every claim code-verified. 26 findings FIXED
same-day (commits between the Me batch and the Focus batch); the
rest triaged below.

## Fixed (shipped via OTA)
**Economy/critical:** undo→re-complete XP farming (xpPaid stamp, all
5 completion paths) · Me room 60fps loop running forever after one
visit · Untangle moves deleting calendar events + un-anchoring fixed
appointments · orphan Live Activities never swept + sign-out leaking
sessions/minutes across accounts.
**Money:** cancelled-but-paid shown "FREE PLAN" (now "PRO — WON'T
RENEW until {date}" on both screens + profile) · savings badge said
50% and 67% one screen apart · recap's fake "Scheduled" button.
**Home:** suggest-card stacking · dym re-hold loop · return key that
didn't send · overnight-narration burning its daily shot pre-
hydration · dump-modal destroying 200-word spills.
**Time:** month nav skipping months on the 31st · drops onto past
days (instant MISSED guilt) · recurring projections at wrong times ·
stale recurring templates un-completing via the radio.
**Untangle:** busy-guard eating echoed messages · invalid create
dates minting invisible tasks · Later pile starving recent parks.
**Focus:** start() double-tap orphaning activities · end-early
discarding every minute (banks on all teardowns now) · done screen
claiming the full block regardless of when Finish was tapped.
**Me:** vitality dimming the room at clean sweep · UTC/local check-in
credit · frozen mid-air walk sprite · 6 "Threshold" placeholder
ranks · sleeping-cat excited bounce · notifications at hour≥24 never
firing for night owls · deleted accounts still getting nudges.

## Triaged — next session (real, verified, not urgent)
- Home: unify 3 preview-commit paths (accept-card loses note/duration;
  "Accept all" bypasses recur confirmation; card edits don't record
  corrections — the learning signal is OFF on that path) · sorting-
  card cancel hatch · bulk backlog undo · welcome/rescue card
  stacking · toast manager.
- Untangle: runMove bundle (dead "matters" filter, view-state leak
  across day switches, "0 aside" copy, plan-overflow honesty) ·
  "put it back" undo chip · midnight selectedDate refresh.
- Time: recurMatches full unification with nextOccurrence (interval/
  month/2week divergences) · gap-drop overflow warning · week-view
  edge auto-scroll · non-drag move fallback (a11y) · remaining-load
  read for today.
- Focus: pause doesn't freeze the lock-screen countdown (needs a
  paused ContentState in the Swift widget — build 53 item) · session-
  end local notification · MIN_MIN=1 off-grid steps.
- Me/insights: sparse-data copy guards ("peak Tue dip Tue", "0/100",
  "after 0 days") · minimal-mode room contract · vitality afterglow +
  light-day bloom (design decisions) · window sky vs time of day.
- Profile: notification toggles vs revoked iOS permission drift ·
  export completeness · calendar picker Pro gating decision ·
  calendar backfill on connect · recurring quests never re-mirroring
  to calendar · profile ignoring Focused companion mode · "Your
  weeks" cards all opening the current week.
- Money: post-purchase alert assumes intro price · trial-aware CTAs
  (trialAlreadyUsed unused) · paywall restore busy-state.
