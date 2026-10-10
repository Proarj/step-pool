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

  it('sees profiles, steps, ledger and balances of fellow members only', async () => {
    await db.as(asha, async () => {
      const both = [asha, ben].sort();
      expect(ids(await db.sql('select id from public.profiles'), 'id')).toEqual(both);
      expect(ids(await db.sql('select user_id from public.daily_steps'), 'user_id')).toEqual(both);
      expect(ids(await db.sql('select distinct user_id from public.coin_ledger'), 'user_id')).toEqual(both);
      const balances = await db.sql<{ user_id: string; balance: number }>(
        'select user_id, balance from public.balances');
      expect(Object.fromEntries(balances.map((b) => [b.user_id, b.balance])))
        .toEqual({ [asha]: 1030, [ben]: 970 });
    });
  });

  it("cannot read another group even with its id", async () => {
    await db.as(cara, async () => {
      expect(await db.sql('select id from public.groups where id = $1', [g1])).toEqual([]);
      expect(await db.sql('select user_id from public.group_members where group_id = $1', [g1])).toEqual([]);
      expect(await db.sql('select user_id from public.day_results where group_id = $1', [g1])).toEqual([]);
      expect(await db.sql('select user_id from public.daily_steps where user_id = $1', [asha])).toEqual([]);
    });
    expect(g2).toBeTruthy();
  });

  it('still sees the names of people who left, next to their past results', async () => {
    await db.as(ben, () => db.sql('select public.leave_group($1)', [g1]));
    const rows = await db.as(asha, () =>
      db.sql<{ user_id: string; display_name: string | null }>(
        `select dr.user_id, p.display_name
         from public.day_results dr left join public.profiles p on p.id = dr.user_id
         where dr.group_id = $1`, [g1]));
    expect(Object.fromEntries(rows.map((r) => [r.user_id, r.display_name])))
      .toEqual({ [asha]: 'Asha', [ben]: 'Ben' });
  });

  it('still cannot write to the balances view', async () => {
    await db.as(asha, async () => {
      await expect(db.sql(`delete from public.balances`)).rejects.toThrow(/permission denied|cannot delete/);
    });
  });
});

describe('a signed-out visitor', () => {
  it('cannot read anything', async () => {
    await db.as(null, async () => {
      for (const table of ['groups', 'profiles', 'daily_steps', 'coin_ledger', 'day_results', 'balances']) {
        await expect(db.sql(`select * from public.${table}`)).rejects.toThrow(/permission denied/);
      }
    });
  });
});
