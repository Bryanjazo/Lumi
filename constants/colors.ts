export const colors = {
  bg: '#141210',
  bg2: '#1A1714',
  surface: '#1F1C18',
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

  terra: '#D4906A',
  terraBg: 'rgba(212,144,106,0.08)',
  terraBorder: 'rgba(212,144,106,0.18)',

  moss: '#8BBF96',
  mossBg: 'rgba(139,191,150,0.08)',
  mossBorder: 'rgba(139,191,150,0.18)',

  caramel: '#D4AA6A',
  caramelBg: 'rgba(212,170,106,0.08)',
  caramelBorder: 'rgba(212,170,106,0.18)',

  mist: '#8AACCF',
  mistBg: 'rgba(138,172,207,0.08)',
  mistBorder: 'rgba(138,172,207,0.18)',

  rose: '#E07A8A',
  roseBg: 'rgba(224,122,138,0.08)',
  roseBorder: 'rgba(224,122,138,0.18)',

  fog: '#9BAAB8',
  fogBg: 'rgba(155,170,184,0.08)',
  fogBorder: 'rgba(155,170,184,0.18)',

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
