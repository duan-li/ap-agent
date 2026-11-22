import { defineConfig } from 'vitest/config';

const cases = ['tests/cases.test.ts', 'tests/redlines.test.ts'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: [...cases, 'tests/live/**'],
        },
      },
      { test: { name: 'cases', include: ['tests/cases.test.ts'] } },
    ],
  },
});
