// @ts-check
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

/**
 * Kauri ESLint flat config.
 *
 * The most important rules here are the per-layer `no-restricted-imports`
 * blocks below. They enforce the module boundary direction documented in
 * the implementation plan:
 *
 *     cli, mcp -> services -> store/repo -> bun:sqlite
 *                       \-> core (pure)
 *                            \- fs (thin I/O)
 *
 * - core/* must not import from store, services, cli, mcp, fs, or bun:sqlite.
 * - store/* must not import from services, cli, or mcp.
 * - services/* must not import from cli or mcp.
 * - cli/* and mcp/* must not import from store/repo/* directly or from bun:sqlite.
 *
 * eslint-plugin-import is intentionally NOT used here yet — its flat-config
 * support for TS is still rough. The boundary rules use the built-in
 * `no-restricted-imports` which is sufficient for what matters.
 */
export default [
  js.configs.recommended,
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'src/store/migrations-data.ts',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        // Bun runtime globals (no @types/bun-globals lookup in ESLint)
        Bun: 'readonly',
        // Standard runtime globals available in Bun
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['*/store/*', '*/services/*', '*/cli/*', '*/mcp/*', '*/fs/*'] },
            { group: ['bun:sqlite'] },
          ],
        },
      ],
    },
  },
  {
    files: ['src/store/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['*/services/*', '*/cli/*', '*/mcp/*'] }],
        },
      ],
    },
  },
  {
    files: ['src/services/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['*/cli/*', '*/mcp/*'] }],
        },
      ],
    },
  },
  {
    files: ['src/cli/**/*.ts', 'src/mcp/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*/store/repo/*'],
              message: 'CLI/MCP must go through services, not store repos directly.',
            },
            {
              group: ['bun:sqlite'],
              message: 'CLI/MCP must not touch bun:sqlite directly.',
            },
          ],
        },
      ],
    },
  },
  // Tests and scripts can do whatever they need
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
];
