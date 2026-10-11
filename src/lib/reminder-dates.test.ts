import { describe, expect, it } from 'vitest';
import { expiryReminderDate, syncReminderInstants } from './reminder-dates';

describe('syncReminderInstants', () => {
  it('is 23:30 IST on each coming day, whatever the phone time zone', () => {
    const now = new Date('2026-10-11T12:00:00Z'); // 17:30 IST
    expect(syncReminderInstants(now, 3)).toEqual([
      new Date('2026-10-11T18:00:00Z'), // 23:30 IST on the 11th
      new Date('2026-10-12T18:00:00Z'),
      new Date('2026-10-13T18:00:00Z'),
    ]);
  });

  it('skips today once 23:30 IST has passed', () => {
    const now = new Date('2026-10-11T18:15:00Z'); // 23:45 IST
    expect(syncReminderInstants(now, 2)).toEqual([
      new Date('2026-10-12T18:00:00Z'),
      new Date('2026-10-13T18:00:00Z'),
    ]);
  });
});

describe('expiryReminderDate', () => {
  it('is six days after the build, the day before a free iOS build expires', () => {
    expect(expiryReminderDate('2026-10-11T09:00:00.000Z')).toEqual(new Date('2026-10-17T09:00:00.000Z'));
  });

  it('is null for a missing or broken build time', () => {
    expect(expiryReminderDate('not a date')).toBeNull();
  });
});
