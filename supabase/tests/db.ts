import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * The parts of Supabase our migrations rely on: auth.users, auth.uid(), the
 * API roles, and Supabase's default grants (which give anon/authenticated ALL
 * on new public tables and functions, so migrations must revoke explicitly).
 */
const SUPABASE_STUBS = /* sql */ `
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

/** Replaces the production clock (now()) with one tests set through setNow(). */
const TEST_CLOCK = /* sql */ `
  create or replace function public.app_now() returns timestamptz language sql stable as $$
    select coalesce(nullif(current_setting('test.now', true), '')::timestamptz, now())
  $$;
`;

/** ISO timestamp for a wall-clock time in IST, e.g. ist('2026-10-11', '23:59:59'). */
export function ist(day: string, time = '12:00'): string {
  const hms = time.length === 5 ? `${time}:00` : time;
  return new Date(`${day}T${hms}+05:30`).toISOString();
}

export type TestDb = {
  /** Runs one statement as the current role: the owner, or the user inside as(). */
  sql<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
  /** Sets the time returned by public.app_now(). */
  setNow(iso: string): Promise<void>;
  /** Signs a user up the way Supabase Auth does; returns their id. */
  createUser(opts?: { name?: string; email?: string }): Promise<string>;
  /** Runs fn as a signed-in user (role authenticated), or signed out (role anon) when userId is null. */
  as<T>(userId: string | null, fn: () => Promise<T>): Promise<T>;
  /** Frees the database. Every test must call this (each instance holds ~100 MB of WASM memory). */
  close(): Promise<void>;
};

let template: Promise<PGlite> | undefined;

/** Builds the migrated database once per test file; tests get cheap clones of it. */
async function buildTemplate(): Promise<PGlite> {
  const pg = await PGlite.create();
  await pg.exec(SUPABASE_STUBS);
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql') && !file.endsWith('_cron.sql'))
    .sort();
  for (const file of migrations) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  await pg.exec(TEST_CLOCK);
  return pg;
}

export async function createTestDb(): Promise<TestDb> {
  template ??= buildTemplate();
  const pg = await (await template).clone();

  async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
    const result = await pg.query<T>(query, params);
    return result.rows;
  }

  async function setNow(iso: string): Promise<void> {
    await pg.query(`select set_config('test.now', $1, false)`, [iso]);
  }

  async function createUser({ name, email }: { name?: string; email?: string } = {}): Promise<string> {
    const meta = name ? { full_name: name } : {};
    const [row] = await sql<{ id: string }>(
      'insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id',
      [email ?? null, JSON.stringify(meta)],
    );
    return row.id;
  }

  async function as<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
    await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
    await pg.exec(userId ? 'set role authenticated' : 'set role anon');
    try {
      return await fn();
    } finally {
      await pg.exec('reset role');
      await pg.query(`select set_config('request.jwt.claim.sub', '', false)`);
    }
  }

  async function close(): Promise<void> {
    await pg.close();
  }

  return { sql, setNow, createUser, as, close };
}
