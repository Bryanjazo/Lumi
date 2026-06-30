// Single source of truth for Luna's animated GIFs.
//
// Each mood maps to its own asset so callers (paywall, Home nook,
// Me room, auth screens, onboarding, profile, chat avatar, etc.)
// can render the right expression with one consistent API.
//
// Use:
//   import { lunaSource } from '../lib/luna-source';
//   <Image source={lunaSource(mood)} style={{ width, height }} />
//
// When in doubt, default to 'idle'.

export type LunaMood = 'idle' | 'happy' | 'sad' | 'sleep' | 'walk' | 'lick';

// `require` returns a numeric asset id at bundle time — Metro
// statically resolves these, so we keep one require per mood and
// pick at runtime. New moods get a new asset + a new branch.
//
// 'walk' is the animated GIF that shows the cat actually MOVING
// on its little feet — used by the Me-tab pacing loop. 'lick' is
// the grooming animation; we inject it as a brief beat during
// task completion + focus start + occasional Me-tab idle moments
// so the cat reads as a living creature with little personality
// quirks instead of just rotating through static emotions.
const SOURCES = {
  idle: require('../assets/luna-idle.gif'),
  happy: require('../assets/luna-happy.gif'),
  sad: require('../assets/luna-sad.gif'),
  sleep: require('../assets/luna-sleep.gif'),
  walk: require('../assets/luna-walk.gif'),
  lick: require('../assets/luna-lick.gif'),
} as const;

export const lunaSource = (mood: LunaMood = 'idle') =>
  SOURCES[mood] ?? SOURCES.idle;
