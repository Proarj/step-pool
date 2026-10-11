import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts', 'src/**/*.test.ts', 'plugins/**/*.test.ts'],
    // Each SQL test file holds a ~100 MB PGlite instance. Capping workers and
    // allowing slow starts keeps the suite stable when this laptop's system
    // scans make worker start-up crawl. (The threads pool hung on exit; stay on forks.)
    maxWorkers: 2,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
