import { describe, expect, it } from 'vitest';
import { memberDay } from './member-day';

const TODAY = '2026-10-12';

describe('memberDay (mirrors the server participant rule)', () => {
  it('a regular member plays today with today’s stake', () => {
    expect(memberDay('2026-10-10', TODAY, 30, 30)).toEqual({ playsToday: true, stake: 30, stakeTomorrow: null });
  });

  it('shows a stake change that starts tomorrow', () => {
    expect(memberDay('2026-10-10', TODAY, 30, 90)).toEqual({ playsToday: true, stake: 30, stakeTomorrow: 90 });
  });

  it('someone who joined today plays from tomorrow with the stake they picked', () => {
    expect(memberDay(TODAY, TODAY, null, 50)).toEqual({ playsToday: false, stake: 50, stakeTomorrow: null });
  });

  it('someone who re-joined today is shown their new stake, not the old one still on file', () => {
    expect(memberDay(TODAY, TODAY, 30, 200)).toEqual({ playsToday: false, stake: 200, stakeTomorrow: null });
  });
});
