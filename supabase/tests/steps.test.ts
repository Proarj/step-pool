import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, ist, type TestDb } from './db';

let db: TestDb;
afterEach(async () => {
  await db.close();
});
let asha: string;
beforeEach(async () => {
  db = await createTestDb();
  asha = await db.createUser({ name: 'Asha' });
});

const upload = (day: string, steps: number, source = 'health_connect') =>
  db.as(asha, () =>
    db.sql('select * from public.upload_steps($1::date, $2, $3)', [day, steps, source]));

const stored = () =>
  db.sql<{ day: string; steps: number; source: string }>(
    'select day::text as day, steps, source from public.daily_steps where user_id = $1', [asha]);

describe('upload_steps', () => {
  it("stores today's total and replaces it on later syncs", async () => {
    await db.setNow(ist('2026-10-11', '09:00'));
    await upload('2026-10-11', 3000);
    await db.setNow(ist('2026-10-11', '21:00'));
    await upload('2026-10-11', 11250, 'apple_health');
    expect(await stored()).toEqual([{ day: '2026-10-11', steps: 11250, source: 'apple_health' }]);
    const [fresh] = await db.sql<{ fresh: boolean }>(
      'select synced_at = $2::timestamptz as fresh from public.daily_steps where user_id = $1',
      [asha, ist('2026-10-11', '21:00')]);
    expect(fresh.fresh).toBe(true);
  });

  it('accepts a sync at 23:59:59 IST and rejects one for that day at 00:00 IST', async () => {
    await db.setNow(ist('2026-10-11', '23:59:59'));
    await upload('2026-10-11', 10500);
    await db.setNow(ist('2026-10-12', '00:00'));
    await expect(upload('2026-10-11', 12000)).rejects.toThrow(
      /Steps can only be uploaded for today \(2026-10-12\)/);
    expect(await stored()).toEqual([{ day: '2026-10-11', steps: 10500, source: 'health_connect' }]);
  });

  it('rejects future days', async () => {
    await db.setNow(ist('2026-10-11'));
    await expect(upload('2026-10-12', 5000)).rejects.toThrow(/only be uploaded for today/);
  });

  it.each<[number, string, RegExp]>([
    [-1, 'health_connect', /Steps must be between 0 and 100000/],
    [100001, 'health_connect', /Steps must be between 0 and 100000/],
    [5000, 'fitbit', /Unknown step source: fitbit/],
  ])('rejects steps=%i source=%s', async (steps, source, error) => {
    await db.setNow(ist('2026-10-11'));
    await expect(upload('2026-10-11', steps, source)).rejects.toThrow(error);
  });

  it('refuses signed-out callers', async () => {
    await db.setNow(ist('2026-10-11'));
    await expect(db.as(null, () =>
      db.sql(`select * from public.upload_steps('2026-10-11', 5000, 'health_connect')`),
    )).rejects.toThrow(/permission denied/);
  });
});
