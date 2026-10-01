// @ts-check
const { defineConfig } = require('eslint/config');
const avalonBase = require('@avalon-vanguard/config/eslint');
const avalonAngular = require('@avalon-vanguard/config/eslint/angular');

module.exports = defineConfig([
  {
    // Build, test and Playwright output (see .gitignore): ESLint does not read .gitignore.
    ignores: [
      'dist/**',
      'coverage/**',
      '.angular/**',
      'node_modules/**',
      'out-tsc/**',
      'tools/etl/.cache/**',
      'e2e/test-output/**',
      'test-results/**',
      'playwright-report/**',
      'blob-report/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [avalonBase, avalonAngular.typescript],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
    },
  },
  avalonAngular.templates,
]);
