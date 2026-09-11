/* eslint-env node */
module.exports = {
  extends: ['eslint:recommended'],
  ignorePatterns: ['build/*', 'docs/*', 'vue.esm-browser.js'],
  env: {
    browser: true
  }
};
