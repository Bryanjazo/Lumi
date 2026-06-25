export const fonts = {
  sans: 'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansSemi: 'DMSans_600SemiBold',
  sansItalic: 'DMSans_400Regular_Italic',
  serif: 'DMSerifDisplay_400Regular',
  serifItalic: 'DMSerifDisplay_400Regular_Italic',

  // Time tab — Fraunces Italic + Inter Tight to match the radar mock
  fraunces: 'Fraunces_400Regular_Italic',
  frauncesMed: 'Fraunces_500Medium_Italic',
  inter: 'InterTight_400Regular',
  interMed: 'InterTight_500Medium',
  interSemi: 'InterTight_600SemiBold',
} as const;

/**
 * Italic-Fraunces digits ({3, 7, 9, 0}) have right-leaning glyph
 * tails that overhang their measured box. iOS clips those tails at
 * the Text bounding edge ("3" becomes "3—half-clipped tail"). The
 * fix is reserving room on the right of any Text that renders an
 * italic Fraunces number.
 *
 * Spread `italicNumberFix` into the number style (or merge into the
 * Text's style array). Sizes:
 *   tiny   : +XP pills, ◈ counts, mini stats     (paddingRight 3)
 *   small  : stats bar numbers, list XP          (paddingRight 5)
 *   large  : hero counts (recap, rank, big time) (paddingRight 8)
 */
export const italicNumberFix = {
  paddingRight: 5,
  includeFontPadding: false,
} as const;

export const italicNumberFixTiny = {
  paddingRight: 3,
  includeFontPadding: false,
} as const;

export const italicNumberFixLarge = {
  paddingRight: 8,
  includeFontPadding: false,
} as const;
