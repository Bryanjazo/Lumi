# Patterns tab — redesign brief

## What this page IS
Patterns is Lumi's self-knowledge surface — "the shape of you." It
shows an ADHD user what their own behavior actually looks like:
when their energy peaks, when they follow through, what they keep
carrying, what quietly repeats. It is the retention moat: by week
three it should feel like a personal artifact the user wants to
show someone. It replaced both the old Focus tab (tab slot) and the
old /insights screen (content), and it's a first-class tab in the
floating nav (Home · Untangle · Time · Patterns · Me).

Everything is computed on-device from the learning layer — zero
network, zero AI tokens. The page is read-only today (one implicit
door: recurrence rows mention Home).

## Audience & soul constraints (non-negotiable)
- ADHD adults with productivity shame. NEVER guilt: no red, no
  "you failed Thursday", no empty-state scolding. Gaps are rest.
- Honest data over flattery — but named gently ("runs tender", not
  "your worst"). Avoidance is "just naming it, in case one is ready."
- Warm-hearth aesthetic: dark void background, ember/honey/dusk
  accents, Fraunces italic for feeling lines (needs paddingRight on
  ≥19px italics — glyph overhang clips), Inter for UI/data.
- Free tier sees ALL of it. Nothing on this page locks.
- Day-1 must read as warm promise, not empty dashboards (sparse
  guards exist — keep the concept).

## Current structure (top → bottom)
0. **Header** — "✦ PATTERNS / The shape of you." + one subtitle line
   that adapts: sparse ("a few days of showing up and this page
   starts drawing your picture — all of it lives on your phone"),
   learning ("still sketching…"), learned ("drawn from what you
   actually do — not what a planner thinks you should").
1. **YOUR DAY, AS ENERGY** (card) — the hero chart. Smoothed SVG
   area chart of 48 half-hour energy slots (0–100), honey gradient
   fill; ember band over the peak window, dusk band over the slump;
   dashed "now" line with a dot riding the curve; clock legend
   ("▮ peak 9a–11a · ▮ dip 2p–3:30p"); "still learning" tag until
   the curve is learned (≥14 sample days); whisper: "the hard thing
   belongs in the ember band."
2. **MOMENTUM** (3 stat cards) — done this week (with ▲/▽/— trend vs
   last week), finished-ever, hearth time (label becomes "focused
   time" in Focused companion mode).
3. **FOUR WEEKS OF SHOWING UP** (card) — GitHub-style 28-day heat
   matrix (4 rows × 7 cols), ember intensity by completions/day,
   corner tag "N done · best day X", whisper "warmth = things
   finished · gaps are rest, not failure."
4. **WHERE THINGS ACTUALLY HAPPEN** (card, only when data) — strong
   vs tender window bars: label ("Morning — your strong window"),
   done/set counts, % fill bar (ember vs dusk). Whisper: "Lumi
   already leans on this — big things get offered to your morning
   first."
5. **LUMI NOTICED** (card, only when data) — up to 4 notice rows:
   win of the week ("finished X after carrying it 12 days — counts
   double"), up to 2 recurrence whispers ("keeps coming back — want
   it to repeat on its own?"), one avoidance line ("a few errands
   have been waiting a while. Not a judgment.").
6. **Best-day chip** — "Tuesdays carry you · Thursdays run quieter"
   (guarded so it never names the same day twice).
7. **Footer line** — "every week, this page knows you a little
   better ✦".

## Data available (useLearningDigest + stores)
- EnergyCurve: 48 slots {energy 0–100, confidence 0–1}, peak/slump
  start+end minutes, sampleDays, confidence, source:
  'baseline' | 'learning' | 'learned'. (Baseline = chronotype curve
  seeded from wake/sleep; blends toward real check-ins per slot.)
- FollowThrough: thisWeek/lastWeek {done,set}, trend, doneByDay[7],
  strongWindow/weakWindow {window, done, set}.
- digest.win {quest, delayDays}, digest.recurrence[] {title},
  digest.avoidance {label}, peakDow/lowDow, energyTrend, avgEnergy7.
- 28-day completion counts (heat), tasksEverCompleted,
  focusMinutesLifetime, last7DaysEnergy.
- Companion mode (full/minimal/focused) — copy must adapt; Focused
  strips cozy language ("hearth" → "focused time").

## Known tensions a redesign should solve
- The page is five stacked cards — reads as a report, could feel
  more like one composed "portrait" of the user (the h1 promises
  "the shape of you"; the layout doesn't quite deliver a shape).
- The energy curve is the hero but sits in the same card chrome as
  everything else — no visual hierarchy between the signature chart
  and supporting stats.
- Sparse/day-1 state: guards swap copy but the page still shows
  near-empty structures; could be a designed "first sketch" moment
  instead.
- No interaction anywhere — consider tasteful touches (scrub the
  curve to see a time's energy, tap a heat cell for that day's
  count) without turning it into a dashboard.
- "LUMI NOTICED" mixes three different insight types in one flat
  list; could carry more voice/warmth (it's the most personal data).
- The recurrence rows point at Home ("it's waiting on Home") with no
  actual door — dead-end copy.

## Hard requirements
- All rendering stays on-device data; no new network calls.
- Keep the sparse-data guards (never show a confident claim without
  the samples to back it) and the "still learning" honesty tag.
- Keep every section optional — cards hide when their data is empty
  rather than showing zeros.
- react-native-svg is available (curve/paths); no new heavy chart
  deps. Page must stay cheap (it's a tab that stays mounted).
- Bottom padding must clear the floating nav (FLOATING_NAV_CLEARANCE).
- Fraunces italic overhang: paddingRight/paddingHorizontal on ≥19px
  italic text.
