import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, ist, type TestDb } from './db';
import { helpers } from './helpers';

let db: TestDb;
let h: ReturnType<typeof helpers>;
let asha: string, ben: string, cara: string;
let g1: string, g2: string;

beforeEach(async () => {
  db = await createTestDb();
  h = helpers(db);
  await db.setNow(ist('2026-10-10'));
  [asha, ben, cara] = await h.users('Asha', 'Ben', 'Cara');
  g1 = (await h.newGroup(asha, [ben])).groupId;
  g2 = (await h.newGroup(cara, [])).groupId;
  await h.walk(asha, '2026-10-11', 12000);
  await h.walk(ben, '2026-10-11', 3000);
  await h.walk(cara, '2026-10-11', 7000);
  await h.scoreAt(ist('2026-10-12', '00:00'));
});
afterEach(async () => {
  await db.close();
});

const ids = (rows: Record<string, unknown>[], key: string) =>
  rows.map((r) => r[key] as string).sort();

describe('a member', () => {
  it('sees their group, its settings, members and results', async () => {
    await db.as(asha, async () => {
      expect(ids(await db.sql('select id from public.groups'), 'id')).toEqual([g1]);
      expect(ids(await db.sql('select distinct group_id from public.group_settings'), 'group_id')).toEqual([g1]);
      expect(ids(await db.sql('select user_id from public.group_members'), 'user_id')).toEqual([asha, ben].sort());
      expect(ids(await db.sql('select distinct group_id from public.day_results'), 'group_id')).toEqual([g1]);
    });
  });

  it('sees profiles, steps, stakes, payments and totals of their group only', async () => {
    await db.as(asha, async () => {
      const both = [asha, ben].sort();
      expect(ids(await db.sql('select id from public.profiles'), 'id')).toEqual(both);
      expect(ids(await db.sql('select user_id from public.daily_steps'), 'user_id')).toEqual(both);
      expect(ids(await db.sql('select distinct user_id from public.member_stakes'), 'user_id')).toEqual(both);
      const paid = await db.sql<{ from_user: string; to_user: string; amount: number }>(
        'select from_user, to_user, amount from public.day_transfers');
      expect(paid).toEqual([{ from_user: ben, to_user: asha, amount: 30 }]);
      const totals = await db.sql<{ group_id: string; user_id: string; total: number }>(
        'select group_id, user_id, total from public.group_totals');
      expect(Object.fromEntries(totals.map((t) => [t.user_id, t.total]))).toEqual({ [asha]: 30, [ben]: -30 });
      expect(new Set(totals.map((t) => t.group_id))).toEqual(new Set([g1]));
    });
  });

  it("cannot read another group even with its id", async () => {
    await db.as(cara, async () => {
      expect(await db.sql('select id from public.groups where id = $1', [g1])).toEqual([]);
      expect(await db.sql('select user_id from public.group_members where group_id = $1', [g1])).toEqual([]);
      expect(await db.sql('select user_id from public.day_results where group_id = $1', [g1])).toEqual([]);
      expect(await db.sql('select user_id from public.daily_steps where user_id = $1', [asha])).toEqual([]);
      expect(await db.sql('select user_id from public.member_stakes where group_id = $1', [g1])).toEqual([]);
      expect(await db.sql('select from_user from public.day_transfers where group_id = $1', [g1])).toEqual([]);
      expect(await db.sql('select user_id from public.group_totals where group_id = $1', [g1])).toEqual([]);
    });
    expect(g2).toBeTruthy();
  });

  it('still sees the names of people who left, next to their past results', async () => {
    await db.as(ben, () => db.sql('select public.leave_group($1)', [g1]));
    await db.setNow(ist('2026-10-13')); // the leave has taken effect
    const rows = await db.as(asha, () =>
      db.sql<{ user_id: string; display_name: string | null }>(
        `select dr.user_id, p.display_name
         from public.day_results dr left join public.profiles p on p.id = dr.user_id
         where dr.group_id = $1`, [g1]));
    expect(Object.fromEntries(rows.map((r) => [r.user_id, r.display_name])))
      .toEqual({ [asha]: 'Asha', [ben]: 'Ben' });
  });

  it('stops seeing the group as soon as they leave', async () => {
    await db.as(ben, () => db.sql('select public.leave_group($1)', [g1]));
    await db.as(ben, async () => {
      expect(await db.sql('select id from public.groups')).toEqual([]);
      expect(await db.sql('select user_id from public.day_results where group_id = $1', [g1])).toEqual([]);
    });
  });

  it('still cannot write to the totals view', async () => {
    await db.as(asha, async () => {
      await expect(db.sql(`delete from public.group_totals`)).rejects.toThrow(/permission denied|cannot delete/);
    });
  });
});

describe('a signed-out visitor', () => {
  it('cannot read anything', async () => {
    await db.as(null, async () => {
      for (const table of ['groups', 'profiles', 'daily_steps', 'member_stakes', 'day_transfers', 'day_results', 'group_totals']) {
        await expect(db.sql(`select * from public.${table}`)).rejects.toThrow(/permission denied/);
      }
    });
  });
});
