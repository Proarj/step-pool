export type PreviewMember = { userId: string; steps: number; stake: number };
export type Transfer = { from: string; to: string; amount: number };

/**
 * Who would pay whom if the day ended now. Mirrors public.score_group_day
 * (spec §3): each loser pays each winner floor(loser stake × winner stake /
 * total winner stake); nothing moves with no winners or no losers.
 */
export function previewDay(goal: number, members: PreviewMember[]): { transfers: Transfer[]; change: Record<string, number> } {
  const change: Record<string, number> = Object.fromEntries(members.map((m) => [m.userId, 0]));
  const winners = members.filter((m) => m.steps >= goal);
  const losers = members.filter((m) => m.steps < goal);
  if (winners.length === 0 || losers.length === 0) return { transfers: [], change };

  const winnerStake = winners.reduce((sum, w) => sum + w.stake, 0);
  const transfers: Transfer[] = [];
  for (const loser of losers) {
    for (const winner of winners) {
      const amount = Math.floor((loser.stake * winner.stake) / winnerStake);
      if (amount <= 0) continue;
      transfers.push({ from: loser.userId, to: winner.userId, amount });
      change[loser.userId] -= amount;
      change[winner.userId] += amount;
    }
  }
  return { transfers, change };
}
