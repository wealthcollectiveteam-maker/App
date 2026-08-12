import type {
  LeaderRow,
  Scenario,
  ScenarioState,
  Squad,
  TaskDef,
} from './types';

export const TASKS: TaskDef[] = [
  { key: 'workout1', label: 'Workout 1 — 45 min', sub: '45 minutes. Indoors or out. No skipping.', proof: true },
  { key: 'workout2', label: 'Workout 2 — outdoors', sub: 'Outdoors, whatever the weather.', proof: true },
  { key: 'water', label: 'Gallon of water', sub: 'One gallon across the day.', proof: false },
  { key: 'read', label: 'Read 10 pages', sub: 'Ten pages of a real book.', proof: false },
  { key: 'diet', label: 'Follow the diet', sub: 'No cheat meals. No alcohol.', proof: false },
  { key: 'photo', label: 'Progress photo', sub: 'One photo. Same spot every day.', proof: true },
];

export const XP = {
  task: 20,
  journal: 10,
  milestone: 50,
  dayComplete: 120,
  perLevel: 800,
} as const;

export const PING_QUIPS = [
  'No excuses.',
  "Water won't drink itself.",
  'Still grinding?',
  'Lock in. Now.',
];

const now = Date.now();
const mins = (n: number) => now - n * 60_000;

function squad(members: Squad['members']): Squad {
  return { name: 'Group 1', code: 'K7X2FD', streak: 9, members };
}

const WHY = 'Because I said I would.';

function leaderboards(selfXp: number): {
  week: LeaderRow[];
  allTime: LeaderRow[];
} {
  const week: LeaderRow[] = [
    { id: 'maya', name: 'Maya', level: 4, xp: 980, isSelf: false },
    { id: 'you', name: 'You', level: 3, xp: Math.min(940, 340 + Math.round(selfXp / 10)), isSelf: true },
    { id: 'jordan', name: 'Jordan', level: 2, xp: 760, isSelf: false },
    { id: 'sam', name: 'Sam', level: 2, xp: 520, isSelf: false },
  ];
  const allTime: LeaderRow[] = [
    { id: 'you', name: 'You', level: 3, xp: selfXp, isSelf: true },
    { id: 'maya', name: 'Maya', level: 4, xp: Math.max(selfXp - 120, 0) + 3080, isSelf: false },
    { id: 'jordan', name: 'Jordan', level: 2, xp: 1490, isSelf: false },
    { id: 'sam', name: 'Sam', level: 2, xp: 1210, isSelf: false },
  ];
  week.sort((a, b) => b.xp - a.xp);
  allTime.sort((a, b) => b.xp - a.xp);
  return { week, allTime };
}

export function buildScenario(scenario: Scenario): ScenarioState {
  switch (scenario) {
    case 'day1': {
      const lb = leaderboards(0);
      return {
        tier: 'hard',
        day: 1,
        flame: 0,
        bestFlame: 0,
        perfectDays: 0,
        xp: 0,
        missedDay: false,
        dayComplete: false,
        tasksDone: {},
        proofs: {},
        why: WHY,
        journal: [],
        meals: [],
        milestones: [
          { id: 'm1', title: 'Run a 5K without stopping', done: false },
          { id: 'm2', title: 'Down 5 lbs', done: false },
          { id: 'm3', title: 'Finish 2 books', done: false },
        ],
        squad: squad([
          { id: 'you', name: 'You', initials: 'YO', level: 1, doneToday: 0, isSelf: true },
          { id: 'maya', name: 'Maya', initials: 'MA', level: 4, doneToday: 1, isSelf: false },
          { id: 'jordan', name: 'Jordan', initials: 'JO', level: 2, doneToday: 0, isSelf: false },
          { id: 'sam', name: 'Sam', initials: 'SA', level: 2, doneToday: 0, isSelf: false },
        ]),
        feed: [],
        leaderboardWeek: lb.week,
        leaderboardAllTime: lb.allTime,
      };
    }
    case 'day12': {
      const lb = leaderboards(1840);
      return {
        tier: 'hard',
        day: 12,
        flame: 11,
        bestFlame: 11,
        perfectDays: 11,
        xp: 1840,
        missedDay: false,
        dayComplete: false,
        tasksDone: {
          workout1: '6:40 AM',
          water: '11:05 AM',
          read: '1:32 PM',
          diet: '2:10 PM',
        },
        proofs: {},
        why: WHY,
        journal: [
          {
            id: 'j2',
            day: 11,
            timestamp: mins(60 * 22),
            text: 'Legs were heavy but the second workout happened anyway. That is the whole point.',
          },
          {
            id: 'j1',
            day: 10,
            timestamp: mins(60 * 46),
            text: 'Double digits tomorrow. The gallon is finally routine.',
          },
        ],
        meals: [
          { id: 'ml3', text: 'Chicken, rice, broccoli', timestamp: mins(95) },
          { id: 'ml2', text: 'Greek yogurt + berries', timestamp: mins(240) },
          { id: 'ml1', text: 'Eggs and oats', timestamp: mins(390) },
        ],
        milestones: [
          { id: 'm1', title: 'Run a 5K without stopping', done: true, meta: 'Hit on Day 9' },
          { id: 'm2', title: 'Down 5 lbs', done: false },
          { id: 'm3', title: 'Finish 2 books', done: false },
        ],
        squad: squad([
          { id: 'you', name: 'You', initials: 'YO', level: 3, doneToday: 4, isSelf: true },
          { id: 'maya', name: 'Maya', initials: 'MA', level: 4, doneToday: 6, isSelf: false },
          { id: 'jordan', name: 'Jordan', initials: 'JO', level: 2, doneToday: 3, isSelf: false },
          { id: 'sam', name: 'Sam', initials: 'SA', level: 2, doneToday: 2, isSelf: false },
        ]),
        feed: [
          { id: 'f4', kind: 'ping-in', who: 'Maya', text: '"Water won\u2019t drink itself."', timestamp: mins(38) },
          { id: 'f3', kind: 'complete', who: 'Maya', text: 'locked in Day 12 — 6 of 6.', timestamp: mins(52) },
          { id: 'f2', kind: 'proof', who: 'Jordan', text: 'attached proof — Workout 2.', timestamp: mins(140) },
          { id: 'f1', kind: 'complete', who: 'Sam', text: 'checked off Gallon of water.', timestamp: mins(220) },
        ],
        leaderboardWeek: lb.week,
        leaderboardAllTime: lb.allTime,
      };
    }
    case 'missed': {
      const lb = leaderboards(1980);
      return {
        tier: 'medium',
        day: 13,
        flame: 0,
        bestFlame: 12,
        perfectDays: 12,
        xp: 1980,
        missedDay: true,
        dayComplete: false,
        tasksDone: {},
        proofs: {},
        why: WHY,
        journal: [
          {
            id: 'j1',
            day: 12,
            timestamp: mins(60 * 26),
            text: 'Called it early. Tomorrow the flame starts over — the work does not.',
          },
        ],
        meals: [],
        milestones: [
          { id: 'm1', title: 'Run a 5K without stopping', done: true, meta: 'Hit on Day 9' },
          { id: 'm2', title: 'Down 5 lbs', done: false },
          { id: 'm3', title: 'Finish 2 books', done: false },
        ],
        squad: squad([
          { id: 'you', name: 'You', initials: 'YO', level: 3, doneToday: 0, isSelf: true },
          { id: 'maya', name: 'Maya', initials: 'MA', level: 4, doneToday: 2, isSelf: false },
          { id: 'jordan', name: 'Jordan', initials: 'JO', level: 2, doneToday: 1, isSelf: false },
          { id: 'sam', name: 'Sam', initials: 'SA', level: 2, doneToday: 0, isSelf: false },
        ]),
        feed: [
          { id: 'f2', kind: 'ping-in', who: 'Maya', text: '"Lock in. Now."', timestamp: mins(25) },
          { id: 'f1', kind: 'complete', who: 'Jordan', text: 'checked off Workout 1.', timestamp: mins(180) },
        ],
        leaderboardWeek: lb.week,
        leaderboardAllTime: lb.allTime,
      };
    }
    case 'day75': {
      const lb = leaderboards(8960);
      return {
        tier: 'hard',
        day: 75,
        flame: 75,
        bestFlame: 75,
        perfectDays: 75,
        xp: 8960,
        missedDay: false,
        dayComplete: true,
        tasksDone: {
          workout1: '6:12 AM',
          workout2: '5:45 PM',
          water: '3:20 PM',
          read: '8:05 PM',
          diet: '8:06 PM',
          photo: '8:10 PM',
        },
        proofs: { photo: 'mock://day75-photo' },
        why: WHY,
        journal: [
          {
            id: 'j2',
            day: 75,
            timestamp: mins(30),
            text: 'Last one. Never missed. I know exactly what I am capable of now.',
          },
          {
            id: 'j1',
            day: 74,
            timestamp: mins(60 * 25),
            text: 'One more day. Feels less like an ending and more like a floor.',
          },
        ],
        meals: [
          { id: 'ml2', text: 'Salmon, quinoa, greens', timestamp: mins(70) },
          { id: 'ml1', text: 'Eggs and oats', timestamp: mins(480) },
        ],
        milestones: [
          { id: 'm1', title: 'Run a 5K without stopping', done: true, meta: 'Hit on Day 9' },
          { id: 'm2', title: 'Down 5 lbs', done: true, meta: 'Hit on Day 41' },
          { id: 'm3', title: 'Finish 2 books', done: true, meta: 'Hit on Day 68' },
        ],
        squad: squad([
          { id: 'you', name: 'You', initials: 'YO', level: 12, doneToday: 6, isSelf: true },
          { id: 'maya', name: 'Maya', initials: 'MA', level: 4, doneToday: 5, isSelf: false },
          { id: 'jordan', name: 'Jordan', initials: 'JO', level: 2, doneToday: 4, isSelf: false },
          { id: 'sam', name: 'Sam', initials: 'SA', level: 2, doneToday: 3, isSelf: false },
        ]),
        feed: [
          { id: 'f2', kind: 'complete', who: 'You', text: 'locked in Day 75 — 6 of 6.', timestamp: mins(20) },
          { id: 'f1', kind: 'ping-in', who: 'Maya', text: '"Still grinding?"', timestamp: mins(200) },
        ],
        leaderboardWeek: lb.week,
        leaderboardAllTime: lb.allTime,
      };
    }
  }
}
