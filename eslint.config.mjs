import eslint from '@eslint/js';

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // mark Node globals as readonly so they are recognized
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      'quotes': ['error', 'single'],
      'indent': ['error', 2, { SwitchCase: 0 }],
      'linebreak-style': ['error', 'unix'],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'dot-notation': 'error',
      'eqeqeq': ['error', 'smart'],
      'curly': ['error', 'all'],
      'brace-style': ['error'],
      'prefer-arrow-callback': 'warn',
      'max-len': ['warn', 160],
      'object-curly-spacing': ['error', 'always'],
      'no-use-before-define': 'off',
    },
  },
  // Extend the recommended configuration from @eslint/js.
  eslint.configs.recommended,
];