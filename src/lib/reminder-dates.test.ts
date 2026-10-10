import { describe, expect, it } from 'vitest';
import { expiryReminderDate } from './reminder-dates';

describe('expiryReminderDate', () => {
  it('is six days after the build, the day before a free iOS build expires', () => {
    expect(expiryReminderDate('2026-10-11T09:00:00.000Z')).toEqual(new Date('2026-10-17T09:00:00.000Z'));
  });

  it('is null for a missing or broken build time', () => {
    expect(expiryReminderDate('not a date')).toBeNull();
  });
});
