import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**', 'scripts/**'],
      // update-proxy-config.ts is a large interactive CLI; its interactive
      // flows are not unit-testable without heavy stdin simulation.
      exclude: ['src/types.ts', 'scripts/update-proxy-config.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 80,
      },
    },
  },
})
