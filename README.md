# Lumi

A React Native + Expo companion app for people with ADHD. Built around
**Luna**, a pixel-art cat whose room and behavior reflect the user's real
usage data.

## Stack

- Expo SDK 56 (React Native 0.85, React 19)
- Expo Router (file-based routing, typed routes)
- Zustand + AsyncStorage for state and persistence
- Supabase JS for auth, database, realtime
- Anthropic SDK (`claude-sonnet-4-6`) for emotional check-ins, brain-dump
  parsing, and the weekly Luna report
- Expo Haptics + Expo Notifications
- react-native-svg for the pixel-art room

## Setup

```bash
npm install --legacy-peer-deps
cp .env.example .env
# fill in EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY,
# and (optionally) EXPO_PUBLIC_ANTHROPIC_API_KEY
npm run ios       # or: npm run android / npm run web
```

If the Anthropic key is omitted, Lumi falls back to built-in offline copy
that follows the exact response shape — the rest of the app stays fully
functional offline.

### Database

Migrations live in `supabase/migrations/`. One-time setup:

```bash
# install (once, macOS)
brew install supabase/tap/supabase

# log in and link this repo to your project
supabase login
supabase link --project-ref <YOUR-PROJECT-REF>

# apply migrations
supabase db push
```

`<YOUR-PROJECT-REF>` is the 20-char ID from your Supabase URL
(`https://<ref>.supabase.co`) or from `supabase projects list`.

The initial migration creates `users`, `quests`, `checkins`,
`sos_events`, `achievements`, `equipped_items`, `brain_dumps`, enables
RLS so each row is scoped to `auth.uid()`, and adds a trigger that
auto-creates a `users` row on signup.

## Structure

```
/app
  /_layout.tsx          root, font loading, onboarding gate
  /(tabs)
    /_layout.tsx        bottom nav
    /index.tsx          Home
    /checkin.tsx        Check-in
    /time.tsx           Time
    /sos.tsx            SOS
    /me.tsx             Me (sub-tabs: Luna / Skins / Items / Goals / Report)
  /onboarding           welcome → name → quiz → pet-name → first-quest
/components
  LunaCanvas.tsx        pixel-art SVG room renderer
  QuestCard, XPBar, MoodGrid, TimeBar, AICheckin, SOSTimer, TraitBar, Pill…
  /me                   the five Me sub-screens
/lib
  supabase.ts           client + db types
  anthropic.ts          claude-sonnet-4-6 wrapper + offline fallback
  gamification.ts       XP curve, level titles, Luna state machine
  notifications.ts      rotating reminder copy + scheduling
/store
  userStore, questStore, checkinStore, petStore
/constants
  colors, fonts, items, skins, milestones
/supabase
  config.toml           CLI project config
  migrations/           timestamped SQL migrations (run via `supabase db push`)
```

## Tone rules

These are baked into every piece of copy:

- Never use: *journey, mindful, validate, cope, strategies, self-care*.
- Things are **neurological**, never personal failures.
- Luna does not guilt-trip. Ever.
- Short sentences. Warm. Direct.

## Notes

- `newArchEnabled: true` and `userInterfaceStyle: dark` are set in
  `app.json` — the app is intentionally dark-mode only.
- Streak shield: one free missed day per week, auto-recharged on Sunday.
- First XP must land within 60 seconds of finishing onboarding. The
  first-quest screen is wired so the only action is the quest itself.
# Lumi
