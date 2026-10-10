import { describe, expect, it } from 'vitest';
import { formatAgo, formatCoins, formatCountdown, formatDay } from './format';

describe('format', () => {
  it.each<[number, string]>([
    [3 * 3600_000 + 5 * 60_000, '3h 5m'],
    [45 * 60_000, '45m'],
    [59_000, 'under a minute'],
  ])('formatCountdown(%i) = %s', (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });

  it('formatAgo says how long since a sync', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    expect(formatAgo('2026-10-11T11:59:30Z', now)).toBe('just now');
    expect(formatAgo('2026-10-11T11:48:00Z', now)).toBe('12 min ago');
    expect(formatAgo('2026-10-11T09:00:00Z', now)).toBe('3 h ago');
  });

  it('formatDay shows weekday, day and month', () => {
    expect(formatDay('2026-10-11')).toBe('Sun 11 Oct');
  });

  it('formatCoins signs gains and losses', () => {
    expect(formatCoins(30)).toBe('+30');
    expect(formatCoins(-30)).toBe('−30');
    expect(formatCoins(0)).toBe('0');
  });
});
