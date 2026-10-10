// Free Apple accounts sign builds for 7 days; remind on day 6.
const REMIND_AFTER_MS = 6 * 24 * 60 * 60 * 1000;

export function expiryReminderDate(buildTimeIso: string): Date | null {
  const built = Date.parse(buildTimeIso);
  return Number.isNaN(built) ? null : new Date(built + REMIND_AFTER_MS);
}
