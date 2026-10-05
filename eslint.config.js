import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'reports', 'test-results', '.stryker-tmp', 'server-dist', 'server-data'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-restricted-globals': 'off',
    },
  },
  {
    files: ['tools/**/*.mjs', 'e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        window: 'readonly',
        document: 'readonly',
      },
    },
  },
  {
    // The simulation core must stay free of rendering and browser dependencies.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['three', 'three/*', '**/render/*', '**/ui/*', '**/game/*'] },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'performance'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded Rng for determinism.' },
        { object: 'Date', property: 'now', message: 'The simulation must not read wall-clock time.' },
      ],
    },
  },
);
