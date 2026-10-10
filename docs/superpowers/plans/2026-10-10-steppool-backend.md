# StepPool Backend Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the StepPool repo and build the complete Supabase backend:
schema, group functions, step uploads, the midnight scoring job and read
security. Everything is proven by automated tests that run locally with no
accounts.

**Architecture:** Supabase Postgres holds all state. The app never writes
tables directly. It calls `security definer` SQL functions (`create_group`,
`join_group`, `update_group_settings`, `leave_group`, `upload_steps`). Reads
are gated by Row Level Security. Scoring is a SQL function run hourly by
pg_cron. Tests run the real migrations inside PGlite (Postgres compiled to
WebAssembly) with stubs for the parts of Supabase the migrations use.

**Tech Stack:** Node 24, Expo SDK 57 template (for the repo scaffold only),
TypeScript 6, Vitest 5.0.3, @electric-sql/pglite 0.5.8, Supabase CLI 2.120.0,
Postgres (Supabase: 15+/17; PGlite: 18).

**Spec:** `docs/superpowers/specs/2026-10-10-steppool-design.md`

**Plan 2 (written after this plan ships):** the Expo app. It covers screens,
Google login, Apple Health / Health Connect, sync, notifications and
distribution.

## Global Constraints

- Every shell command runs from `~/Desktop/step-pool` after `source ~/.nvm/nvm.sh && nvm use >/dev/null` (Node 24, pinned in `.nvmrc`).
- Time zone is IST (`Asia/Kolkata`) everywhere. "Today" = `public.app_today()`.
- Step goal: 1,000–100,000. Daily stake: 1–1,000 coins. Uploaded steps: 0–100,000.
- Wallet: +1,000 coins on sign-up (`welcome`). If a participant's balance is ≤ 0 after a scored day: +200 (`top_up`).
- Goal/stake changes take effect **tomorrow**. Members take part from the day **after** they join.
- Uploads are accepted **only for today (IST)**.
- Scoring: losers lose `min(stake, balance)`. Winners each get `floor(pot / winners)`, and any remainder disappears. No winners, or no losers → no coins move.
- Ledger reasons: exactly `welcome`, `won`, `lost`, `top_up`. Step sources: exactly `apple_health`, `health_connect`.
- The app ships only the anon key. No table accepts `insert/update/delete` from `anon` or `authenticated`.
- Never assume time: SQL uses `public.app_now()` / `public.app_today()`, never `now()` directly, except for `created_at` defaults that no logic reads.
- Commits end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Upload at exactly midnight IST:** a sync at 23:59:59 counts for that day. A sync at 00:00:00 for the previous day is rejected and the stored value is unchanged. *(Task 4)*
2. **Invite code typed in lowercase or with spaces:** still joins the right group. *(Task 3)*
3. **One person in two groups with a low balance:** the second group sees the balance after the first group's loss, the losses never go negative, and there's exactly one top-up. *(Task 5)*
4. **Goal changed twice on the same day:** the last change wins for tomorrow, and today's goal is untouched. *(Task 3)*
5. **A signed-in user calling the scoring functions directly:** permission denied. *(Task 5)*

---

### Task 1: Repo scaffold and SQL test harness

**Files:**
- Create: `.nvmrc`, `vitest.config.ts`, `supabase/migrations/.gitkeep`, `supabase/tests/db.ts`, `supabase/tests/harness.test.ts`
- Create (copied from template): `package.json`, `app.json`, `tsconfig.json`, `.gitignore`, `src/**`, `assets/**`
- Delete (template extras): `scripts/reset-project.js`, `_vscode/`, `LICENSE`, `README.md`

**Interfaces:**
- Produces: `createTestDb(): Promise<TestDb>`, `ist(day: string, time?: string): string`, and
  `TestDb = { sql<T>(query, params?): Promise<T[]>; setNow(iso): Promise<void>; createUser({ name?, email? }?): Promise<string>; as<T>(userId: string | null, fn: () => Promise<T>): Promise<T> }`.
  The harness loads every `supabase/migrations/*.sql` file in name order, except `*_cron.sql`, then replaces `public.app_now()` with a clock read from the `test.now` setting.

- [ ] **Step 1: Install Node 24 and pin it**

```bash
cd ~/Desktop/step-pool
source ~/.nvm/nvm.sh && nvm install 24 && nvm use 24
echo "24" > .nvmrc
node -v
```
Expected: `v24.x.x`

- [ ] **Step 2: Copy the Expo SDK 57 default template into the repo**

```bash
cd ~/Desktop/step-pool && source ~/.nvm/nvm.sh && nvm use >/dev/null
TPL=$(mktemp -d)
(cd "$TPL" && npm pack expo-template-default@57.0.29 >/dev/null && tar -xzf expo-template-default-57.0.29.tgz)
cp -R "$TPL/package/." .
mv gitignore .gitignore
rm -rf _vscode LICENSE README.md scripts
npm pkg set name=step-pool version=1.0.0
npm pkg set private=true --json
npm pkg delete license scripts.reset-project
npm pkg set scripts.test="vitest run" scripts.typecheck="tsc --noEmit"
```

In `app.json`, change exactly three values: `"name": "HelloWorld"` → `"name": "StepPool"`,
`"slug": "expo-template-default"` → `"slug": "step-pool"`, and `"scheme": "helloworld"` → `"scheme": "steppool"`.

- [ ] **Step 3: Install dependencies and test tooling**

```bash
cd ~/Desktop/step-pool && source ~/.nvm/nvm.sh && nvm use >/dev/null
npm install
npm install --save-dev vitest@5.0.3 @electric-sql/pglite@0.5.8 @types/node@24
mkdir -p supabase/migrations supabase/tests && touch supabase/migrations/.gitkeep
```
Expected: installs without `EBADENGINE` errors.

- [ ] **Step 4: Add the Vitest config**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 5: Write the failing harness test**

`supabase/tests/harness.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createTestDb, ist } from './db';

describe('test database', () => {
  it('lets tests control the clock', async () => {
    const db = await createTestDb();
    await db.setNow(ist('2026-10-11', '23:59:59'));
    const [row] = await db.sql<{ d: string }>(
      `select (public.app_now() at time zone 'Asia/Kolkata')::date::text as d`,
    );
    expect(row.d).toBe('2026-10-11');
  });

  it('runs queries as a signed-in user', async () => {
    const db = await createTestDb();
    const id = await db.createUser({ name: 'Asha' });
    const [row] = await db.as(id, () =>
      db.sql<{ uid: string; role: string }>('select auth.uid()::text as uid, current_user::text as role'),
    );
    expect(row).toEqual({ uid: id, role: 'authenticated' });
  });

  it('runs queries signed out as anon', async () => {
    const db = await createTestDb();
    const [row] = await db.as(null, () =>
      db.sql<{ uid: string | null; role: string }>('select auth.uid()::text as uid, current_user::text as role'),
    );
    expect(row).toEqual({ uid: null, role: 'anon' });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run supabase/tests/harness.test.ts`
Expected: FAIL, `Failed to resolve import "./db"` (or "Cannot find module").

- [ ] **Step 7: Write the harness**

`supabase/tests/db.ts`:
```ts
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
};

export async function createTestDb(): Promise<TestDb> {
  const pg = await PGlite.create();
  await pg.exec(SUPABASE_STUBS);
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql') && !file.endsWith('_cron.sql'))
    .sort();
  for (const file of migrations) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  await pg.exec(TEST_CLOCK);

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

  return { sql, setNow, createUser, as };
}
```

- [ ] **Step 8: Run the tests and the typecheck**

Run: `npx vitest run supabase/tests/harness.test.ts && npm run typecheck`
Expected: 3 tests PASS. `tsc` exits 0.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Scaffold Expo app and PGlite SQL test harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schema, sign-up trigger and lockdown

**Files:**
- Create: `supabase/migrations/20261010000001_schema.sql`
- Test: `supabase/tests/schema.test.ts`

**Interfaces:**
- Consumes: `createTestDb`, `ist` (Task 1).
- Produces: `public.app_now(): timestamptz` and `public.app_today(): date` (IST), plus these tables:
  `profiles(id, display_name, avatar_url, created_at)`, `groups(id, name, invite_code, created_by, created_at)`,
  `group_settings(group_id, effective_from, step_goal, daily_stake)`, `group_members(group_id, user_id, joined_on)`,
  `daily_steps(user_id, day, steps, source, synced_at)`, `coin_ledger(id, user_id, group_id, day, amount, reason, created_at)`,
  `day_results(group_id, day, user_id, steps, step_goal, daily_stake, hit, coins_change)`, `scored_days(group_id, day, scored_at)`.
  RLS is enabled on all of them with no policies yet. Inserts, updates and deletes are revoked from `anon` and `authenticated`.

- [ ] **Step 1: Write the failing tests**

`supabase/tests/schema.test.ts`:
```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run supabase/tests/schema.test.ts`
Expected: FAIL, `relation "public.profiles" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20261010000001_schema.sql`:
```sql
-- StepPool schema: time helpers, tables, the sign-up trigger, and lockdown.
-- The app never writes tables directly; later migrations add the functions it calls.

-- Clock. The test harness replaces app_now() to control time; production uses now().
create function public.app_now() returns timestamptz
language sql stable
as $$ select now() $$;

-- Today's date in IST, the only time zone StepPool supports in v1.
create function public.app_today() returns date
language sql stable
as $$ select (public.app_now() at time zone 'Asia/Kolkata')::date $$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  invite_code text not null unique check (invite_code ~ '^[A-Z2-9]{6}$'),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null
);

create table public.group_settings (
  group_id uuid not null references public.groups (id) on delete cascade,
  effective_from date not null,
  step_goal int not null check (step_goal between 1000 and 100000),
  daily_stake int not null check (daily_stake between 1 and 1000),
  primary key (group_id, effective_from)
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_on date not null,
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

create table public.daily_steps (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  steps int not null check (steps between 0 and 100000),
  source text not null check (source in ('apple_health', 'health_connect')),
  synced_at timestamptz not null,
  primary key (user_id, day)
);

create table public.coin_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  day date,
  amount int not null check (amount <> 0),
  reason text not null check (reason in ('welcome', 'won', 'lost', 'top_up')),
  created_at timestamptz not null default now()
);
create index coin_ledger_user_idx on public.coin_ledger (user_id);

create table public.day_results (
  group_id uuid not null references public.groups (id) on delete cascade,
  day date not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  steps int not null,
  step_goal int not null,
  daily_stake int not null,
  hit boolean not null,
  coins_change int not null,
  primary key (group_id, day, user_id)
);

create table public.scored_days (
  group_id uuid not null references public.groups (id) on delete cascade,
  day date not null,
  scored_at timestamptz not null,
  primary key (group_id, day)
);

-- Sign-up: every new auth user gets a profile and 1,000 welcome coins.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Player'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  insert into public.coin_ledger (user_id, amount, reason, created_at)
  values (new.id, 1000, 'welcome', public.app_now());
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lockdown: reads are opened table by table with RLS policies (a later
-- migration); writes only ever happen inside security-definer functions.
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_settings enable row level security;
alter table public.group_members enable row level security;
alter table public.daily_steps enable row level security;
alter table public.coin_ledger enable row level security;
alter table public.day_results enable row level security;
alter table public.scored_days enable row level security;

revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run supabase/tests`
Expected: all tests in `harness.test.ts` and `schema.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "Add schema, sign-up trigger and write lockdown

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Group functions

**Files:**
- Create: `supabase/migrations/20261010000002_groups.sql`
- Test: `supabase/tests/groups.test.ts`

**Interfaces:**
- Consumes: the Task 2 tables, `app_now()`, `app_today()`.
- Produces (callable by `authenticated` only):
  - `create_group(p_name text, p_step_goal int, p_daily_stake int) returns public.groups`
  - `join_group(p_invite_code text) returns public.groups`
  - `update_group_settings(p_group_id uuid, p_step_goal int, p_daily_stake int) returns public.group_settings`
  - `leave_group(p_group_id uuid) returns void`
- Internal helpers (not callable by clients): `generate_invite_code() returns text`, `assert_valid_settings(int, int) returns void`, `require_user() returns uuid`.
- Errors: `42501` "Not signed in" / "You are not a member of this group". `22023` validation ("Group name must be…", "Step goal must be…", "Daily stake must be…"). `P0002` "No group with that invite code".

- [ ] **Step 1: Write the failing tests**

`supabase/tests/groups.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, ist, type TestDb } from './db';

let db: TestDb;
let asha: string;
beforeEach(async () => {
  db = await createTestDb();
  await db.setNow(ist('2026-10-10'));
  asha = await db.createUser({ name: 'Asha' });
});

async function createGroup(userId: string, name = 'Walk Squad', goal = 10000, stake = 30) {
  const [group] = await db.as(userId, () =>
    db.sql<{ id: string; name: string; invite_code: string }>(
      'select id, name, invite_code from public.create_group($1, $2, $3)', [name, goal, stake]));
  return group;
}

const settingsOf = (groupId: string) =>
  db.sql<{ effective_from: string; step_goal: number; daily_stake: number }>(
    `select effective_from::text as effective_from, step_goal, daily_stake
     from public.group_settings where group_id = $1 order by effective_from`, [groupId]);

const membersOf = (groupId: string) =>
  db.sql<{ user_id: string; joined_on: string }>(
    `select user_id, joined_on::text as joined_on from public.group_members
     where group_id = $1 order by joined_on, user_id`, [groupId]);

describe('create_group', () => {
  it('makes the creator a member today and sets the goal and stake from today', async () => {
    const group = await createGroup(asha, '  Walk Squad ');
    expect(group.name).toBe('Walk Squad');
    expect(group.invite_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(await membersOf(group.id)).toEqual([{ user_id: asha, joined_on: '2026-10-10' }]);
    expect(await settingsOf(group.id)).toEqual([
      { effective_from: '2026-10-10', step_goal: 10000, daily_stake: 30 },
    ]);
  });

  it.each<[string, number, number, RegExp]>([
    ['', 10000, 30, /Group name must be 1 to 40 characters/],
    ['A'.repeat(41), 10000, 30, /Group name must be 1 to 40 characters/],
    ['Squad', 999, 30, /Step goal must be between 1,000 and 100,000/],
    ['Squad', 100001, 30, /Step goal must be between 1,000 and 100,000/],
    ['Squad', 10000, 0, /Daily stake must be between 1 and 1,000/],
    ['Squad', 10000, 1001, /Daily stake must be between 1 and 1,000/],
  ])('rejects name=%j goal=%i stake=%i', async (name, goal, stake, error) => {
    await expect(createGroup(asha, name, goal, stake)).rejects.toThrow(error);
  });

  it('refuses signed-out callers', async () => {
    await expect(db.as(null, () =>
      db.sql(`select * from public.create_group('Squad', 10000, 30)`),
    )).rejects.toThrow(/permission denied/);
  });
});

describe('join_group', () => {
  it('accepts a code typed in lowercase with spaces and joins from today', async () => {
    const group = await createGroup(asha);
    const ben = await db.createUser({ name: 'Ben' });
    await db.setNow(ist('2026-10-11'));
    const sloppy = ` ${group.invite_code.slice(0, 3).toLowerCase()} ${group.invite_code.slice(3).toLowerCase()} `;
    const [joined] = await db.as(ben, () =>
      db.sql<{ id: string }>('select id from public.join_group($1)', [sloppy]));
    expect(joined.id).toBe(group.id);
    expect(await membersOf(group.id)).toEqual([
      { user_id: asha, joined_on: '2026-10-10' },
      { user_id: ben, joined_on: '2026-10-11' },
    ]);
  });

  it('rejects an unknown code', async () => {
    await expect(db.as(asha, () =>
      db.sql(`select * from public.join_group('ZZZZZZ')`),
    )).rejects.toThrow(/No group with that invite code/);
  });

  it('keeps the original join date when joining twice', async () => {
    const group = await createGroup(asha);
    const ben = await db.createUser({ name: 'Ben' });
    await db.setNow(ist('2026-10-11'));
    await db.as(ben, () => db.sql('select public.join_group($1)', [group.invite_code]));
    await db.setNow(ist('2026-10-12'));
    await db.as(ben, () => db.sql('select public.join_group($1)', [group.invite_code]));
    const benRow = (await membersOf(group.id)).find((m) => m.user_id === ben);
    expect(benRow?.joined_on).toBe('2026-10-11');
  });
});

describe('update_group_settings', () => {
  it('applies from tomorrow, the last change of the day wins, and today is untouched', async () => {
    const group = await createGroup(asha);
    await db.as(asha, () => db.sql('select public.update_group_settings($1, 8000, 60)', [group.id]));
    await db.as(asha, () => db.sql('select public.update_group_settings($1, 12000, 90)', [group.id]));
    expect(await settingsOf(group.id)).toEqual([
      { effective_from: '2026-10-10', step_goal: 10000, daily_stake: 30 },
      { effective_from: '2026-10-11', step_goal: 12000, daily_stake: 90 },
    ]);
  });

  it('refuses non-members', async () => {
    const group = await createGroup(asha);
    const stranger = await db.createUser({ name: 'Stranger' });
    await expect(db.as(stranger, () =>
      db.sql('select public.update_group_settings($1, 8000, 60)', [group.id]),
    )).rejects.toThrow(/You are not a member of this group/);
  });

  it('validates the new values', async () => {
    const group = await createGroup(asha);
    await expect(db.as(asha, () =>
      db.sql('select public.update_group_settings($1, 500, 60)', [group.id]),
    )).rejects.toThrow(/Step goal must be between 1,000 and 100,000/);
  });
});

describe('leave_group', () => {
  it('removes the caller from the group', async () => {
    const group = await createGroup(asha);
    const ben = await db.createUser({ name: 'Ben' });
    await db.as(ben, () => db.sql('select public.join_group($1)', [group.invite_code]));
    await db.as(ben, () => db.sql('select public.leave_group($1)', [group.id]));
    expect(await membersOf(group.id)).toEqual([{ user_id: asha, joined_on: '2026-10-10' }]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run supabase/tests/groups.test.ts`
Expected: FAIL, `function public.create_group(...) does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20261010000002_groups.sql`:
```sql
-- Groups: create, join by invite code, change goal/stake (from tomorrow), leave.

-- The signed-in caller's id, or an error if signed out.
create function public.require_user() returns uuid
language plpgsql stable
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  return v_user;
end;
$$;

create function public.assert_valid_settings(p_step_goal int, p_daily_stake int) returns void
language plpgsql immutable
as $$
begin
  if p_step_goal is null or p_step_goal < 1000 or p_step_goal > 100000 then
    raise exception 'Step goal must be between 1,000 and 100,000' using errcode = '22023';
  end if;
  if p_daily_stake is null or p_daily_stake < 1 or p_daily_stake > 1000 then
    raise exception 'Daily stake must be between 1 and 1,000 coins' using errcode = '22023';
  end if;
end;
$$;

-- Six characters without look-alikes (no I, O, 0, 1).
create function public.generate_invite_code() returns text
language plpgsql volatile set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.groups where invite_code = code);
  end loop;
  return code;
end;
$$;

create function public.create_group(p_name text, p_step_goal int, p_daily_stake int)
returns public.groups
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_name text := trim(coalesce(p_name, ''));
  v_group public.groups;
begin
  if char_length(v_name) not between 1 and 40 then
    raise exception 'Group name must be 1 to 40 characters' using errcode = '22023';
  end if;
  perform public.assert_valid_settings(p_step_goal, p_daily_stake);

  insert into public.groups (name, invite_code, created_by, created_at)
  values (v_name, public.generate_invite_code(), v_user, public.app_now())
  returning * into v_group;

  insert into public.group_settings (group_id, effective_from, step_goal, daily_stake)
  values (v_group.id, public.app_today(), p_step_goal, p_daily_stake);

  insert into public.group_members (group_id, user_id, joined_on)
  values (v_group.id, v_user, public.app_today());

  return v_group;
end;
$$;

create function public.join_group(p_invite_code text)
returns public.groups
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_group public.groups;
begin
  select * into v_group
  from public.groups
  where invite_code = upper(regexp_replace(coalesce(p_invite_code, ''), '\s', '', 'g'));
  if not found then
    raise exception 'No group with that invite code' using errcode = 'P0002';
  end if;

  insert into public.group_members (group_id, user_id, joined_on)
  values (v_group.id, v_user, public.app_today())
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

-- Changes always start tomorrow, so nobody can change today's rules after seeing the steps.
create function public.update_group_settings(p_group_id uuid, p_step_goal int, p_daily_stake int)
returns public.group_settings
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_row public.group_settings;
begin
  if not exists (
    select 1 from public.group_members where group_id = p_group_id and user_id = v_user
  ) then
    raise exception 'You are not a member of this group' using errcode = '42501';
  end if;
  perform public.assert_valid_settings(p_step_goal, p_daily_stake);

  insert into public.group_settings (group_id, effective_from, step_goal, daily_stake)
  values (p_group_id, public.app_today() + 1, p_step_goal, p_daily_stake)
  on conflict (group_id, effective_from) do update
    set step_goal = excluded.step_goal, daily_stake = excluded.daily_stake
  returning * into v_row;

  return v_row;
end;
$$;

create function public.leave_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
begin
  delete from public.group_members where group_id = p_group_id and user_id = v_user;
end;
$$;

revoke execute on function public.require_user() from public, anon, authenticated;
revoke execute on function public.assert_valid_settings(int, int) from public, anon, authenticated;
revoke execute on function public.generate_invite_code() from public, anon, authenticated;

revoke execute on function public.create_group(text, int, int) from public, anon;
revoke execute on function public.join_group(text) from public, anon;
revoke execute on function public.update_group_settings(uuid, int, int) from public, anon;
revoke execute on function public.leave_group(uuid) from public, anon;
grant execute on function public.create_group(text, int, int) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.update_group_settings(uuid, int, int) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run supabase/tests`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "Add group functions: create, join, settings from tomorrow, leave

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Step uploads

**Files:**
- Create: `supabase/migrations/20261010000003_steps.sql`
- Test: `supabase/tests/steps.test.ts`

**Interfaces:**
- Consumes: `require_user()` (Task 3), `daily_steps`, `app_now()`, `app_today()`.
- Produces: `upload_steps(p_day date, p_steps int, p_source text) returns public.daily_steps`, callable by `authenticated` only.
  It upserts the caller's row for today. Errors: `22023` "Steps can only be uploaded for today (YYYY-MM-DD)", "Steps must be between 0 and 100000", "Unknown step source: x".

- [ ] **Step 1: Write the failing tests**

`supabase/tests/steps.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, ist, type TestDb } from './db';

let db: TestDb;
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run supabase/tests/steps.test.ts`
Expected: FAIL, `function public.upload_steps(...) does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20261010000003_steps.sql`:
```sql
-- Step uploads: a person can only set their own total, and only for today (IST).
-- At 12:00 AM IST yesterday closes for good.

create function public.upload_steps(p_day date, p_steps int, p_source text)
returns public.daily_steps
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_row public.daily_steps;
begin
  if p_day is distinct from public.app_today() then
    raise exception 'Steps can only be uploaded for today (%)', public.app_today()
      using errcode = '22023';
  end if;
  if p_steps is null or p_steps < 0 or p_steps > 100000 then
    raise exception 'Steps must be between 0 and 100000' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('apple_health', 'health_connect') then
    raise exception 'Unknown step source: %', p_source using errcode = '22023';
  end if;

  insert into public.daily_steps (user_id, day, steps, source, synced_at)
  values (v_user, p_day, p_steps, p_source, public.app_now())
  on conflict (user_id, day) do update
    set steps = excluded.steps, source = excluded.source, synced_at = excluded.synced_at
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.upload_steps(date, int, text) from public, anon;
grant execute on function public.upload_steps(date, int, text) to authenticated;
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run supabase/tests`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "Add upload_steps with the midnight IST cutoff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Scoring job

**Files:**
- Create: `supabase/migrations/20261010000004_scoring.sql`
- Create: `supabase/tests/helpers.ts`
- Test: `supabase/tests/scoring.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces (server only, **not** callable by `anon`/`authenticated`):
  - `score_pending_days() returns int`: scores every unscored (group, day) before today, in order (day, then group `created_at`, then group id), and returns how many it processed.
  - `score_group_day(p_group_id uuid, p_day date) returns void`
  - `group_day_participants(p_group_id uuid, p_day date, p_goal int) returns table (user_id uuid, steps int, hit boolean)`
  - `balance_of(p_user_id uuid) returns int`
- Produces (tests): `helpers(db)` → `{ users(...names): Promise<string[]>, newGroup(ownerId, memberIds, { goal?, stake? }?): Promise<{ groupId, inviteCode }>, join(userId, inviteCode), walk(userId, day, steps), scoreAt(iso): Promise<number>, balance(userId): Promise<number>, changes(groupId, day): Promise<Record<string, number>> }`.

- [ ] **Step 1: Write the test helpers**

`supabase/tests/helpers.ts`:
```ts
import { ist, type TestDb } from './db';

/** Higher-level actions shared by the scoring and security tests. */
export function helpers(db: TestDb) {
  async function users(...names: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const name of names) ids.push(await db.createUser({ name }));
    return ids;
  }

  async function join(userId: string, inviteCode: string): Promise<void> {
    await db.as(userId, () => db.sql('select public.join_group($1)', [inviteCode]));
  }

  /** Creates a group as ownerId and joins memberIds, all at the current test time. */
  async function newGroup(
    ownerId: string,
    memberIds: string[],
    { goal = 10000, stake = 30 }: { goal?: number; stake?: number } = {},
  ): Promise<{ groupId: string; inviteCode: string }> {
    const [group] = await db.as(ownerId, () =>
      db.sql<{ id: string; invite_code: string }>(
        'select id, invite_code from public.create_group($1, $2, $3)', ['Walkers', goal, stake]));
    for (const id of memberIds) await join(id, group.invite_code);
    return { groupId: group.id, inviteCode: group.invite_code };
  }

  /** Uploads a step total for `day`, syncing at 9 PM IST that day. Moves the clock. */
  async function walk(userId: string, day: string, steps: number): Promise<void> {
    await db.setNow(ist(day, '21:00'));
    await db.as(userId, () =>
      db.sql(`select public.upload_steps($1::date, $2, 'health_connect')`, [day, steps]));
  }

  /** Runs the scoring job as pg_cron would, at time `when`. Returns group-days processed. */
  async function scoreAt(when: string): Promise<number> {
    await db.setNow(when);
    const [row] = await db.sql<{ n: number }>('select public.score_pending_days() as n');
    return row.n;
  }

  async function balance(userId: string): Promise<number> {
    const [row] = await db.sql<{ b: number }>(
      'select coalesce(sum(amount), 0)::int as b from public.coin_ledger where user_id = $1', [userId]);
    return row.b;
  }

  /** coins_change per participant for one group-day, e.g. { [userId]: -30 }. */
  async function changes(groupId: string, day: string): Promise<Record<string, number>> {
    const rows = await db.sql<{ user_id: string; coins_change: number }>(
      'select user_id, coins_change from public.day_results where group_id = $1 and day = $2::date',
      [groupId, day]);
    return Object.fromEntries(rows.map((r) => [r.user_id, r.coins_change]));
  }

  return { users, join, newGroup, walk, scoreAt, balance, changes };
}
```

- [ ] **Step 2: Write the failing tests**

`supabase/tests/scoring.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, ist, type TestDb } from './db';
import { helpers } from './helpers';

const CREATED = '2026-10-10';
const D1 = '2026-10-11';
const D2 = '2026-10-12';
const D3 = '2026-10-13';

let db: TestDb;
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
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run supabase/tests/scoring.test.ts`
Expected: FAIL, `function public.score_pending_days() does not exist`.

- [ ] **Step 4: Write the migration**

`supabase/migrations/20261010000004_scoring.sql`:
```sql
-- Scoring: at 12:00 AM IST (and hourly as catch-up) every unscored day before
-- today is settled. Rules (spec §3): losers lose min(stake, balance); winners
-- split the pot equally in whole coins and any remainder disappears; with no
-- winners or no losers nothing moves; an empty wallet is topped up to 200.

create function public.balance_of(p_user_id uuid) returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(amount), 0)::int from public.coin_ledger where user_id = p_user_id
$$;

-- Who plays on p_day: current members who joined before that day.
create function public.group_day_participants(p_group_id uuid, p_day date, p_goal int)
returns table (user_id uuid, steps int, hit boolean)
language sql stable security definer set search_path = public
as $$
  select m.user_id,
         coalesce(s.steps, 0) as steps,
         coalesce(s.steps, 0) >= p_goal as hit
  from public.group_members m
  left join public.daily_steps s on s.user_id = m.user_id and s.day = p_day
  where m.group_id = p_group_id and m.joined_on < p_day
  order by m.user_id
$$;

create function public.score_group_day(p_group_id uuid, p_day date) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_goal int;
  v_stake int;
  v_participants int;
  v_winners int;
  v_pot int := 0;
  v_share int;
  v_loss int;
  p record;
begin
  -- Claim the day first; a day that is already scored is never touched again.
  insert into public.scored_days (group_id, day, scored_at)
  values (p_group_id, p_day, public.app_now())
  on conflict do nothing;
  if not found then
    return;
  end if;

  select gs.step_goal, gs.daily_stake into v_goal, v_stake
  from public.group_settings gs
  where gs.group_id = p_group_id and gs.effective_from <= p_day
  order by gs.effective_from desc
  limit 1;
  if v_goal is null then
    return;
  end if;

  select count(*), count(*) filter (where gp.hit)
  into v_participants, v_winners
  from public.group_day_participants(p_group_id, p_day, v_goal) gp;
  if v_participants = 0 then
    return;
  end if;

  -- Nobody to pay out to, or nobody who lost: record the day, move nothing.
  if v_winners = 0 or v_winners = v_participants then
    insert into public.day_results (group_id, day, user_id, steps, step_goal, daily_stake, hit, coins_change)
    select p_group_id, p_day, gp.user_id, gp.steps, v_goal, v_stake, gp.hit, 0
    from public.group_day_participants(p_group_id, p_day, v_goal) gp;
    return;
  end if;

  for p in
    select * from public.group_day_participants(p_group_id, p_day, v_goal) gp where not gp.hit
  loop
    v_loss := least(v_stake, public.balance_of(p.user_id));
    if v_loss > 0 then
      insert into public.coin_ledger (user_id, group_id, day, amount, reason, created_at)
      values (p.user_id, p_group_id, p_day, -v_loss, 'lost', public.app_now());
    end if;
    v_pot := v_pot + v_loss;
    insert into public.day_results (group_id, day, user_id, steps, step_goal, daily_stake, hit, coins_change)
    values (p_group_id, p_day, p.user_id, p.steps, v_goal, v_stake, false, -v_loss);
  end loop;

  v_share := v_pot / v_winners; -- integer division: the remainder disappears
  for p in
    select * from public.group_day_participants(p_group_id, p_day, v_goal) gp where gp.hit
  loop
    if v_share > 0 then
      insert into public.coin_ledger (user_id, group_id, day, amount, reason, created_at)
      values (p.user_id, p_group_id, p_day, v_share, 'won', public.app_now());
    end if;
    insert into public.day_results (group_id, day, user_id, steps, step_goal, daily_stake, hit, coins_change)
    values (p_group_id, p_day, p.user_id, p.steps, v_goal, v_stake, true, v_share);
  end loop;

  insert into public.coin_ledger (user_id, group_id, day, amount, reason, created_at)
  select gp.user_id, p_group_id, p_day, 200, 'top_up', public.app_now()
  from public.group_day_participants(p_group_id, p_day, v_goal) gp
  where public.balance_of(gp.user_id) <= 0;
end;
$$;

create function public.score_pending_days() returns int
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select g.id as group_id, d::date as day
    from public.groups g
    cross join lateral generate_series(
      (g.created_at at time zone 'Asia/Kolkata')::date::timestamp,
      (public.app_today() - 1)::timestamp,
      interval '1 day'
    ) as d
    where not exists (
      select 1 from public.scored_days sd where sd.group_id = g.id and sd.day = d::date
    )
    order by d, g.created_at, g.id
  loop
    perform public.score_group_day(r.group_id, r.day);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.balance_of(uuid) from public, anon, authenticated;
revoke execute on function public.group_day_participants(uuid, date, int) from public, anon, authenticated;
revoke execute on function public.score_group_day(uuid, date) from public, anon, authenticated;
revoke execute on function public.score_pending_days() from public, anon, authenticated;
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run supabase/tests`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase
git commit -m "Add the scoring job with catch-up and idempotent day locks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Read access (RLS policies and balances view)

**Files:**
- Create: `supabase/migrations/20261010000005_read_access.sql`
- Test: `supabase/tests/read_access.test.ts`

**Interfaces:**
- Consumes: all tables, plus `helpers(db)` (Task 5).
- Produces:
  - Policy helpers `is_group_member(p_group_id uuid) returns boolean` and `shares_group_with(p_user_id uuid) returns boolean`, executable by `authenticated`.
  - Select policies on `groups`, `group_settings`, `group_members`, `day_results` (members), and on `profiles`, `daily_steps`, `coin_ledger` (the person or people they share a group with).
  - View `public.balances(user_id uuid, balance int)` with `security_invoker`.
  - `anon` has no table privileges at all.

- [ ] **Step 1: Write the failing tests**

`supabase/tests/read_access.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run supabase/tests/read_access.test.ts`
Expected: FAIL. Members get empty results (RLS has no policies yet), and the `balances` relation does not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20261010000005_read_access.sql`:
```sql
-- Read access: members see their groups and the people in them. Nothing else.
-- Signed-out visitors (anon) can read nothing.

create function public.is_group_member(p_group_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = auth.uid()
  )
$$;

create function public.shares_group_with(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select p_user_id = auth.uid() or exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user_id
  )
$$;

revoke execute on function public.is_group_member(uuid) from public, anon;
revoke execute on function public.shares_group_with(uuid) from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.shares_group_with(uuid) to authenticated;

create policy "members read their groups" on public.groups
  for select to authenticated using (public.is_group_member(id));
create policy "members read group settings" on public.group_settings
  for select to authenticated using (public.is_group_member(group_id));
create policy "members read group members" on public.group_members
  for select to authenticated using (public.is_group_member(group_id));
create policy "members read day results" on public.day_results
  for select to authenticated using (public.is_group_member(group_id));
create policy "read profiles of people you share a group with" on public.profiles
  for select to authenticated using (public.shares_group_with(id));
create policy "read steps of people you share a group with" on public.daily_steps
  for select to authenticated using (public.shares_group_with(user_id));
create policy "read coins of people you share a group with" on public.coin_ledger
  for select to authenticated using (public.shares_group_with(user_id));

-- Coin balance per person, visible wherever their ledger rows are visible.
create view public.balances with (security_invoker = true) as
  select user_id, sum(amount)::int as balance
  from public.coin_ledger
  group by user_id;

revoke insert, update, delete, truncate on public.balances from authenticated;
grant select on public.balances to authenticated;

revoke all on all tables in schema public from anon;
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run supabase/tests`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase
git commit -m "Add read policies and the balances view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Cron schedule, Supabase CLI config and README

**Files:**
- Create: `supabase/migrations/20261010000006_cron.sql`, `supabase/config.toml` (from `supabase init`), `README.md`

**Interfaces:**
- Consumes: `score_pending_days()` (Task 5).
- Produces: a pg_cron job `score-pending-days` running `select public.score_pending_days()` at minute 30 of every hour UTC, which is every hour on the hour in IST (first run 12:00 AM IST). This migration is applied on Supabase only. The test harness skips `*_cron.sql`.

- [ ] **Step 1: Write the cron migration**

`supabase/migrations/20261010000006_cron.sql`:
```sql
-- Supabase only: the local test harness has no pg_cron and skips *_cron.sql.
-- pg_cron uses UTC. Minute 30 of every UTC hour is minute 0 of every IST hour,
-- so the first run each day is 12:00 AM IST and the rest are catch-up runs.
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'score-pending-days',
  '30 * * * *',
  'select public.score_pending_days()'
);
```

- [ ] **Step 2: Initialise the Supabase CLI config**

```bash
cd ~/Desktop/step-pool && source ~/.nvm/nvm.sh && nvm use >/dev/null
npx --yes supabase@2.120.0 init
```
Answer **N** to any IDE-settings prompt. Expected: `supabase/config.toml` is created. In `config.toml`, set `project_id = "step-pool"`.

- [ ] **Step 3: Write the README**

`README.md`:
````markdown
# StepPool

A private step challenge for one group of friends. Everyone stakes the same
number of virtual coins each day, and whoever misses the group's step goal
loses their stake to the people who hit it. Design:
`docs/superpowers/specs/2026-10-10-steppool-design.md`.

## Requirements

- Node 24 (`nvm use` picks it up from `.nvmrc`)

## Tests

```bash
nvm use
npm test          # SQL tests run the real migrations in PGlite: no Docker, no accounts
npm run typecheck
```

## Database

All backend logic is in `supabase/migrations/`:

| File | What it does |
|---|---|
| `…01_schema.sql` | Tables, IST clock helpers, sign-up trigger (+1,000 coins), write lockdown |
| `…02_groups.sql` | `create_group`, `join_group`, `update_group_settings` (from tomorrow), `leave_group` |
| `…03_steps.sql` | `upload_steps`: only for today in IST |
| `…04_scoring.sql` | `score_pending_days`: settles every unscored day before today |
| `…05_read_access.sql` | Row Level Security: members see their group and its people only |
| `…06_cron.sql` | Runs scoring every hour on the hour IST (Supabase only) |

Apply them to a Supabase project:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```
````

- [ ] **Step 4: Run the full verification**

Run: `npm test && npm run typecheck`
Expected: every test file passes (harness, schema, groups, steps, scoring, read_access). `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add cron schedule, Supabase CLI config and README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
