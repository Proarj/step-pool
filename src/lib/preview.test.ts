import { describe, expect, it } from 'vitest';
import { previewDay } from './preview';

const m = (userId: string, steps: number, stake = 30) => ({ userId, steps, stake });

describe('previewDay (mirrors score_group_day)', () => {
  it("splits each loser's stake among winners in proportion to the winners' stakes", () => {
    expect(previewDay(10000, [m('you', 12000, 50), m('ben', 15000, 100), m('cara', 4000, 60)])).toEqual({
      transfers: [{ from: 'cara', to: 'you', amount: 20 }, { from: 'cara', to: 'ben', amount: 40 }],
      change: { you: 20, ben: 40, cara: -60 },
    });
  });

  it('with equal stakes, each loser pays each winner the same', () => {
    expect(previewDay(10000, [m('you', 12400), m('a', 10050), m('b', 9800), m('c', 4000)]).change)
      .toEqual({ you: 30, a: 30, b: -30, c: -30 });
  });

  it('leaves rounding with the loser', () => {
    expect(previewDay(10000, [m('you', 12000, 50), m('ben', 12000, 100), m('cara', 100, 50)]).change)
      .toEqual({ you: 16, ben: 33, cara: -49 });
  });

  it('lets a tiny stake win a big one when it is the only winner', () => {
    expect(previewDay(10000, [m('you', 12000, 1), m('cara', 100, 500)]).change).toEqual({ you: 500, cara: -500 });
  });

  it('moves nothing when everyone or nobody missed', () => {
    expect(previewDay(10000, [m('a', 1), m('b', 2)])).toEqual({ transfers: [], change: { a: 0, b: 0 } });
    expect(previewDay(10000, [m('a', 10000), m('b', 20000)])).toEqual({ transfers: [], change: { a: 0, b: 0 } });
  });
});
