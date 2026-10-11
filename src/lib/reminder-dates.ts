import { addDays, istDayBounds, istToday } from './time';

// Free Apple accounts sign builds for 7 days; remind on day 6.
const REMIND_AFTER_MS = 6 * 24 * 60 * 60 * 1000;
const BEFORE_MIDNIGHT_MS = 30 * 60 * 1000;

/** The next `days` moments of 23:30 IST, in the future, so travellers are reminded on IST time. */
export function syncReminderInstants(now: Date, days: number): Date[] {
  const today = istToday(now);
  const instants: Date[] = [];
  for (let i = 0; instants.length < days; i++) {
    const at = new Date(istDayBounds(addDays(today, i)).end.getTime() - BEFORE_MIDNIGHT_MS);
    if (at > now) instants.push(at);
  }
  return instants;
}

export function expiryReminderDate(buildTimeIso: string): Date | null {
  const built = Date.parse(buildTimeIso);
  return Number.isNaN(built) ? null : new Date(built + REMIND_AFTER_MS);
}
