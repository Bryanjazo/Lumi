# Lumi — Data Architecture

How the app turns user behavior into a Time tab that knows their day. This is
the spec Claude Code builds against. Stack: **Supabase (Postgres + Realtime + Auth)**,
**Expo / React Native**, **Zustand** for client state.

---

## 1. The core idea

The Time tab is a **read-only view** over data that other parts of the app write.
It never owns tasks. It reads three streams and computes a *mode* every minute:

```
  TASKS  ───┐
  ENERGY ───┼──▶  derive(now)  ──▶  mode + radar state  ──▶  Time tab renders
  SLEEP  ───┘
```

Nothing on the Time tab is authored there. Add a task on Home → it shows on the
radar. Log a mood on Check-in → the energy curve sharpens. Sync Health → sleep
numbers go real. The Time tab is the *consequence* of everything else.

---

## 2. Database schema

Seven tables. All have `user_id uuid references auth.users`, `created_at`,
`updated_at`. Row-Level Security on every table: a user reads/writes only rows
where `user_id = auth.uid()`.

### 2.1 `profiles`
One row per user. Settings + onboarding answers.

| column | type | notes |
|---|---|---|
| id | uuid PK | = auth.users.id |
| display_name | text | from onboarding |
| pet_name | text | Luna, or whatever they named her |
| wake_time | time | default 07:00, used as day-start |
| sleep_target | time | default 22:00 |
| chronotype | text | 'early' \| 'neutral' \| 'night' — seeds energy baseline |
| adhd_subtype | text | 'inattentive' \| 'hyperactive' \| 'combined' \| 'unsure' |
| onboarding_quiz | jsonb | raw answers for later tuning |
| health_sync | bool | did they grant HealthKit/Fit |
| timezone | text | IANA tz, critical for all time math |

### 2.2 `tasks`
The heart. Written by Home tab (manual add, AI brain-dump). Read by Home AND Time.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| title | text | "Reply to 2 emails" |
| note | text | optional sub-line |
| importance | text | 'high' \| 'medium' \| 'low' (Must / Steady / Gentle) |
| xp | int | 20–100 |
| scheduled_at | timestamptz | nullable — null = unscheduled / someday |
| duration_min | int | nullable — needed for IN-IT mode + progress ring |
| status | text | 'open' \| 'done' \| 'skipped' |
| completed_at | timestamptz | **set on completion — this is learning gold** |
| source | text | 'manual' \| 'ai_dump' \| 'calendar' \| 'routine' |
| external_id | text | calendar event id, if source=calendar |
| recurrence | text | nullable RRULE for routines |

Indexes: `(user_id, scheduled_at)`, `(user_id, status)`, `(user_id, completed_at)`.

The Time tab query is just:
```sql
select * from tasks
where user_id = auth.uid()
  and scheduled_at::date = current_date
  and status != 'skipped'
order by scheduled_at;
```
That array *is* the `SCHEDULE` constant from the prototype — now live.

### 2.3 `checkins`
Written by Check-in tab. The raw material for the energy curve.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| mood | text | foggy \| stuck \| low \| wired \| anxious \| focused \| drained \| good |
| energy | int | derived 0–100 from mood (focused=88, drained=25, etc.) |
| logged_at | timestamptz | **timestamp is the whole point** |
| note | text | optional free text |
| ai_state | text | what the AI named it ("Task paralysis") |

Index: `(user_id, logged_at)`.

Mood→energy map (store in app constants, not DB):
```
good 78 · focused 88 · wired 70 · foggy 45
stuck 42 · anxious 50 · low 35 · drained 25
```

### 2.4 `sleep_logs`
From HealthKit / Google Fit, or manual. Feeds the energy model AND the Tonight card.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| date | date | the night (the morning it ended) |
| duration_min | int | total sleep |
| bedtime | timestamptz | nullable |
| wake_time | timestamptz | nullable |
| source | text | 'healthkit' \| 'google_fit' \| 'manual' |
| quality | int | nullable 0–100 if provider gives it |

Index: `(user_id, date)`. Unique on `(user_id, date, source)` to avoid dupes on re-sync.

### 2.5 `energy_curve`
The **learned** per-user curve. Recomputed nightly by a job (§4). 48 rows per user
(one per 30-min slot, 0:00–23:30) OR a single jsonb blob — blob is simpler:

| column | type | notes |
|---|---|---|
| user_id | uuid PK | one row per user |
| slots | jsonb | array[48] of {slot, energy 0–100, confidence 0–1} |
| peak_start | int | minutes since midnight, derived |
| peak_end | int | |
| slump_start | int | |
| slump_end | int | |
| sample_days | int | how many days of data fed this — drives confidence |
| updated_at | timestamptz | |

This replaces the hardcoded `PEAK = [11, 14]`. Until `sample_days >= 14`, the app
uses the chronotype baseline instead and shows "learning your rhythm" UI.

### 2.6 `routines`
Recurring blocks the user sets once (meds, bedtime). Materialized into `tasks`
daily by a job, OR expanded client-side. Keeping them separate keeps `tasks` clean.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| title | text | "Take medication" |
| time_of_day | time | 08:00 |
| rrule | text | "FREQ=DAILY" etc. |
| importance | text | |
| active | bool | |

### 2.7 `events` (telemetry, optional but recommended)
Append-only log of what happened. Powers future insights + debugging the model.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| kind | text | 'task_done' \| 'task_skip' \| 'checkin' \| 'mode_view' \| 'transition_seen' |
| payload | jsonb | { task_id, mode, mins_to_next, ... } |
| at | timestamptz | |

---

## 3. The derive() engine — turning data into a mode

Runs **client-side**, every 60s (and on app foreground, and on any task write).
Pure function: given the current data, return what the Time tab should show. This
is the real version of the mode-switcher buttons.

```ts
type Mode = 'approach' | 'imminent' | 'init' | 'open' | 'night';
type Overlay = 'peak' | 'slump' | null;

interface TimeState {
  mode: Mode;
  overlay: Overlay;
  current?: Task;       // the block you're inside (IN-IT)
  next?: Task;          // the looming next
  minsToNext: number;
  proximity: number;    // 0–1, drives ping intensity
  progress?: number;    // 0–1 for IN-IT ring
  accent: string;       // color, derived from overlay/night
}

function derive(now: Date, ctx: {
  tasks: Task[];            // today's, sorted by scheduled_at
  curve: EnergyCurve;       // learned or baseline
  profile: Profile;
}): TimeState {
  const mins = now.getHours()*60 + now.getMinutes();

  // 1. find current + next from real tasks
  const current = ctx.tasks.find(t =>
    t.scheduled_at && t.duration_min &&
    mins >= toMins(t.scheduled_at) &&
    mins <  toMins(t.scheduled_at) + t.duration_min
  );
  const next = ctx.tasks.find(t =>
    t.scheduled_at && toMins(t.scheduled_at) > mins
  );
  const minsToNext = next ? toMins(next.scheduled_at) - mins : Infinity;

  // 2. base mode
  let mode: Mode;
  if (mins >= toMins(ctx.profile.sleep_target) - 30) mode = 'night';
  else if (current)             mode = 'init';
  else if (minsToNext < 10)     mode = 'imminent';
  else if (minsToNext > 180)    mode = 'open';
  else                          mode = 'approach';

  // 3. energy overlay from LEARNED curve (not hardcoded)
  const slot = Math.floor(mins / 30);
  const e = ctx.curve.slots[slot];
  let overlay: Overlay = null;
  if (mins >= ctx.curve.peak_start && mins < ctx.curve.peak_end)  overlay = 'peak';
  if (mins >= ctx.curve.slump_start && mins < ctx.curve.slump_end) overlay = 'slump';

  // 4. proximity for the ping
  const proximity = next ? clamp(1 - minsToNext/180, 0, 1) : 0;

  // 5. progress for IN-IT ring
  const progress = current
    ? (mins - toMins(current.scheduled_at)) / current.duration_min
    : undefined;

  return { mode, overlay, current, next, minsToNext, proximity, progress,
           accent: pickAccent(mode, overlay) };
}
```

The prototype's six buttons map exactly to `mode × overlay`. Now it's automatic.

---

## 4. The learning logic — how the curve gets personal

This is the "functional to their habits" part. A **nightly Supabase Edge Function**
(pg_cron at ~3am local) rebuilds `energy_curve` per user.

### Inputs per 30-min slot, last 28 days:
1. **Check-in energy** — avg of `checkins.energy` logged in that slot. Direct signal.
2. **Completion density** — count of `tasks.completed_at` in that slot, normalized.
   Doing things = capacity was there. Strong implicit signal.
3. **Skip density** — `status='skipped'` in that slot pulls energy *down*.
4. **Sleep modifier** — slots after a <6h night get dampened; after 7h+ boosted.

### Algorithm
```
for each 30-min slot (48 total):
  checkinScore   = avg(checkin.energy in slot)           // may be null
  completionScore = normalize(count(completed in slot))   // 0–100
  skipPenalty    = normalize(count(skipped in slot)) * 0.5

  if checkinScore exists:
     raw = 0.5*checkinScore + 0.4*completionScore - skipPenalty
  else:
     raw = 0.7*completionScore - skipPenalty
            blended with chronotype baseline for that slot

  confidence = min(1, sampleDaysWithData / 14)
  // blend learned with baseline by confidence:
  final = confidence*raw + (1-confidence)*baseline[slot]

  slots[slot] = { energy: clamp(final,0,100), confidence }

// derive windows
peak  = longest contiguous run where energy >= 70
slump = longest contiguous run, after noon, where energy <= 45
sampleDays = distinct days with any checkin OR completion in 28d window
```

### The confidence ramp (what the user sees)
- `sampleDays < 7`  → curve hidden, UI says *"still learning — check in daily"*, app uses pure baseline silently for mode overlays.
- `7 ≤ days < 14` → curve shown faint, labeled *"early read"*.
- `days ≥ 14` → full curve, peak/slump trusted, transitions fire off it.

Chronotype baselines (seed curves, in app constants):
```
early:   peak 9–12,  slump 14–16
neutral: peak 11–14, slump 15–17   ← the prototype's guess
night:   peak 16–20, slump 10–12
```

---

## 5. Data flow — who writes, who reads

```
┌─────────────┐   write task        ┌──────────┐
│  HOME tab   │────────────────────▶│  tasks   │
│ add / dump  │                     └────┬─────┘
└─────────────┘                          │ read today's
                                         ▼
┌─────────────┐   write checkin    ┌──────────┐   nightly    ┌──────────────┐
│ CHECK-IN tab│───────────────────▶│ checkins │─────job─────▶│ energy_curve │
└─────────────┘                    └──────────┘              └──────┬───────┘
                                         ▲                          │ read
┌─────────────┐   sync             ┌──────────┐                    ▼
│  HealthKit  │───────────────────▶│sleep_logs│             ┌─────────────┐
│ Google Fit  │                    └────┬─────┘             │  derive()   │
└─────────────┘                         │ read              │  every 60s  │
                                        └──────────────────▶│             │
┌─────────────┐   set once        ┌──────────┐              └──────┬──────┘
│ Routines UI │──────────────────▶│ routines │─materialize─▶ tasks │
└─────────────┘                   └──────────┘                     ▼
                                                            ┌─────────────┐
                                                            │  TIME tab   │
                                                            │  renders    │
                                                            └─────────────┘
```

**Realtime:** subscribe the Time tab to `tasks` changes via Supabase Realtime.
Complete a task on Home → Time radar updates within a second, no refetch.

---

## 6. Client state (Zustand)

```ts
interface LumiStore {
  // raw data, hydrated from Supabase + kept live by Realtime
  profile: Profile | null;
  tasksToday: Task[];
  curve: EnergyCurve | null;
  sleepRecent: SleepLog[];

  // derived, recomputed by a 60s ticker
  timeState: TimeState | null;

  // actions
  addTask: (t: NewTask) => Promise<void>;     // writes tasks, optimistic
  completeTask: (id: string) => Promise<void>; // sets completed_at → feeds learning
  logCheckin: (mood: Mood) => Promise<void>;
  recompute: () => void;                       // runs derive(), sets timeState
}
```

A single `setInterval(recompute, 60_000)` in a top-level provider keeps the mode
honest. Also call `recompute()` on app foreground and after every write.

---

## 7. Build order for Claude Code

1. **Schema + RLS** — all 7 tables, policies, indexes. Migration file.
2. **Tasks end-to-end** — Home writes, Time reads the live array. Kills the
   hardcoded `SCHEDULE`. This alone makes the radar real.
3. **derive() + ticker** — replace the 6 mode buttons with auto-detection.
   Kills the hardcoded `MODES`.
4. **Check-in writes** — start collecting timestamped energy.
5. **Baseline curve** — chronotype seed so peak/slump work day one.
6. **Nightly learning job** — the Edge Function that personalizes the curve.
7. **Health sync** — HealthKit / Google Fit → sleep_logs → real Tonight card.
8. **Realtime** — subscribe Time to tasks for instant updates.
9. **Routines** — recurring blocks materialized daily.
10. **Telemetry** — events table, for tuning the model later.

Ship after step 5 and the Time tab is genuinely functional on real data; the
curve is just generic until enough days accrue. Steps 6–10 make it *personal*.

---

## 8. Honest answer to "is this plug-and-play?"

No — the prototype is the view. This doc is the engine. But the gap is **well-defined
plumbing**, not unknowns:

- Hardcoded `SCHEDULE` → query on `tasks` (steps 1–2)
- Hardcoded `MODES` buttons → `derive()` ticker (step 3)
- Hardcoded `PEAK = [11,14]` → `energy_curve`, baseline then learned (steps 5–6)
- Hardcoded "7h 12m" → `sleep_logs` from Health (step 7)

Every fake value has a named real source. That's the whole job.
