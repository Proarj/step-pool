import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts', 'src/**/*.test.ts', 'plugins/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
