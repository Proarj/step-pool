import { supabase } from './supabase';
import { addDays } from './time';

export type StepSource = 'apple_health' | 'health_connect';
export type Group = { id: string; name: string; inviteCode: string };
export type Settings = { stepGoal: number; dailyStake: number };
export type MemberToday = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  steps: number;
  syncedAt: string | null;
  balance: number;
  playsToday: boolean;
  leavingAfterToday: boolean;
};
export type GroupToday = { group: Group; today: Settings; tomorrow: Settings | null; members: MemberToday[] };
export type HistoryRow = {
  day: string;
  userId: string;
  name: string;
  steps: number;
  hit: boolean;
  coinsChange: number;
  stepGoal: number;
};

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

export async function getMyBalance(userId: string): Promise<number> {
  const { data, error } = await supabase.from('balances').select('balance').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.balance ?? 0;
}

export async function getGroupToday(groupId: string, today: string): Promise<GroupToday> {
  const tomorrow = addDays(today, 1);
  const [groupRes, settingsRes, membersRes] = await Promise.all([
    supabase.from('groups').select('id, name, invite_code').eq('id', groupId).single(),
    supabase
      .from('group_settings')
      .select('effective_from, step_goal, daily_stake')
      .eq('group_id', groupId)
      .lte('effective_from', tomorrow)
      .order('effective_from', { ascending: false })
      .limit(2),
    supabase
      .from('group_members')
      .select('user_id, joined_on, left_on, profiles(display_name, avatar_url)')
      .eq('group_id', groupId),
  ]);
  const group = unwrap(groupRes);
  const settings = unwrap(settingsRes);
  const members = unwrap(membersRes).filter((m) => m.left_on === null || m.left_on > today);
  const ids = members.map((m) => m.user_id);

  const [stepsRes, balancesRes] = await Promise.all([
    supabase.from('daily_steps').select('user_id, steps, synced_at').eq('day', today).in('user_id', ids),
    supabase.from('balances').select('user_id, balance').in('user_id', ids),
  ]);
  const steps = new Map(unwrap(stepsRes).map((s) => [s.user_id, s]));
  const balances = new Map(unwrap(balancesRes).map((b) => [b.user_id, b.balance ?? 0]));

  const current = settings.find((s) => s.effective_from <= today);
  const pending = settings.find((s) => s.effective_from === tomorrow);
  if (!current) throw new Error('This group has no settings for today');

  return {
    group: toGroup(group),
    today: { stepGoal: current.step_goal, dailyStake: current.daily_stake },
    tomorrow: pending ? { stepGoal: pending.step_goal, dailyStake: pending.daily_stake } : null,
    members: members
      .map((m) => ({
        userId: m.user_id,
        name: m.profiles?.display_name ?? 'Player',
        avatarUrl: m.profiles?.avatar_url ?? null,
        steps: steps.get(m.user_id)?.steps ?? 0,
        syncedAt: steps.get(m.user_id)?.synced_at ?? null,
        balance: balances.get(m.user_id) ?? 0,
        playsToday: m.joined_on < today,
        leavingAfterToday: m.left_on !== null,
      }))
      .sort((a, b) => b.steps - a.steps),
  };
}

export async function getHistory(groupId: string): Promise<HistoryRow[]> {
  const rows = unwrap(
    await supabase
      .from('day_results')
      .select('day, user_id, steps, hit, coins_change, step_goal, profiles(display_name)')
      .eq('group_id', groupId)
      .order('day', { ascending: false })
      .limit(1000),
  );
  return rows.map((r) => ({
    day: r.day,
    userId: r.user_id,
    name: r.profiles?.display_name ?? 'Player',
    steps: r.steps,
    hit: r.hit,
    coinsChange: r.coins_change,
    stepGoal: r.step_goal,
  }));
}

export async function createGroup(name: string, stepGoal: number, dailyStake: number): Promise<Group> {
  return toGroup(unwrap(await supabase.rpc('create_group', {
    p_name: name, p_step_goal: stepGoal, p_daily_stake: dailyStake,
  })));
}

export async function joinGroup(code: string): Promise<Group> {
  return toGroup(unwrap(await supabase.rpc('join_group', { p_invite_code: code })));
}

export async function updateGroupSettings(groupId: string, stepGoal: number, dailyStake: number): Promise<void> {
  unwrap(await supabase.rpc('update_group_settings', {
    p_group_id: groupId, p_step_goal: stepGoal, p_daily_stake: dailyStake,
  }));
}

export async function leaveGroup(groupId: string): Promise<void> {
  unwrap(await supabase.rpc('leave_group', { p_group_id: groupId }));
}

export async function uploadSteps(day: string, steps: number, source: StepSource): Promise<void> {
  unwrap(await supabase.rpc('upload_steps', { p_day: day, p_steps: steps, p_source: source }));
}
