# Me tab (Luna's room) — redesign brief

## What this page IS
The Me tab is Lumi's emotional home base — not a settings page, not a
stats dashboard. It's where the user's relationship with Luna (their
pixel cat companion) lives. Everything on it answers one question:
"how are WE doing?" — the user and the cat, together. The app is an
ADHD-friendly brain-dump-to-done task app; this page is the retention
and affection surface, deliberately free of tasks and pressure.

## Audience & soul constraints (non-negotiable)
- ADHD adults, many with shame around productivity. NEVER guilt:
  no red states, no "you missed X", no decaying streaks shown here.
  Gaps are rest, not failure.
- Luna's affection is unconditional — her mood/room never punishes.
- Warm-hearth aesthetic: Fraunces serif for feeling lines, Inter for
  UI, dark "void" page background, ember/honey accent palette.
- Free tier sees everything on this page; nothing here is locked.

## Page structure today (top → bottom)
1. **HERO — Luna's room (full-bleed, ~screenWidth × 0.82)**
   - Commissioned pixel-art room (cream walls, window, wall shelf,
     rug, wood floor) + decor layers: cat bookshelf cabinet, potted
     vase, picture frame. Assets in `assets/room/`, art canvas
     200×164 (172×144 art edge-padded), 6× nearest-neighbor upscaled.
   - Luna (animated GIF sprite, 36 skin variants) lives on the rug:
     wanders the floor, sits, grooms, bobs; sleeps at night. Mood
     comes from ambient vitality (0–100 score off recent activity).
   - Vitality drives LIGHT: dim veil at low vitality, honey warmth at
     high. Night (8p–6a) lays a starlit pane over the window glass.
   - Tap anywhere on the room = "sit with her" (cheer pulse + toast).
   - Chrome over the room: "{PET}'S ROOM" eyebrow, paint-brush dot
     (opens a 6-swatch wall-tint row: none/rose/sage/sky/lavender/
     honey — persisted `userStore.roomTint`), profile door icon.
2. **"N days, the two of you"** — bond block. Days together, one
   rotating warm line, then "Xh Ym by the hearth together · N things
   finished, ever" once earned.
3. **"Your road"** — rank as a walked path (JourneyPath component):
   current rank glowing at left, next rank at right, walker bead at
   exact XP progress. Rank titles are cozy, not gamer-y.
4. **"This week's story"** — one Fraunces sentence summarizing the
   week (generated on-device), cat badge, "full recap →" door to the
   weekly recap screen.
5. **"YOUR CORNER"** — the tidy hub (demoted utility rows): snapshot
   chips (days with Lumi / done this week / captures sorted), doors
   to Patterns tab ("What Lumi knows"), skins, worlds (XP-unlocked
   scenes; room is default), settings-ish rows.
6. **Companion-mode variants**: "Focused" mode hides the room + all
   game chrome entirely (neutral header instead); "Minimal" keeps
   the room but quiets copy. Any redesign must define all three.

## Data available to the page
- vitality (0–100, eased), ambient Luna mood (idle/happy/sad/sleep),
  daysTogether, focusMinutesLifetime, tasksEverCompleted, XP/rank +
  progress, streak (shown gently elsewhere), weekly done counts,
  learning digest (energy curve, strong window, wins) — mostly
  surfaced on the Patterns tab, not here.
- userStore.roomTint ('none'|'rose'|'sage'|'sky'|'lavender'|'honey').

## Known tensions a redesign should solve
- The room hero is now LIGHT pixel art on a DARK page — the seam
  between hero bottom and the void background is abrupt; needs a
  designed transition that doesn't smear black over the art.
- Chrome legibility over cream walls (eyebrow text, paint dot,
  profile icon) — currently relies on text-shadow.
- Below-the-fold feels list-like compared to the charming hero;
  bond/road/story blocks could compose into something more scene-like.
- The paint swatch row is functional but bare — could become a small
  delightful "decorate" moment (more decor choices later: rug color,
  shelf items — the store field is extensible).

## Hard requirements for any redesign
- Keep tap-the-room = affection interaction.
- Keep vitality→light mapping (never vitality→cat suffering).
- Keep Focused-mode (no room, no XP) fully supported.
- 60fps: the room runs one rAF loop gated on tab focus; Luna's walk
  uses native-driver transforms. Don't add per-frame JS layout work.
- Respect iPhone notch/safe-area; hero is full-bleed behind status bar.
