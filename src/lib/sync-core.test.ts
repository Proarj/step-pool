import { describe, expect, it } from 'vitest';
import { isClosedDayError, syncToday, type SyncDeps } from './sync-core';

function fakes(nows: Date[], steps: number, uploadErrors: (Error | null)[] = []) {
  const reads: [Date, Date][] = [];
  const uploads: [string, number][] = [];
  let i = 0;
  let u = 0;
  const deps: SyncDeps = {
    now: () => nows[Math.min(i++, nows.length - 1)],
    readSteps: async (start, end) => { reads.push([start, end]); return steps; },
    upload: async (day, n) => {
      const error = uploadErrors[u++];
      if (error) throw error;
      uploads.push([day, n]);
    },
  };
  return { deps, reads, uploads };
}

describe('syncToday', () => {
  it("uploads today's IST total, read from 12:00 AM IST to now", async () => {
    const now = new Date('2026-10-11T15:00:00Z'); // 20:30 IST
    const { deps, reads, uploads } = fakes([now], 8421.6);
    expect(await syncToday(deps)).toEqual({ day: '2026-10-11', steps: 8422 });
    expect(reads).toEqual([[new Date('2026-10-10T18:30:00Z'), now]]);
    expect(uploads).toEqual([['2026-10-11', 8422]]);
  });

  it('moves on to the new day when midnight passes during a sync', async () => {
    const before = new Date('2026-10-11T18:29:59Z');
    const after = new Date('2026-10-11T18:30:01Z');
    const closed = new Error('Steps can only be uploaded for today (2026-10-12)');
    const { deps, uploads } = fakes([before, after], 40, [closed]);
    expect(await syncToday(deps)).toEqual({ day: '2026-10-12', steps: 40 });
    expect(uploads).toEqual([['2026-10-12', 40]]);
  });

  it('passes other errors through', async () => {
    const { deps } = fakes([new Date('2026-10-11T10:00:00Z')], 10, [new Error('Network request failed')]);
    await expect(syncToday(deps)).rejects.toThrow('Network request failed');
  });

  it('keeps steps within 0–100,000', async () => {
    const { deps, uploads } = fakes([new Date('2026-10-11T10:00:00Z')], 250000);
    await syncToday(deps);
    expect(uploads).toEqual([['2026-10-11', 100000]]);
  });

  it('recognises only the closed-day rejection', () => {
    expect(isClosedDayError(new Error('Steps can only be uploaded for today (2026-10-12)'))).toBe(true);
    expect(isClosedDayError(new Error('Steps must be between 0 and 100000'))).toBe(false);
    expect(isClosedDayError('Steps can only be uploaded for today')).toBe(false);
  });
});
