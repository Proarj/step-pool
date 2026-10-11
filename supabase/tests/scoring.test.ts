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
  it("splits each loser's stake among the winners in proportion to the winners' stakes", async () => {
    const [you, ben, cara] = await h.users('You', 'Ben', 'Cara');
    const { groupId } = await h.newGroup(you, [ben, cara], { stakes: { [you]: 50, [ben]: 100, [cara]: 60 } });
    await h.walk(you, D1, 12000);
    await h.walk(ben, D1, 15000);
    await h.walk(cara, D1, 4000);
    await h.scoreAt(ist(D2, '00:00'));
    expect(await h.transfers(groupId, D1)).toEqual({ [`${cara}>${you}`]: 20, [`${cara}>${ben}`]: 40 });
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 20, [ben]: 40, [cara]: -60 });
  });

  it('with equal stakes, each loser pays each winner the same', async () => {
    const [you, a, b, c] = await h.users('You', 'A', 'B', 'C');
    const { groupId } = await h.newGroup(you, [a, b, c]);
    await h.walk(you, D1, 12400);
    await h.walk(a, D1, 10050);
    await h.walk(b, D1, 9800);
    await h.walk(c, D1, 4000);
    await h.scoreAt(ist(D2, '00:00'));
    expect(await h.transfers(groupId, D1)).toEqual({
      [`${b}>${you}`]: 15, [`${b}>${a}`]: 15, [`${c}>${you}`]: 15, [`${c}>${a}`]: 15,
    });
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 30, [a]: 30, [b]: -30, [c]: -30 });
  });

  it('leaves rounding with the loser, so no coins disappear', async () => {
    const [you, ben, cara] = await h.users('You', 'Ben', 'Cara');
    const { groupId } = await h.newGroup(you, [ben, cara], { stakes: { [you]: 50, [ben]: 100, [cara]: 50 } });
    await h.walk(you, D1, 12000);
    await h.walk(ben, D1, 12000);
    await h.walk(cara, D1, 100);
    await h.scoreAt(ist(D2, '00:00'));
    expect(await h.transfers(groupId, D1)).toEqual({ [`${cara}>${you}`]: 16, [`${cara}>${ben}`]: 33 });
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 16, [ben]: 33, [cara]: -49 });
  });

  it('lets a tiny stake win a big one when it is the only winner (pure proportional)', async () => {
    const [you, cara] = await h.users('You', 'Cara');
    const { groupId } = await h.newGroup(you, [cara], { stakes: { [you]: 1, [cara]: 500 } });
    await h.walk(you, D1, 12000);
    await h.walk(cara, D1, 100);
    await h.scoreAt(ist(D2, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 500, [cara]: -500 });
  });

  it('treats a member who never synced as 0 steps', async () => {
    const [you, a] = await h.users('You', 'A');
    const { groupId } = await h.newGroup(you, [a]);
    await h.walk(you, D1, 10000);
    await h.scoreAt(ist(D2, '00:00'));
    const rows = await db.sql<{ steps: number; hit: boolean; stake: number }>(
      'select steps, hit, stake from public.day_results where group_id = $1 and user_id = $2', [groupId, a]);
    expect(rows).toEqual([{ steps: 0, hit: false, stake: 30 }]);
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 30, [a]: -30 });
  });

  it('moves no coins when everyone missed', async () => {
    const [you, a, b] = await h.users('You', 'A', 'B');
    const { groupId } = await h.newGroup(you, [a, b]);
    for (const id of [you, a, b]) await h.walk(id, D1, 3000);
    await h.scoreAt(ist(D2, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 0, [a]: 0, [b]: 0 });
    expect(await h.transfers(groupId, D1)).toEqual({});
  });

  it('moves no coins when nobody missed', async () => {
    const [you, a, b] = await h.users('You', 'A', 'B');
    const { groupId } = await h.newGroup(you, [a, b]);
    for (const id of [you, a, b]) await h.walk(id, D1, 15000);
    await h.scoreAt(ist(D2, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 0, [a]: 0, [b]: 0 });
  });

  it('keeps a running total per person that can go negative', async () => {
    const [you, a] = await h.users('You', 'A');
    const { groupId } = await h.newGroup(you, [a]);
    await h.walk(you, D1, 12000);
    await h.walk(you, D2, 12000);
    await h.scoreAt(ist(D3, '00:00'));
    expect(await h.total(groupId, you)).toBe(60);
    expect(await h.total(groupId, a)).toBe(-60);
    const totals = await db.sql<{ user_id: string; total: number }>(
      'select user_id, total from public.group_totals where group_id = $1', [groupId]);
    expect(Object.fromEntries(totals.map((t) => [t.user_id, t.total]))).toEqual({ [you]: 60, [a]: -60 });
  });

  it('leaves out someone who joined that day, and includes them the next day', async () => {
    const [you, a, late] = await h.users('You', 'A', 'Late');
    const { groupId, inviteCode } = await h.newGroup(you, [a]);
    await db.setNow(ist(D1, '08:00'));
    await h.join(late, inviteCode, 60);
    await h.walk(you, D1, 12000);
    await h.walk(a, D1, 5000);
    await h.walk(late, D1, 20000);
    await h.walk(you, D2, 12000);
    await h.walk(a, D2, 12000);
    await h.walk(late, D2, 2000);
    await h.scoreAt(ist(D3, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 30, [a]: -30 });
    expect(await h.changes(groupId, D2)).toEqual({ [you]: 30, [a]: 30, [late]: -60 });
  });

  it('leaves out someone who left before midnight, from that day on', async () => {
    const [you, a, quitter] = await h.users('You', 'A', 'Quitter');
    const { groupId } = await h.newGroup(you, [a, quitter]);
    await h.walk(you, D1, 12000);
    await h.walk(a, D1, 4000);
    await h.walk(quitter, D1, 1000);
    await db.as(quitter, () => db.sql('select public.leave_group($1)', [groupId]));
    await h.walk(you, D2, 12000);
    await h.walk(a, D2, 4000);
    await h.scoreAt(ist(D3, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 30, [a]: -30 });
    expect(await h.changes(groupId, D2)).toEqual({ [you]: 30, [a]: -30 });
  });

  it('someone who leaves and re-joins sits out that day and plays again the next (accepted by the owner)', async () => {
    const [you, a, back] = await h.users('You', 'A', 'Back');
    const { groupId, inviteCode } = await h.newGroup(you, [a, back]);
    await h.walk(you, D1, 12000);
    await h.walk(a, D1, 12000);
    await h.walk(back, D1, 1000);
    await db.setNow(ist(D1, '23:55'));
    await db.as(back, () => db.sql('select public.leave_group($1)', [groupId]));
    await h.join(back, inviteCode);
    await h.walk(you, D2, 12000);
    await h.walk(a, D2, 12000);
    await h.walk(back, D2, 1000);
    await h.scoreAt(ist(D3, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: 0, [a]: 0 });
    expect(await h.changes(groupId, D2)).toEqual({ [you]: 15, [a]: 15, [back]: -30 });
  });

  it("scores each day with that day's goal", async () => {
    const [you, a] = await h.users('You', 'A');
    const { groupId } = await h.newGroup(you, [a]);
    await db.setNow(ist(D1, '12:00'));
    await db.as(you, () => db.sql('select public.update_group_settings($1, 5000)', [groupId]));
    await h.walk(you, D1, 6000);
    await h.walk(a, D1, 12000);
    await h.walk(you, D2, 6000);
    await h.walk(a, D2, 12000);
    await h.scoreAt(ist(D3, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: -30, [a]: 30 });
    expect(await h.changes(groupId, D2)).toEqual({ [you]: 0, [a]: 0 });
  });

  it("scores each day with that day's stakes", async () => {
    const [you, a] = await h.users('You', 'A');
    const { groupId } = await h.newGroup(you, [a]);
    await db.setNow(ist(D1, '12:00'));
    await db.as(you, () => db.sql('select public.set_my_stake($1, 90)', [groupId]));
    await h.walk(a, D1, 12000);
    await h.walk(a, D2, 12000);
    await h.scoreAt(ist(D3, '00:00'));
    expect(await h.changes(groupId, D1)).toEqual({ [you]: -30, [a]: 30 });
    expect(await h.changes(groupId, D2)).toEqual({ [you]: -90, [a]: 90 });
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
    const { groupId } = await h.newGroup(you, [a]);
    await h.walk(you, D1, 12000);
    expect(await h.scoreAt(ist(D2, '00:00'))).toBe(2);
    expect(await h.scoreAt(ist(D2, '01:00'))).toBe(0);
    expect(await h.total(groupId, you)).toBe(30);
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
