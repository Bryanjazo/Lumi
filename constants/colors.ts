// Lumi · palette — taken directly from the focusquest-final.html mock.
// These match the original spec; the brief lofi-desaturation pass on
// Lumi-1003 was reverted to keep the mock's slightly more saturated feel.

export const colors = {
  bg: '#141210',
  bgAuth: '#171311', // warmer coffee-brown variant used on auth screens
  bg2: '#1A1714',
  surface: '#1F1C18',
  surfaceAuth: '#1F1A17', // matched warmer surface for auth cards
  card: '#252118',
  border: '#2E2920',
  border2: '#3A332A',

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
