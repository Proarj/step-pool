import { istDayBounds, istToday } from './time';

export type SyncResult = { day: string; steps: number };
export type SyncDeps = {
  now(): Date;
  readSteps(start: Date, end: Date): Promise<number>;
  upload(day: string, steps: number): Promise<void>;
};

const MAX_STEPS = 100_000;

/** The server's rejection when a sync for a day arrives after 12:00 AM IST (spec §6). */
export function isClosedDayError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Steps can only be uploaded for today');
}

/** Reads today's (IST) step total and uploads it. If midnight passes mid-sync, uploads the new day once. */
export async function syncToday(deps: SyncDeps): Promise<SyncResult> {
  for (let attempt = 1; ; attempt++) {
    const now = deps.now();
    const day = istToday(now);
    const raw = await deps.readSteps(istDayBounds(day).start, now);
    const steps = Math.min(MAX_STEPS, Math.max(0, Math.round(raw)));
    try {
      await deps.upload(day, steps);
      return { day, steps };
    } catch (error) {
      if (attempt === 1 && isClosedDayError(error)) continue;
      throw error;
    }
  }
}
