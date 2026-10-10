// StepPool runs on IST for everyone (spec §3), whatever the phone's time zone.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The IST calendar date ("YYYY-MM-DD") at instant `now`. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** When an IST calendar day starts and ends (end = the next 12:00 AM IST). */
export function istDayBounds(day: string): { start: Date; end: Date } {
  const start = new Date(Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function msUntilIstMidnight(now: Date = new Date()): number {
  return istDayBounds(istToday(now)).end.getTime() - now.getTime();
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
