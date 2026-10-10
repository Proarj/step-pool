export type PreviewMember = { userId: string; steps: number; balance: number };

/**
 * Coins each member would gain (+) or lose (−) if the day ended now. Mirrors
 * public.score_group_day (spec §3), except the top-up, which is not a result.
 */
export function previewDay(goal: number, stake: number, members: PreviewMember[]): Record<string, number> {
  const result: Record<string, number> = Object.fromEntries(members.map((m) => [m.userId, 0]));
  const winners = members.filter((m) => m.steps >= goal);
  const losers = members.filter((m) => m.steps < goal);
  if (winners.length === 0 || losers.length === 0) return result;

  let pot = 0;
  for (const m of losers) {
    const loss = Math.max(0, Math.min(stake, m.balance));
    result[m.userId] = loss > 0 ? -loss : 0;
    pot += loss;
  }
  const share = Math.floor(pot / winners.length);
  for (const m of winners) result[m.userId] = share;
  return result;
}
