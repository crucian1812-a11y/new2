export default [
  {
    files: ['src/**/*.js', 'tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', console: 'readonly',
        performance: 'readonly', requestAnimationFrame: 'readonly',
        localStorage: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        AudioContext: 'readonly', webkitAudioContext: 'readonly',
        Path2D: 'readonly', Image: 'readonly', devicePixelRatio: 'readonly',
        process: 'readonly', URL: 'readonly', fetch: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
      'no-redeclare': 'error',
      'no-self-assign': 'error',
      'valid-typeof': 'error',
    },
  },
];
