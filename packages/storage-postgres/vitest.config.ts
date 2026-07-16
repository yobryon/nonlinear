import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@nonlinear/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@nonlinear/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
  },
});
