// Lumi · palette — taken directly from the focusquest-final.html mock.
// These match the original spec; the brief lofi-desaturation pass on
// Lumi-1003 was reverted to keep the mock's slightly more saturated feel.

export const colors = {
  // Lumi uses the warm coffee-brown spec on every screen (matches the
  // lumi-home-fun mock). The older auth-specific tokens kept as aliases.
  bg: '#171311',
  bgAuth: '#171311',
  bg2: '#1A1714',
  surface: '#1F1A17',
  surfaceAuth: '#1F1A17',
  card: '#26201C',
  cardHi: '#2D261F',
  borderHi: '#4A3F37',
  text4: '#4A3F37',
  // accents pulled from the mock
  sage: '#8FA378',
  sageBg: 'rgba(143,163,120,0.07)',
  honey: '#C9A06A',
  honeyBg: 'rgba(201,160,106,0.07)',
  gold: '#E8B860',
  terraGlow: 'rgba(216,152,120,0.18)',
  border: '#332B25',
  border2: '#332B25',

  cream: '#E8DCC8',
  cream2: '#D4C4A8',
  cream3: '#A89070',

  plum: '#C4A0E0',
  plumDark: '#8B5FB8',
  plumBg: 'rgba(196,160,224,0.08)',
  plumBorder: 'rgba(196,160,224,0.18)',
  plumBorderStrong: 'rgba(196,160,224,0.25)',

  terra: '#D4906A',
  terraDark: '#B0664A', // used as primary CTA on auth screens
  terraBg: 'rgba(212,144,106,0.08)',
  terraBorder: 'rgba(212,144,106,0.18)',
  terraBorderStrong: 'rgba(212,144,106,0.25)',

  // auth-specific
  err: '#C97560',
  errBg: 'rgba(201,117,96,0.05)',

  moss: '#8BBF96',
  mossBg: 'rgba(139,191,150,0.08)',
  mossBorder: 'rgba(139,191,150,0.18)',
  mossBorderStrong: 'rgba(139,191,150,0.25)',

  caramel: '#D4AA6A',
  caramelBg: 'rgba(212,170,106,0.08)',
  caramelBorder: 'rgba(212,170,106,0.18)',
  caramelBorderStrong: 'rgba(212,170,106,0.25)',

  mist: '#8AACCF',
  mistBg: 'rgba(138,172,207,0.08)',
  mistBorder: 'rgba(138,172,207,0.18)',
  mistBorderStrong: 'rgba(138,172,207,0.25)',

  rose: '#E07A8A',
  roseBg: 'rgba(224,122,138,0.08)',
  roseBorder: 'rgba(224,122,138,0.18)',
  roseBorderStrong: 'rgba(224,122,138,0.25)',

  fog: '#9BAAB8',
  fogBg: 'rgba(155,170,184,0.08)',
  fogBorder: 'rgba(155,170,184,0.18)',
  fogBorderStrong: 'rgba(155,170,184,0.20)',

  text: '#EDE4D4',
  text2: '#A89A88',
  text3: '#6A5E50',
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
