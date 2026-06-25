// Lumi · learning · avoidance
//
// "Things you've been carrying for a while." Open quests that have
// been sitting for N+ days. Group by inferred tag to spot a cluster
// ("3 things waiting · all phone calls"). Math layer only.

import { Quest } from '../../store/questStore';

export interface StaleItem {
  quest: Quest;
  days: number;
  tag: string;
}

export interface AvoidanceCluster {
  tag: string;
  /** Plain "phone calls" / "errands" / "tasks". */
  label: string;
  items: StaleItem[];
}

const ymd = (d: Date): string => {
  // Local Y-M-D — agrees with quest.date so "days since" maps to
  // actual calendar days, not UTC days.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const inferTag = (title: string): string => {
  const t = ' ' + title.toLowerCase() + ' ';
  if (/\b(call|phone|ring)\b/.test(t)) return 'reach out';
  if (/\b(email|text|reply|message|dm)\b/.test(t)) return 'reach out';
  if (/\b(buy|order|pick up|grab|get|store|groceries)\b/.test(t))
    return 'errand';
  if (/\b(pay|bill|rent|invoice|bank|money|transfer)\b/.test(t)) return 'money';
  if (
    /\b(book|appointment|schedule|dentist|doctor|meeting|reservation)\b/.test(t)
  )
    return 'schedule';
  if (/\b(idea|app|build|design|write|project)\b/.test(t)) return 'idea';
  if (/\b(fix|clean|laundry|dishes|home|repair)\b/.test(t)) return 'home';
  return 'task';
};

const TAG_LABEL: Record<string, string> = {
  'reach out': 'phone calls and messages',
  errand: 'errands',
  money: 'bills and money',
  schedule: 'appointments',
  idea: 'ideas',
  home: 'house stuff',
  task: 'things',
};

const dayCount = (q: Quest): number => {
  const created = new Date(q.createdAt);
  return Math.floor((Date.now() - created.getTime()) / 86_400_000);
};

interface AvoidanceOptions {
  /** Minimum days a quest must sit before counting as stale. */
  minDays?: number;
  /** Cap on items returned. */
  limit?: number;
}

export const findStale = (
  quests: Quest[],
  options: AvoidanceOptions = {},
): StaleItem[] => {
  const minDays = options.minDays ?? 5;
  const limit = options.limit ?? 10;
  const today = ymd(new Date());
  const stale: StaleItem[] = [];
  for (const q of quests) {
    if (q.completed) continue;
    // Recurring quests reset on cadence — skip; "waiting" doesn't apply.
    if (q.recur) continue;
    // Someday is opt-in backlog — by design not stale.
    if (q.window === 'someday') continue;
    if (q.date > today) continue;
    const days = dayCount(q);
    if (days < minDays) continue;
    stale.push({ quest: q, days, tag: inferTag(q.title) });
  }
  return stale
    .sort((a, b) => b.days - a.days)
    .slice(0, limit);
};

/**
 * Group stale items by tag; return the largest cluster if it's a real
 * pattern (≥3 items of the same tag). This is what powers the recap's
 * "three things waiting, all phone calls" insight.
 */
export const dominantStaleCluster = (
  stale: StaleItem[],
): AvoidanceCluster | null => {
  if (stale.length < 3) return null;
  const buckets = new Map<string, StaleItem[]>();
  for (const s of stale) {
    const cur = buckets.get(s.tag) ?? [];
    cur.push(s);
    buckets.set(s.tag, cur);
  }
  const sorted = Array.from(buckets.entries())
    .map(([tag, items]) => ({ tag, items }))
    .sort((a, b) => b.items.length - a.items.length);
  const top = sorted[0];
  if (top.items.length < 3) return null;
  return {
    tag: top.tag,
    label: TAG_LABEL[top.tag] ?? top.tag,
    items: top.items.slice(0, 4),
  };
};

const dayLabel = (days: number): string =>
  days === 1 ? '1 day' : `${days} days`;

export const formatStaleDays = dayLabel;
