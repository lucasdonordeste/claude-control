const test = require('node:test');
const assert = require('node:assert');
const { slugify } = require('../src/primitives');

test('slugify: lowercases, replaces non-alphanumerics with single dashes', () => {
  assert.equal(slugify('Review PR! 2'), 'review-pr-2');
  assert.equal(slugify('  Hello   World  '), 'hello-world');
});

test('slugify: trims leading/trailing dashes', () => {
  assert.equal(slugify('--edge--'), 'edge');
});

test('slugify: returns a default when nothing usable remains', () => {
  assert.equal(slugify('---'), 'untitled');
  assert.equal(slugify(''), 'untitled');
});
