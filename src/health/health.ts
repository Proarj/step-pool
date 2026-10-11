import type { HealthApi } from './types';

// Web / fallback. Metro uses health.ios.ts and health.android.ts on phones.
export const health: HealthApi = {
  source: null,
  status: async () => 'unavailable',
  requestAccess: async () => 'unavailable',
  readSteps: async () => 0,
  openSettings: async () => undefined,
};
