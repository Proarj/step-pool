import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './db';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});

describe('signing up', () => {
  it('creates a profile named after the Google account and grants 1,000 coins', async () => {
    const id = await db.createUser({ name: 'Asha Rao', email: 'asha@example.com' });
    const [profile] = await db.sql<{ display_name: string }>(
      'select display_name from public.profiles where id = $1', [id]);
    expect(profile.display_name).toBe('Asha Rao');
    const ledger = await db.sql<{ amount: number; reason: string }>(
      'select amount, reason from public.coin_ledger where user_id = $1', [id]);
    expect(ledger).toEqual([{ amount: 1000, reason: 'welcome' }]);
  });

  it('falls back to the email name when Google sends no name', async () => {
    const id = await db.createUser({ email: 'ben.k@example.com' });
    const [profile] = await db.sql<{ display_name: string }>(
      'select display_name from public.profiles where id = $1', [id]);
    expect(profile.display_name).toBe('ben.k');
  });
});

describe('app_today', () => {
  it('follows IST, not UTC', async () => {
    await db.setNow('2026-10-11T18:29:59Z'); // 23:59:59 IST on the 11th
    expect((await db.sql<{ d: string }>('select public.app_today()::text as d'))[0].d).toBe('2026-10-11');
    await db.setNow('2026-10-11T18:30:00Z'); // 00:00 IST on the 12th
    expect((await db.sql<{ d: string }>('select public.app_today()::text as d'))[0].d).toBe('2026-10-12');
  });
});

describe('direct writes from the app', () => {
  it('are refused', async () => {
    const id = await db.createUser({ name: 'Asha' });
    await db.as(id, async () => {
      await expect(db.sql(
        `insert into public.coin_ledger (user_id, amount, reason) values ($1, 500, 'won')`, [id],
      )).rejects.toThrow(/permission denied/);
      await expect(db.sql(
        `insert into public.daily_steps (user_id, day, steps, source, synced_at)
         values ($1, '2026-10-11', 5000, 'health_connect', now())`, [id],
      )).rejects.toThrow(/permission denied/);
      await expect(db.sql(
        `update public.profiles set display_name = 'Hacker' where id = $1`, [id],
      )).rejects.toThrow(/permission denied/);
      await expect(db.sql('delete from public.coin_ledger')).rejects.toThrow(/permission denied/);
    });
  });
});
