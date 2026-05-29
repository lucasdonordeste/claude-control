// Flat ESLint config (ESLint 9). Two environments: the extension host (Node,
// CommonJS) and the webview renderer (browser globals, classic script).
const js = require('@eslint/js');

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
};

module.exports = [
  { ignores: ['node_modules/**', '*.vsix'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: {
      // caught errors are often intentionally ignored (with a comment); empty
      // catch blocks are guarded by no-empty already.
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['media/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        document: 'readonly',
        window: 'readonly',
        acquireVsCodeApi: 'readonly',
        setTimeout: 'readonly',
        console: 'readonly',
      },
    },
  },
];
