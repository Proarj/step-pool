import { describe, expect, it } from 'vitest';
import { addDays, istDayBounds, istToday, msUntilIstMidnight } from './time';

describe('IST time', () => {
  it('istToday follows IST whatever the device time zone', () => {
    expect(istToday(new Date('2026-10-11T18:29:59Z'))).toBe('2026-10-11'); // 23:59:59 IST
    expect(istToday(new Date('2026-10-11T18:30:00Z'))).toBe('2026-10-12'); // 00:00 IST
  });

  it('istDayBounds gives the instants of IST midnight and the next one', () => {
    expect(istDayBounds('2026-10-11')).toEqual({
      start: new Date('2026-10-10T18:30:00Z'),
      end: new Date('2026-10-11T18:30:00Z'),
    });
  });

  it('msUntilIstMidnight counts down to 12:00 AM IST', () => {
    expect(msUntilIstMidnight(new Date('2026-10-11T17:30:00Z'))).toBe(60 * 60 * 1000); // 23:00 IST
  });

  it('addDays crosses month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });
});
