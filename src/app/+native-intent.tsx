import { routerPathFor } from '@/lib/system-path';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  try {
    return routerPathFor(path, initial);
  } catch {
    return path;
  }
}
