import { describe, expect, it } from 'vitest';
import { previewDay } from './preview';

const m = (userId: string, steps: number, balance = 1000) => ({ userId, steps, balance });

describe('previewDay (mirrors score_group_day)', () => {
  it("moves each loser's stake to the winners in equal shares", () => {
    expect(previewDay(10000, 30, [m('you', 12400), m('a', 10050), m('b', 9800), m('c', 4000)]))
      .toEqual({ you: 30, a: 30, b: -30, c: -30 });
  });

  it('drops the remainder', () => {
    expect(previewDay(10000, 50, [m('you', 11000), m('a', 11000), m('b', 11000), m('c', 2000)]))
      .toEqual({ you: 16, a: 16, b: 16, c: -50 });
  });

  it('moves nothing when everyone or nobody missed', () => {
    expect(previewDay(10000, 30, [m('a', 1), m('b', 2)])).toEqual({ a: 0, b: 0 });
    expect(previewDay(10000, 30, [m('a', 10000), m('b', 20000)])).toEqual({ a: 0, b: 0 });
  });

  it('caps a loss at the balance', () => {
    expect(previewDay(10000, 30, [m('a', 11000), m('b', 11000), m('c', 11000), m('poor', 0, 20)]))
      .toEqual({ a: 6, b: 6, c: 6, poor: -20 });
  });
});
