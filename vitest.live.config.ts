import { defineConfig } from 'vitest/config';

// Model-dependent runs only. `npm test` never loads this file.
export default defineConfig({
  test: { name: 'live', include: ['tests/live/**/*.test.ts'] },
});
