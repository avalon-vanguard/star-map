import { defineConfig } from 'vitest/config';

// The VPS Gitea runner, with coverage on, is 3 to 5 times slower than a recent workstation:
// Vitest's default 5 s fails tests there that pass in 1 s locally.
export default defineConfig({
  test: {
    testTimeout: 20_000,
  },
});
