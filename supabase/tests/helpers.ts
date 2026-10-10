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
