import { describe, expect, it } from 'vitest';
import { buildLeaderboard, groupByDay, pairTotals, type DayResult } from './leaderboard';

describe('pairTotals', () => {
  it('sums what each person owes each other person, largest first', () => {
    expect(pairTotals([
      { from: 'cara', to: 'you', amount: 20 },
      { from: 'cara', to: 'ben', amount: 40 },
      { from: 'cara', to: 'you', amount: 25 },
    ])).toEqual([
      { debtor: 'cara', creditor: 'you', amount: 45 },
      { debtor: 'cara', creditor: 'ben', amount: 40 },
    ]);
  });

  it('nets payments in both directions between a pair', () => {
    expect(pairTotals([
      { from: 'cara', to: 'you', amount: 30 },
      { from: 'you', to: 'cara', amount: 10 },
    ])).toEqual([{ debtor: 'cara', creditor: 'you', amount: 20 }]);
  });

  it('leaves out pairs that are square', () => {
    expect(pairTotals([
      { from: 'cara', to: 'you', amount: 15 },
      { from: 'you', to: 'cara', amount: 15 },
    ])).toEqual([]);
  });
});

const r = (day: string, userId: string, hit: boolean, coinsChange: number): DayResult =>
  ({ day, userId, steps: hit ? 12000 : 3000, hit, coinsChange });

const history: DayResult[] = [
  r('2026-10-11', 'asha', true, 30), r('2026-10-11', 'ben', false, -30),
  r('2026-10-12', 'asha', false, -30), r('2026-10-12', 'ben', true, 30),
  r('2026-10-13', 'asha', true, 15), r('2026-10-13', 'ben', true, 15), r('2026-10-13', 'cara', false, -30),
];

describe('buildLeaderboard', () => {
  it('totals coins and hit days, best net first, with the current streak', () => {
    expect(buildLeaderboard(history)).toEqual([
      { userId: 'ben', net: 15, daysHit: 2, daysPlayed: 3, streak: 2 },
      { userId: 'asha', net: 15, daysHit: 2, daysPlayed: 3, streak: 1 },
      { userId: 'cara', net: -30, daysHit: 0, daysPlayed: 1, streak: 0 },
    ]);
  });

  it('is empty with no history', () => {
    expect(buildLeaderboard([])).toEqual([]);
  });
});

describe('groupByDay', () => {
  it('groups rows newest day first, keeping row order', () => {
    const days = groupByDay(history);
    expect(days.map((d) => d.day)).toEqual(['2026-10-13', '2026-10-12', '2026-10-11']);
    expect(days[0].rows.map((x) => x.userId)).toEqual(['asha', 'ben', 'cara']);
  });
});
