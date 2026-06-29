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

export type LunaMood = 'idle' | 'happy' | 'sad' | 'sleep';

// `require` returns a numeric asset id at bundle time — Metro
// statically resolves these, so we keep one require per mood and
// pick at runtime. New moods get a new asset + a new branch.
const SOURCES = {
  idle: require('../assets/luna-idle.gif'),
  happy: require('../assets/luna-happy.gif'),
  sad: require('../assets/luna-sad.gif'),
  sleep: require('../assets/luna-sleep.gif'),
} as const;

export const lunaSource = (mood: LunaMood = 'idle') =>
  SOURCES[mood] ?? SOURCES.idle;
