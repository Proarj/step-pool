import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, ist, type TestDb } from './db';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.close();
});

describe('test database', () => {
  it('lets tests control the clock', async () => {
    await db.setNow(ist('2026-10-11', '23:59:59'));
    const [row] = await db.sql<{ d: string }>(
      `select (public.app_now() at time zone 'Asia/Kolkata')::date::text as d`,
    );
    expect(row.d).toBe('2026-10-11');
  });

  it('runs queries as a signed-in user', async () => {
    const id = await db.createUser({ name: 'Asha' });
    const [row] = await db.as(id, () =>
      db.sql<{ uid: string; role: string }>('select auth.uid()::text as uid, current_user::text as role'),
    );
    expect(row).toEqual({ uid: id, role: 'authenticated' });
  });

  it('runs queries signed out as anon', async () => {
    const [row] = await db.as(null, () =>
      db.sql<{ uid: string | null; role: string }>('select auth.uid()::text as uid, current_user::text as role'),
    );
    expect(row).toEqual({ uid: null, role: 'anon' });
  });

  it('gives every test its own database', async () => {
    await db.createUser({ name: 'Asha' });
    const other = await createTestDb();
    try {
      const [row] = await other.sql<{ n: number }>('select count(*)::int as n from auth.users');
      expect(row.n).toBe(0);
    } finally {
      await other.close();
    }
  });
});
