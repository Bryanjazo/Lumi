# Lumi · Engine Improvement Plan — July 2026

> STATUS (Jul 6): A1–A10 + B1–B7 + B9 (timeout) SHIPPED and verified —
> corpus 147/147, live benchmark 42/42 (incl. multilingual).
> Remaining: A11 time ranges (schema), A12 confidence follow-ups,
> A13 multilingual date vocab, B8 Haiku-for-simple (A/B-gated),
> B10 streaming responses. See git log for implementation details.

Findings from the pre-release deep audit (deterministic parser + LLM
pipeline). Each item: what a user says/sees today, what should happen,
size (S/M/L), impact. Nothing here is implemented yet — this is the
review list.

## A · Deterministic parser (free tier gets smarter, Pro gets faster)

### Quick wins — Small effort, High/Med impact
| # | Gap | User says | Today | Should |
|---|-----|-----------|-------|--------|
| A1 | Fuzzy times | "gym around 3", "3ish", "late afternoon" | time lost | at≈15:00 low-confidence / late-window hint |
| A2 | biweekly / twice a week | "water plants biweekly" | one-off task | recur every 2week / week ×2 |
| A3 | no-rush words | "fix the site — no rush", "whenever", "optional" | medium importance | low importance (better placement) |
| A4 | Bullet/numbered lists | "1) email sarah 2) laundry", "• gym" | "1) Email sarah" title noise | clean split + clean titles |
| A5 | couple/few/several | "call in a couple hours" | no time | now + ~2h |
| A6 | half past / quarter to | "at half past 2" | parses as 2:00 | 2:30 |

### Medium effort — High/Med impact
| # | Gap | User says | Today | Should |
|---|-----|-----------|-------|--------|
| A7 | Inline durations | "meeting for 1 hour", "quick 15-min sync" | duration debris stays in title, length unset | durationMinutes set, title clean — free-tier parity with LLM |
| A8 | Note extraction | "call mom about the doctor" | whole thing is the title | title "Call mom" + note "About the doctor" (LLM parity, offline too) |
| A9 | Relative dates | "a week from friday", "this coming tuesday" | wrong/missing date | correct date math |
| A10 | Learning warm-start | "gym tomorrow" (user always does gym evenings) | learned pattern IGNORED by det parse | LearningDigest recurrence + strong-window threads into CaptureContext — zero-token personalization that's ALREADY COMPUTED, just unplugged |

### Larger / later
| # | Gap | Notes |
|---|-----|-------|
| A11 | Time ranges "2-4pm" | needs schema field (atEnd); calendar-block payoff |
| A12 | Confidence → follow-up UI | low-confidence fields could ask one chip-question; polish |
| A13 | Multilingual date vocab | ~40 date words per language (es/pt/fr/de first) → free-tier dates in-language; telemetry decides order |

## B · LLM pipeline

| # | Item | Size | Impact | Notes |
|---|------|------|--------|-------|
| B1 | `temperature` per kind — extraction (understand/clarify) ~0.2, untangle ~0.7 conversational | S | HIGH | proxy sends none today → defaults 1.0 (max randomness) for JSON extraction. Server-side, per-kind map like KIND_MODEL. |
| B2 | Today's tasks + load in context | M | HIGH | LLM can't see what's already on the day: no dedup awareness ("call Sarah" twice), no load-aware placement (2nd task ≠ 10th task). Add "Tasks already today: …" + load line to buildContextBlock. Dynamic (uncached) input, but short. |
| B3 | One retry on JSON parse failure | M | MED | Long dumps (the captures that MOST need the LLM) are likeliest to fail parse; a "return ONLY valid JSON" retry recovers them for ~the cost of one extra call, only on failure. |
| B4 | clarifyCache (mirror understandCache) | S | MED | Repeated sends of the same garble bill Haiku twice. 15-line dedupe. |
| B5 | Corrections store breadth | M | MED | The moat only records title/window/importance/duration/date edits — NOT recur fixes, time moves, or splits. LLM is told "mirror these patterns" from an incomplete record. |
| B6 | Benchmark expansion | M | MED | Zero multilingual cases (prompt now supports any language!), no 800+ char dumps, no "the 15th"-style dates, no emoji-heavy. ~15 cases. |
| B7 | Merge-stub polish (smartTasksFromLlm defaults) | S | LOW | Cosmetic; patchWithUnderstood already corrects. |

### Rejected from the sweep (with reasons — don't do these)
- `stop_sequences: ["}"]` — would truncate at the FIRST closing brace of
  any nested object (`"when":{...}` ends the response). A correctness
  trap; the minified-format prompt already handles trailing prose.
- `top_p` alongside temperature — Anthropic advises tuning one, not both.

## Suggested batches (for the go-over)

**Batch 1 — same-day, near-zero risk, live via OTA + proxy deploy:**
A2 biweekly/twice-a-week · A3 no-rush words · A4 bullet lists ·
A5 couple/few · A6 half-past · B1 temperature · B4 clarifyCache
(each lands with corpus guards; B1 verified by bench:live re-run)

**Batch 2 — the "beat expectations" trio (1 session):**
A7 inline durations · A8 about/for note extraction · A1 fuzzy times —
these three give FREE-tier captures near-LLM polish (clean titles,
real durations, fuzzy time intent) and make Pro's local-routed sends
feel premium.

**Batch 3 — intelligence (1–2 sessions):**
B2 today-context + load · A10 learning warm-start (the already-computed
personalization that's unplugged) · B3 parse retry · B5 corrections
breadth · B6 benchmark expansion

**Later:** A9 relative dates · A11 time ranges (schema) · A12
confidence follow-ups · A13 multilingual date vocab (telemetry-driven).
