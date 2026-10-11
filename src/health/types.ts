import type { StepSource } from '@/lib/api';

export type HealthStatus = 'ready' | 'needs-permission' | 'needs-update' | 'unavailable';

export type HealthApi = {
  source: StepSource | null;
  status(): Promise<HealthStatus>;
  requestAccess(): Promise<HealthStatus>;
  /** Total steps between two instants, de-duplicated across phone and watch. */
  readSteps(start: Date, end: Date): Promise<number>;
  openSettings(): Promise<void>;
};
