# Lumi · Round-2 Agent Reports — Token Economics + Fresh Enhancements (Jul 9)

## A · Token economics (verified against code, prices current)

Baseline at 1,000 active users (400 Pro): **≈ $600/mo** — understand
$515, untangle $72, clarify $12. Caching already saves 90% on input;
no uncapped kind; free tier ≈ $0.11/wk worst case. Healthy overall.

### Waste — ~$100/mo (15%) identified, in order
1. Understand prompt says the comma-list rule 3×, at-event rule 2×,
   appositive rule 2× — dedup to ~3.8k tokens (~$60/mo, zero risk).
2. Untangle re-sends pile+context UNCACHED every turn (~40% of a
   conversation's cost) — add cache_control to messages[0] server-
   side for untangle (~$20/mo + latency).
3. Pile rows send full UUIDs (~20 tk each) — alias T1…T80, map back
   client-side (~$10/mo).
4. Correction lines carry useless date stamps; cap 160→100 chars
   (~$15/mo). Corrections are sent on EVERY call with no relevance
   filter and no measured lift — A/B before growing.
5. **UX-grade fix**: a garbled multi capture chains Haiku spell-pass
   → Sonnet understand SERIALLY (double latency, double capture-
   bucket burn; understand normalizes typos itself). Gate the spell
   pass to local-routed captures only.
Also: untangle output isn't minified (~$4/mo); the abandoned-timeout
call still bills and misses understandCache on resend; parse-retry
burns 2 quota units; `upgradeWithUnderstand` is dead code — delete.

### Margin exposure (the one real one)
Caps count CALLS not TOKENS: a whale at both daily caps with 12-task
dumps + 80-row piles ≈ $40–67/mo vs ~$51/yr net on intro annual.
Fix: server-side input clamp for untangle heads (~4k tokens) + pile
row aliasing + spell-chain fix. Watch ai_usage for trial-cohort
spikes (throwaway trials get 50+60/day for 7 days).

### Spend-to-improve (max value per added dollar)
1. Untangle thread memory 8→16 msgs (+$9/mo) — the prompt PROMISES
   "you mentioned the report earlier" and can't see that far.
2. Completion history → honest duration estimates (+$50/mo) — the
   highest-leverage ADHD feature the pipeline doesn't have.
3. Relevance-filtered corrections 6→12 (≈$0 — often cheaper).

## B · Fresh enhancement ideas (verified NOT in prior docs)

1. **"Let the day set" evening ritual (M/HIGH)** — unfinished tasks
   silently VANISH from Home at midnight (selectTodayQuests strict
   date filter); one slipped task gets zero acknowledgment ever. The
   wind-down notification already fires nightly — give it a screen:
   tonight's leftovers, carry / let go / actually-done, Luna curls
   up. The never-guilt soul, made mechanical. TOP PICK #1.
2. **Night-capture narration (S/MED-HIGH)** — 3am dumps already roll
   to tomorrow; nothing SAYS so. "Caught it — it's on tomorrow
   morning, nothing to do tonight" + a "while you slept" morning line.
3. **Widget grows up (M/HIGH)** — widget is systemSmall-only, shows
   mood+count, no hero task, no lock-screen family, no tap-to-capture
   deep link. The one-thing app never shows the one thing on the lock
   screen.
4. **"Add to Lumi" App Intent (M/HIGH)** — ZERO App Intents exist;
   capture requires opening the app. One AddTaskIntent + app-group
   inbox = Siri/Action-Button/Spotlight capture, free tier included.
   TOP PICK #2.
5. **Share extension → same inbox (L, do after #4).**
6. **Time-tab ghost-drag hint (S/MED)** — drag-rebalance is invisible
   (220ms hold, captions only at page bottom); hintsSeen infra ready.
7. **Quiet ledger (S/MED)** — lifetime focus minutes are NOT
   persisted anywhere (unrecoverable); add two counters NOW so the
   data exists, surface later ("4h 12m by the hearth together").
8. **Focus done-screen hand-back (S/MED)** — completing a session
   dumps you on the picker; offer "Next up: X — one more block?".
