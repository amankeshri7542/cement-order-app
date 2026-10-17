import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.next-e2e/**',
      '**/.next-security/**',
      '**/.expo/**',
      '**/next-env.d.ts',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      '.local/**',
      '.claude/**',
      '.playwright-cli/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        __dirname: 'readonly',
        module: 'readonly',
        require: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Code that runs inside the Android/iOS app (Hermes) must avoid web-only APIs.
    files: ['apps/mobile/**/*.{ts,tsx}', 'packages/shared/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'AbortSignal',
          property: 'timeout',
          message:
            'React Native has no AbortSignal.timeout(); use AbortController with setTimeout.',
        },
        {
          object: 'AbortSignal',
          property: 'any',
          message: 'React Native has no AbortSignal.any().',
        },
      ],
    },
  },
  {
    // Expo config plugins and Metro config are loaded with require().
    files: ['apps/mobile/plugins/**/*.js', 'apps/mobile/metro.config.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
