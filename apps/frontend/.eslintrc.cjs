module.exports = {
  root: true,
  env: { browser: true, es2023: true },
  parserOptions: { ecmaVersion: 2023, sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: '18.3' } },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    // Security-relevant bans, not style preferences.
    'react/no-danger': 'error',
    'react/no-danger-with-children': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
    'no-restricted-globals': [
      'error',
      { name: 'localStorage', message: 'Never store session data in web storage - use HttpOnly cookies.' },
      { name: 'sessionStorage', message: 'Never store session data in web storage - use HttpOnly cookies.' },
    ],
    'no-restricted-properties': [
      'error',
      { object: 'window', property: 'localStorage', message: 'Use HttpOnly cookies for session state.' },
      { object: 'window', property: 'sessionStorage', message: 'Use HttpOnly cookies for session state.' },
    ],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'react/prop-types': 'off',
    eqeqeq: ['error', 'always'],
  },
};
