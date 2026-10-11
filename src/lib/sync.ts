import { health } from '@/health/health';
import { uploadSteps } from './api';
import { syncToday, type SyncResult } from './sync-core';

/** Reads today's steps from the phone and uploads them. Throws with a message the UI can show. */
export async function syncNow(): Promise<SyncResult> {
  const source = health.source;
  if (!source) throw new Error('Step syncing works on iPhone and Android only.');
  if ((await health.status()) !== 'ready') {
    throw new Error('StepPool needs step access. Tap "Set up step access" on the home screen.');
  }
  return syncToday({
    now: () => new Date(),
    readSteps: (start, end) => health.readSteps(start, end),
    upload: (day, steps) => uploadSteps(day, steps, source),
  });
}
