export interface Milestone {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  target: number;
  metric: 'quests' | 'streak' | 'checkins' | 'level' | 'sos';
  unlocks?: { type: 'item' | 'skin'; id: string };
}

export const milestones: Milestone[] = [
  {
    id: 'first-step',
    title: 'First Step',
    description: 'Complete your first quest',
    xpReward: 30,
    target: 1,
    metric: 'quests',
  },
  {
    id: 'ten-quests',
    title: 'Ten Down',
    description: 'Complete 10 quests',
    xpReward: 100,
    target: 10,
    metric: 'quests',
    unlocks: { type: 'item', id: 'plant-monstera' },
  },
  {
    id: 'week-streak',
    title: 'A Whole Week',
    description: 'Keep a 7-day streak',
    xpReward: 200,
    target: 7,
    metric: 'streak',
    unlocks: { type: 'skin', id: 'plum' },
  },
  {
    id: 'level-five',
    title: 'Finding Rhythm',
    description: 'Reach level 5',
    xpReward: 150,
    target: 5,
    metric: 'level',
    unlocks: { type: 'item', id: 'lamp-plum' },
  },
  {
    id: 'five-checkins',
    title: 'Listening In',
    description: 'Do 5 check-ins',
    xpReward: 80,
    target: 5,
    metric: 'checkins',
  },
  {
    id: 'fifty-quests',
    title: 'Half a Hundred',
    description: 'Complete 50 quests',
    xpReward: 300,
    target: 50,
    metric: 'quests',
    unlocks: { type: 'skin', id: 'moss' },
  },
  {
    id: 'survived-storm',
    title: 'Survived the Storm',
    description: 'Use SOS and come out the other side',
    xpReward: 100,
    target: 1,
    metric: 'sos',
  },
  {
    id: 'thirty-day',
    title: 'A Full Moon',
    description: 'Keep a 30-day streak',
    xpReward: 500,
    target: 30,
    metric: 'streak',
    unlocks: { type: 'skin', id: 'midnight' },
  },
];
