import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, ist, type TestDb } from './db';

let db: TestDb;
afterEach(async () => {
  await db.close();
});
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

const join = (userId: string, code: string, stake = 30) =>
  db.as(userId, () => db.sql<{ id: string }>('select id from public.join_group($1, $2)', [code, stake]));

const goalsOf = (groupId: string) =>
  db.sql<{ effective_from: string; step_goal: number }>(
    `select effective_from::text as effective_from, step_goal
     from public.group_settings where group_id = $1 order by effective_from`, [groupId]);

const stakesOf = (groupId: string, userId: string) =>
  db.sql<{ effective_from: string; stake: number }>(
    `select effective_from::text as effective_from, stake from public.member_stakes
     where group_id = $1 and user_id = $2 order by effective_from`, [groupId, userId]);

const membersOf = (groupId: string) =>
  db.sql<{ user_id: string; joined_on: string }>(
    `select user_id, joined_on::text as joined_on from public.group_members
     where group_id = $1 order by joined_on, user_id`, [groupId]);

describe('create_group', () => {
  it('makes the creator a member today, sets the goal from today and their stake from tomorrow', async () => {
    const group = await createGroup(asha, '  Walk Squad ', 10000, 50);
    expect(group.name).toBe('Walk Squad');
    expect(group.invite_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(await membersOf(group.id)).toEqual([{ user_id: asha, joined_on: '2026-10-10' }]);
    expect(await goalsOf(group.id)).toEqual([{ effective_from: '2026-10-10', step_goal: 10000 }]);
    expect(await stakesOf(group.id, asha)).toEqual([{ effective_from: '2026-10-11', stake: 50 }]);
  });

  it.each<[string, number, number, RegExp]>([
    ['', 10000, 30, /Group name must be 1 to 40 characters/],
    ['A'.repeat(41), 10000, 30, /Group name must be 1 to 40 characters/],
    ['Squad', 999, 30, /Step goal must be between 1,000 and 100,000/],
    ['Squad', 100001, 30, /Step goal must be between 1,000 and 100,000/],
    ['Squad', 10000, 0, /Stake must be between 1 and 1,000 coins/],
    ['Squad', 10000, 1001, /Stake must be between 1 and 1,000 coins/],
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
  it('accepts a code typed in lowercase with spaces, joins today and stakes from tomorrow', async () => {
    const group = await createGroup(asha);
    const ben = await db.createUser({ name: 'Ben' });
    await db.setNow(ist('2026-10-11'));
    const sloppy = ` ${group.invite_code.slice(0, 3).toLowerCase()} ${group.invite_code.slice(3).toLowerCase()} `;
    const [joined] = await join(ben, sloppy, 75);
    expect(joined.id).toBe(group.id);
    expect(await membersOf(group.id)).toEqual([
      { user_id: asha, joined_on: '2026-10-10' },
      { user_id: ben, joined_on: '2026-10-11' },
    ]);
    expect(await stakesOf(group.id, ben)).toEqual([{ effective_from: '2026-10-12', stake: 75 }]);
  });

  it('rejects an unknown code and an out-of-range stake', async () => {
    await expect(join(asha, 'ZZZZZZ')).rejects.toThrow(/No group with that invite code/);
    const group = await createGroup(asha);
    const ben = await db.createUser({ name: 'Ben' });
    await expect(join(ben, group.invite_code, 0)).rejects.toThrow(/Stake must be between 1 and 1,000 coins/);
  });

  it('keeps the original join date when joining twice', async () => {
    const group = await createGroup(asha);
    const ben = await db.createUser({ name: 'Ben' });
    await db.setNow(ist('2026-10-11'));
    await join(ben, group.invite_code);
    await db.setNow(ist('2026-10-12'));
    await join(ben, group.invite_code);
    const benRow = (await membersOf(group.id)).find((m) => m.user_id === ben);
    expect(benRow?.joined_on).toBe('2026-10-11');
  });
});

describe('update_group_settings', () => {
  it('changes the goal from tomorrow, the last change of the day wins, and today is untouched', async () => {
    const group = await createGroup(asha);
    await db.as(asha, () => db.sql('select public.update_group_settings($1, 8000)', [group.id]));
    await db.as(asha, () => db.sql('select public.update_group_settings($1, 12000)', [group.id]));
    expect(await goalsOf(group.id)).toEqual([
      { effective_from: '2026-10-10', step_goal: 10000 },
      { effective_from: '2026-10-11', step_goal: 12000 },
    ]);
  });

  it('refuses non-members', async () => {
    const group = await createGroup(asha);
    const stranger = await db.createUser({ name: 'Stranger' });
    await expect(db.as(stranger, () =>
      db.sql('select public.update_group_settings($1, 8000)', [group.id]),
    )).rejects.toThrow(/You are not a member of this group/);
  });

  it('validates the goal', async () => {
    const group = await createGroup(asha);
    await expect(db.as(asha, () =>
      db.sql('select public.update_group_settings($1, 500)', [group.id]),
    )).rejects.toThrow(/Step goal must be between 1,000 and 100,000/);
  });
});

describe('set_my_stake', () => {
  it('changes only my stake, from tomorrow, and the last change of the day wins', async () => {
    const group = await createGroup(asha, 'Squad', 10000, 30);
    const ben = await db.createUser({ name: 'Ben' });
    await join(ben, group.invite_code, 40);
    await db.setNow(ist('2026-10-12'));
    await db.as(asha, () => db.sql('select public.set_my_stake($1, 80)', [group.id]));
    await db.as(asha, () => db.sql('select public.set_my_stake($1, 90)', [group.id]));
    expect(await stakesOf(group.id, asha)).toEqual([
      { effective_from: '2026-10-11', stake: 30 },
      { effective_from: '2026-10-13', stake: 90 },
    ]);
    expect(await stakesOf(group.id, ben)).toEqual([{ effective_from: '2026-10-11', stake: 40 }]);
  });

  it('refuses non-members and validates the stake', async () => {
    const group = await createGroup(asha);
    const stranger = await db.createUser({ name: 'Stranger' });
    await expect(db.as(stranger, () => db.sql('select public.set_my_stake($1, 10)', [group.id])))
      .rejects.toThrow(/You are not a member of this group/);
    await expect(db.as(asha, () => db.sql('select public.set_my_stake($1, 1001)', [group.id])))
      .rejects.toThrow(/Stake must be between 1 and 1,000 coins/);
  });
});

describe('leave_group', () => {
  const membership = async (groupId: string, userId: string) => {
    const [row] = await db.sql<{ joined_on: string; left_on: string | null }>(
      `select joined_on::text as joined_on, left_on::text as left_on
       from public.group_members where group_id = $1 and user_id = $2`, [groupId, userId]);
    return row;
  };

  async function groupWithBen() {
    const group = await createGroup(asha);
    const ben = await db.createUser({ name: 'Ben' });
    await join(ben, group.invite_code);
    return { group, ben };
  }

  it('takes effect tomorrow', async () => {
    const { group, ben } = await groupWithBen();
    await db.as(ben, () => db.sql('select public.leave_group($1)', [group.id]));
    expect(await membership(group.id, ben)).toEqual({ joined_on: '2026-10-10', left_on: '2026-10-11' });
  });

  it('is cancelled by re-joining the same day', async () => {
    const { group, ben } = await groupWithBen();
    await db.as(ben, () => db.sql('select public.leave_group($1)', [group.id]));
    await join(ben, group.invite_code);
    expect(await membership(group.id, ben)).toEqual({ joined_on: '2026-10-10', left_on: null });
  });

  it('once it has taken effect, re-joining starts again from the next day', async () => {
    const { group, ben } = await groupWithBen();
    await db.as(ben, () => db.sql('select public.leave_group($1)', [group.id]));
    await db.setNow(ist('2026-10-12'));
    await join(ben, group.invite_code);
    expect(await membership(group.id, ben)).toEqual({ joined_on: '2026-10-12', left_on: null });
  });

  it('once it has taken effect, the goal and stake can no longer be changed', async () => {
    const { group, ben } = await groupWithBen();
    await db.as(ben, () => db.sql('select public.leave_group($1)', [group.id]));
    await db.setNow(ist('2026-10-11'));
    await expect(db.as(ben, () => db.sql('select public.update_group_settings($1, 8000)', [group.id])))
      .rejects.toThrow(/You are not a member of this group/);
    await expect(db.as(ben, () => db.sql('select public.set_my_stake($1, 10)', [group.id])))
      .rejects.toThrow(/You are not a member of this group/);
  });
});
