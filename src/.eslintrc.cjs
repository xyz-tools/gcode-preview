/* eslint-env node */
module.exports = {
  extends: ['eslint:recommended'],
  ignorePatterns: ['three-line2'],
  env: {
    browser: true
  },
  rules: {
    'no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        ignoreRestSiblings: true
      }
    ]
  }
};
