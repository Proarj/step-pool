import { ist, type TestDb } from './db';

/** Higher-level actions shared by the scoring and security tests. */
export function helpers(db: TestDb) {
  async function users(...names: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const name of names) ids.push(await db.createUser({ name }));
    return ids;
  }

  async function join(userId: string, inviteCode: string, stake = 30): Promise<void> {
    await db.as(userId, () => db.sql('select public.join_group($1, $2)', [inviteCode, stake]));
  }

  /**
   * Creates a group as ownerId and joins memberIds, all at the current test time.
   * Everyone stakes `stake` unless `stakes` gives a person their own.
   */
  async function newGroup(
    ownerId: string,
    memberIds: string[],
    { goal = 10000, stake = 30, stakes = {} }: { goal?: number; stake?: number; stakes?: Record<string, number> } = {},
  ): Promise<{ groupId: string; inviteCode: string }> {
    const [group] = await db.as(ownerId, () =>
      db.sql<{ id: string; invite_code: string }>(
        'select id, invite_code from public.create_group($1, $2, $3)', ['Walkers', goal, stakes[ownerId] ?? stake]));
    for (const id of memberIds) await join(id, group.invite_code, stakes[id] ?? stake);
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

  /** A person's running total in a group (sum of their day results). */
  async function total(groupId: string, userId: string): Promise<number> {
    const [row] = await db.sql<{ t: number }>(
      'select coalesce(sum(coins_change), 0)::int as t from public.day_results where group_id = $1 and user_id = $2',
      [groupId, userId]);
    return row.t;
  }

  /** coins_change per participant for one group-day, e.g. { [userId]: -30 }. */
  async function changes(groupId: string, day: string): Promise<Record<string, number>> {
    const rows = await db.sql<{ user_id: string; coins_change: number }>(
      'select user_id, coins_change from public.day_results where group_id = $1 and day = $2::date',
      [groupId, day]);
    return Object.fromEntries(rows.map((r) => [r.user_id, r.coins_change]));
  }

  /** Payments for one group-day, keyed "from>to", e.g. { [`${cara}>${you}`]: 20 }. */
  async function transfers(groupId: string, day: string): Promise<Record<string, number>> {
    const rows = await db.sql<{ from_user: string; to_user: string; amount: number }>(
      'select from_user, to_user, amount from public.day_transfers where group_id = $1 and day = $2::date',
      [groupId, day]);
    return Object.fromEntries(rows.map((r) => [`${r.from_user}>${r.to_user}`, r.amount]));
  }

  return { users, join, newGroup, walk, scoreAt, total, changes, transfers };
}
