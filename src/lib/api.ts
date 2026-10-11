import type { Transfer } from './preview';
import { supabase } from './supabase';
import { addDays } from './time';

export type StepSource = 'apple_health' | 'health_connect';
export type Group = { id: string; name: string; inviteCode: string };
export type Goal = { stepGoal: number };
export type MemberToday = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  steps: number;
  syncedAt: string | null;
  /** Stake in force today, or (for someone who joined today) the stake they start with tomorrow. */
  stake: number;
  /** A different stake starting tomorrow, if they changed it. */
  stakeTomorrow: number | null;
  /** Running total in this group: coins won minus coins lost. */
  total: number;
  playsToday: boolean;
  leavingAfterToday: boolean;
};
export type GroupToday = { group: Group; today: Goal; tomorrow: Goal | null; members: MemberToday[] };
export type HistoryRow = {
  day: string;
  userId: string;
  name: string;
  steps: number;
  hit: boolean;
  stake: number;
  coinsChange: number;
  stepGoal: number;
};
export type DayTransfer = Transfer & { day: string };

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

const toGroup = (g: { id: string; name: string; invite_code: string }): Group =>
  ({ id: g.id, name: g.name, inviteCode: g.invite_code });

export async function getMyGroups(): Promise<Group[]> {
  const rows = unwrap(await supabase.from('groups').select('id, name, invite_code').order('created_at'));
  return rows.map(toGroup);
}

/** My overall total across all my groups. */
export async function getMyTotal(userId: string): Promise<number> {
  const rows = unwrap(await supabase.from('group_totals').select('total').eq('user_id', userId));
  return rows.reduce((sum, r) => sum + (r.total ?? 0), 0);
}

export async function getGroupToday(groupId: string, today: string): Promise<GroupToday> {
  const tomorrow = addDays(today, 1);
  const [groupRes, goalsRes, membersRes, stakesRes, totalsRes] = await Promise.all([
    supabase.from('groups').select('id, name, invite_code').eq('id', groupId).single(),
    supabase
      .from('group_settings')
      .select('effective_from, step_goal')
      .eq('group_id', groupId)
      .lte('effective_from', tomorrow)
      .order('effective_from', { ascending: false })
      .limit(2),
    supabase
      .from('group_members')
      .select('user_id, joined_on, left_on, profiles(display_name, avatar_url)')
      .eq('group_id', groupId),
    supabase
      .from('member_stakes')
      .select('user_id, effective_from, stake')
      .eq('group_id', groupId)
      .lte('effective_from', tomorrow)
      .order('effective_from', { ascending: false }),
    supabase.from('group_totals').select('user_id, total').eq('group_id', groupId),
  ]);
  const group = unwrap(groupRes);
  const goals = unwrap(goalsRes);
  const stakes = unwrap(stakesRes);
  const totals = new Map(unwrap(totalsRes).map((t) => [t.user_id, t.total ?? 0]));
  const members = unwrap(membersRes).filter((m) => m.left_on === null || m.left_on > today);
  const ids = members.map((m) => m.user_id);
  const steps = new Map(
    unwrap(await supabase.from('daily_steps').select('user_id, steps, synced_at').eq('day', today).in('user_id', ids))
      .map((s) => [s.user_id, s]),
  );

  const current = goals.find((g) => g.effective_from <= today);
  const pending = goals.find((g) => g.effective_from === tomorrow);
  if (!current) throw new Error('This group has no goal for today');

  // Rows are newest first, so the first match is the one in force.
  const stakeOn = (userId: string, day: string) =>
    stakes.find((s) => s.user_id === userId && s.effective_from <= day)?.stake ?? null;

  return {
    group: toGroup(group),
    today: { stepGoal: current.step_goal },
    tomorrow: pending ? { stepGoal: pending.step_goal } : null,
    members: members
      .map((m) => {
        const stakeToday = stakeOn(m.user_id, today);
        const stakeTomorrow = stakeOn(m.user_id, tomorrow);
        return {
          userId: m.user_id,
          name: m.profiles?.display_name ?? 'Player',
          avatarUrl: m.profiles?.avatar_url ?? null,
          steps: steps.get(m.user_id)?.steps ?? 0,
          syncedAt: steps.get(m.user_id)?.synced_at ?? null,
          stake: stakeToday ?? stakeTomorrow ?? 0,
          stakeTomorrow: stakeToday !== null && stakeTomorrow !== stakeToday ? stakeTomorrow : null,
          total: totals.get(m.user_id) ?? 0,
          playsToday: m.joined_on < today && stakeToday !== null,
          leavingAfterToday: m.left_on !== null,
        };
      })
      .sort((a, b) => b.steps - a.steps),
  };
}

export async function getHistory(groupId: string): Promise<{ results: HistoryRow[]; transfers: DayTransfer[] }> {
  const [resultsRes, transfersRes] = await Promise.all([
    supabase
      .from('day_results')
      .select('day, user_id, steps, hit, stake, coins_change, step_goal, profiles(display_name)')
      .eq('group_id', groupId)
      .order('day', { ascending: false })
      .limit(1000),
    supabase
      .from('day_transfers')
      .select('day, from_user, to_user, amount')
      .eq('group_id', groupId)
      .order('day', { ascending: false })
      .limit(3000),
  ]);
  return {
    results: unwrap(resultsRes).map((r) => ({
      day: r.day,
      userId: r.user_id,
      name: r.profiles?.display_name ?? 'Player',
      steps: r.steps,
      hit: r.hit,
      stake: r.stake,
      coinsChange: r.coins_change,
      stepGoal: r.step_goal,
    })),
    transfers: unwrap(transfersRes).map((t) => ({ day: t.day, from: t.from_user, to: t.to_user, amount: t.amount })),
  };
}

export async function createGroup(name: string, stepGoal: number, stake: number): Promise<Group> {
  return toGroup(unwrap(await supabase.rpc('create_group', { p_name: name, p_step_goal: stepGoal, p_stake: stake })));
}

export async function joinGroup(code: string, stake: number): Promise<Group> {
  return toGroup(unwrap(await supabase.rpc('join_group', { p_invite_code: code, p_stake: stake })));
}

export async function updateGroupGoal(groupId: string, stepGoal: number): Promise<void> {
  unwrap(await supabase.rpc('update_group_settings', { p_group_id: groupId, p_step_goal: stepGoal }));
}

export async function setMyStake(groupId: string, stake: number): Promise<void> {
  unwrap(await supabase.rpc('set_my_stake', { p_group_id: groupId, p_stake: stake }));
}

export async function leaveGroup(groupId: string): Promise<void> {
  unwrap(await supabase.rpc('leave_group', { p_group_id: groupId }));
}

export async function uploadSteps(day: string, steps: number, source: StepSource): Promise<void> {
  unwrap(await supabase.rpc('upload_steps', { p_day: day, p_steps: steps, p_source: source }));
}
