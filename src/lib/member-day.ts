export type MemberDay = {
  playsToday: boolean;
  /** The stake that counts: today's if they play today, otherwise the one they start with tomorrow. */
  stake: number;
  /** A different stake starting tomorrow (only for someone playing today). */
  stakeTomorrow: number | null;
};

/**
 * How a member stands today. Mirrors the server's participant rule: they play
 * on a day if they joined before it and have a stake in force that day.
 */
export function memberDay(joinedOn: string, today: string, stakeToday: number | null, stakeTomorrow: number | null): MemberDay {
  if (joinedOn < today && stakeToday !== null) {
    return { playsToday: true, stake: stakeToday, stakeTomorrow: stakeTomorrow !== stakeToday ? stakeTomorrow : null };
  }
  return { playsToday: false, stake: stakeTomorrow ?? stakeToday ?? 0, stakeTomorrow: null };
}
