export type DayResult = { day: string; userId: string; steps: number; hit: boolean; coinsChange: number };
export type LeaderboardRow = { userId: string; net: number; daysHit: number; daysPlayed: number; streak: number };

/** Totals per person, best net first. streak = hit days in a row, ending at their latest scored day. */
export function buildLeaderboard(results: DayResult[]): LeaderboardRow[] {
  const byUser = new Map<string, DayResult[]>();
  for (const r of results) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);

  const rows = [...byUser.entries()].map(([userId, rs]) => {
    const newestFirst = [...rs].sort((a, b) => b.day.localeCompare(a.day));
    const firstMiss = newestFirst.findIndex((r) => !r.hit);
    return {
      userId,
      net: rs.reduce((sum, r) => sum + r.coinsChange, 0),
      daysHit: rs.filter((r) => r.hit).length,
      daysPlayed: rs.length,
      streak: firstMiss === -1 ? newestFirst.length : firstMiss,
    };
  });
  return rows.sort((a, b) => b.net - a.net || b.streak - a.streak || a.userId.localeCompare(b.userId));
}

export function groupByDay<T extends { day: string }>(rows: T[]): { day: string; rows: T[] }[] {
  const days = new Map<string, T[]>();
  for (const row of rows) days.set(row.day, [...(days.get(row.day) ?? []), row]);
  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, dayRows]) => ({ day, rows: dayRows }));
}
