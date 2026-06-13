import { colors } from './colors';

export type Importance = 'high' | 'medium' | 'low';

export const IMPORTANCE: Record<
  Importance,
  { color: string; label: string; icon: string }
> = {
  high: { color: colors.terra, label: 'Must', icon: '▲' },
  medium: { color: colors.honey, label: 'Steady', icon: '■' },
  low: { color: colors.sage, label: 'Gentle', icon: '●' },
};

export const importanceFromDifficulty = (
  d: 'easy' | 'medium' | 'hard',
): Importance => (d === 'hard' ? 'high' : d === 'medium' ? 'medium' : 'low');

export const difficultyFromImportance = (
  i: Importance,
): 'easy' | 'medium' | 'hard' =>
  i === 'high' ? 'hard' : i === 'medium' ? 'medium' : 'easy';
