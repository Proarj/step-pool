import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, ist, type TestDb } from './db';
import { helpers } from './helpers';

const CREATED = '2026-10-10';
const D1 = '2026-10-11';
const D2 = '2026-10-12';
const D3 = '2026-10-13';

let db: TestDb;
afterEach(async () => {
  await db.close();
});
let h: ReturnType<typeof helpers>;
beforeEach(async () => {
  db = await createTestDb();
  h = helpers(db);
  await db.setNow(ist(CREATED, '10:00'));
});

describe('score_pending_days', () => {
  it("moves each loser's stake to the winners in equal shares", async () => {
    const [you, a, b, c] = await h.users('You', 'A', 'B', 'C');
    const { groupId } = await h.newGroup(you, [a, b, c]);
    await h.walk(you, D1, 12400);
    await h.walk(a, D1, 10050);
    await h.walk(b, D1, 9800);
    await h.walk(c, D1, 4000);
    await h.scoreAt(ist(D2, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 30, [a]: 30, [b]: -30, [c]: -30 });
    expect([await h.balance(you), await h.balance(a), await h.balance(b), await h.balance(c)])
      .toEqual([1030, 1030, 970, 970]);
  });

  it('drops the remainder when the pot does not split evenly', async () => {
    const [you, a, b, c] = await h.users('You', 'A', 'B', 'C');
    const { groupId } = await h.newGroup(you, [a, b, c], { stake: 50 });
    for (const id of [you, a, b]) await h.walk(id, D1, 11000);
    await h.walk(c, D1, 2000);
    await h.scoreAt(ist(D2, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 16, [a]: 16, [b]: 16, [c]: -50 });
    const [total] = await db.sql<{ t: number }>('select sum(amount)::int as t from public.coin_ledger');
    expect(total.t).toBe(4000 - 2);
  });

  it('treats a member who never synced as 0 steps', async () => {
    const [you, a] = await h.users('You', 'A');
    const { groupId } = await h.newGroup(you, [a]);
    await h.walk(you, D1, 10000);
    await h.scoreAt(ist(D2, '00:00'));
    const rows = await db.sql<{ steps: number; hit: boolean }>(
      'select steps, hit from public.day_results where group_id = $1 and user_id = $2', [groupId, a]);
    expect(rows).toEqual([{ steps: 0, hit: false }]);
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 30, [a]: -30 });
  });

  it('moves no coins when everyone missed', async () => {
    const [you, a, b] = await h.users('You', 'A', 'B');
    const { groupId } = await h.newGroup(you, [a, b]);
    for (const id of [you, a, b]) await h.walk(id, D1, 3000);
    await h.scoreAt(ist(D2, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 0, [a]: 0, [b]: 0 });
    expect(await h.balance(you)).toBe(1000);
  });

  it('moves no coins when nobody missed', async () => {
    const [you, a, b] = await h.users('You', 'A', 'B');
    const { groupId } = await h.newGroup(you, [a, b]);
    for (const id of [you, a, b]) await h.walk(id, D1, 15000);
    await h.scoreAt(ist(D2, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 0, [a]: 0, [b]: 0 });
  });

  it('caps a loss at the balance and tops an empty wallet up to 200', async () => {
    const [you, a, b, poor] = await h.users('You', 'A', 'B', 'Poor');
    const { groupId } = await h.newGroup(you, [a, b, poor]);
    await db.sql(`insert into public.coin_ledger (user_id, amount, reason) values ($1, -980, 'lost')`, [poor]);
    for (const id of [you, a, b]) await h.walk(id, D1, 11000);
    await h.walk(poor, D1, 100);
    await h.scoreAt(ist(D2, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 6, [a]: 6, [b]: 6, [poor]: -20 });
    expect(await h.balance(poor)).toBe(200);
    const topUps = await db.sql('select 1 from public.coin_ledger where user_id = $1 and reason = $2', [poor, 'top_up']);
    expect(topUps).toHaveLength(1);
  });

  it('scores two groups in creation order against the running balance', async () => {
    const [x, p, q, r, s] = await h.users('X', 'P', 'Q', 'R', 'S');
    await db.sql(`insert into public.coin_ledger (user_id, amount, reason) values ($1, -960, 'lost')`, [x]);
    await db.setNow(ist(CREATED, '10:00'));
    const first = await h.newGroup(p, [q, x]);
    await db.setNow(ist(CREATED, '11:00'));
    const second = await h.newGroup(r, [s, x]);
    for (const id of [p, q, r, s]) await h.walk(id, D1, 12000);
    await h.walk(x, D1, 1000);
    await h.scoreAt(ist(D2, '00:00'));
    expect(await h.changes(first.groupId, D1)).toEqual({ [p]: 15, [q]: 15, [x]: -30 });
    expect(await h.changes(second.groupId, D1)).toEqual({ [r]: 5, [s]: 5, [x]: -10 });
    expect(await h.balance(x)).toBe(200);
    const topUps = await db.sql('select 1 from public.coin_ledger where user_id = $1 and reason = $2', [x, 'top_up']);
    expect(topUps).toHaveLength(1);
  });

  it('leaves out someone who joined that day, and includes them the next day', async () => {
    const [you, a, late] = await h.users('You', 'A', 'Late');
    const { groupId, inviteCode } = await h.newGroup(you, [a]);
    await db.setNow(ist(D1, '08:00'));
    await h.join(late, inviteCode);
    await h.walk(you, D1, 12000);
    await h.walk(a, D1, 5000);
    await h.walk(late, D1, 20000);
    await h.walk(you, D2, 12000);
    await h.walk(a, D2, 12000);
    await h.walk(late, D2, 2000);
    await h.scoreAt(ist(D3, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 30, [a]: -30 });
    expect(await h.changes(groupId, D2)).toEqual({ [you]: 15, [a]: 15, [late]: -30 });
  });

  it('leaves out someone who left before midnight', async () => {
    const [you, a, quitter] = await h.users('You', 'A', 'Quitter');
    const { groupId } = await h.newGroup(you, [a, quitter]);
    await h.walk(you, D1, 12000);
    await h.walk(a, D1, 4000);
    await h.walk(quitter, D1, 1000);
    await db.as(quitter, () => db.sql('select public.leave_group($1)', [groupId]));
    await h.scoreAt(ist(D2, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 30, [a]: -30 });
  });

  it("scores each day with that day's goal and stake", async () => {
    const [you, a] = await h.users('You', 'A');
    const { groupId } = await h.newGroup(you, [a]);
    await db.setNow(ist(D1, '12:00'));
    await db.as(you, () => db.sql('select public.update_group_settings($1, 5000, 30)', [groupId]));
    await h.walk(you, D1, 6000);
    await h.walk(a, D1, 12000);
    await h.walk(you, D2, 6000);
    await h.walk(a, D2, 12000);
    await h.scoreAt(ist(D3, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: -30, [a]: 30 });
    expect(await h.changes(groupId, D2)).toEqual({ [you]: 0, [a]: 0 });
    const goals = await db.sql<{ day: string; step_goal: number }>(
      `select distinct day::text as day, step_goal from public.day_results where group_id = $1 order by day`,
      [groupId]);
    expect(goals).toEqual([{ day: D1, step_goal: 10000 }, { day: D2, step_goal: 5000 }]);
  });

  it('does not score today before midnight', async () => {
    const [you, a] = await h.users('You', 'A');
    const { groupId } = await h.newGroup(you, [a]);
    await h.walk(you, D1, 12000);
    expect(await h.scoreAt(ist(D1, '23:59'))).toBe(1); // only the creation day, which has no participants
    expect(await h.changes(groupId, D1)).toEqual({});
  });

  it('is safe to run twice', async () => {
    const [you, a] = await h.users('You', 'A');
    await h.newGroup(you, [a]);
    await h.walk(you, D1, 12000);
    expect(await h.scoreAt(ist(D2, '00:00'))).toBe(2);
    expect(await h.scoreAt(ist(D2, '01:00'))).toBe(0);
    expect(await h.balance(you)).toBe(1030);
  });

  it('catches up on every day it missed', async () => {
    const [you, a] = await h.users('You', 'A');
    const { groupId } = await h.newGroup(you, [a]);
    await h.walk(you, D1, 12000);
    await h.walk(a, D2, 12000);
    expect(await h.scoreAt(ist(D3, '05:00'))).toBe(3);
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 30, [a]: -30 });
    expect(await h.changes(groupId, D2)).toEqual({ [you]: -30, [a]: 30 });
  });

  it('cannot be run by signed-in users', async () => {
    const [you] = await h.users('You');
    await expect(db.as(you, () => db.sql('select public.score_pending_days()')))
      .rejects.toThrow(/permission denied/);
    await expect(db.as(you, () =>
      db.sql(`select public.score_group_day(gen_random_uuid(), '2026-10-11')`),
    )).rejects.toThrow(/permission denied/);
  });
});
