import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts', 'src/**/*.test.ts', 'plugins/**/*.test.ts'],
    // Each SQL test file holds a ~100 MB PGlite instance; capping workers and
    // allowing slow starts keeps the suite stable on a busy, swapping laptop.
    maxWorkers: 2,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
