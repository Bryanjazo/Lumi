// Lumi · lofi palette
// Dusty, warm, slightly faded — like a worn study-room playlist cover.
// Accents are pulled back from the prior crisp/saturated set to feel more
// "tape", with text leaning a touch warmer so nothing reads as pure white.

export const colors = {
  // Surfaces — a hint warmer than the original pure-warm-dark.
  bg: '#15110D',
  bg2: '#1B1612',
  surface: '#221D17',
  card: '#28221A',
  border: '#332C22',
  border2: '#41382C',

  // Warm neutrals
  cream: '#E3D5B9',
  cream2: '#CDB994',
  cream3: '#9C8460',

  // Plum — dustier, less candy.
  plum: '#B093C6',
  plumDark: '#7D55A4',
  plumBg: 'rgba(176,147,198,0.08)',
  plumBorder: 'rgba(176,147,198,0.18)',

  // Terra — sun-faded ochre.
  terra: '#C6855F',
  terraBg: 'rgba(198,133,95,0.08)',
  terraBorder: 'rgba(198,133,95,0.18)',

  // Moss — drier sage.
  moss: '#82B58D',
  mossBg: 'rgba(130,181,141,0.08)',
  mossBorder: 'rgba(130,181,141,0.18)',

  // Caramel — honey-amber.
  caramel: '#C99E5E',
  caramelBg: 'rgba(201,158,94,0.08)',
  caramelBorder: 'rgba(201,158,94,0.18)',

  // Mist — dusty cornflower.
  mist: '#7F9EBC',
  mistBg: 'rgba(127,158,188,0.08)',
  mistBorder: 'rgba(127,158,188,0.18)',

  // Rose — old-print pink.
  rose: '#D2737E',
  roseBg: 'rgba(210,115,126,0.08)',
  roseBorder: 'rgba(210,115,126,0.18)',

  // Fog — desaturated steel.
  fog: '#94A0AA',
  fogBg: 'rgba(148,160,170,0.08)',
  fogBorder: 'rgba(148,160,170,0.18)',

  // Text — warmer, slightly off-white.
  text: '#E6DBC4',
  text2: '#A0937F',
  text3: '#6A5D4A',

  // Lofi-only helpers
  grain: 'rgba(230,219,196,0.025)', // ~2.5% warm grain
  vignette: 'rgba(0,0,0,0.55)',
  warmth: 'rgba(201,158,94,0.05)', // global warm tint
} as const;

export type AccentKey =
  | 'plum'
  | 'terra'
  | 'moss'
  | 'caramel'
  | 'mist'
  | 'rose'
  | 'fog';

export const accent = (key: AccentKey) => ({
  fg: colors[key],
  bg: colors[`${key}Bg` as keyof typeof colors] as string,
  border: colors[`${key}Border` as keyof typeof colors] as string,
});
