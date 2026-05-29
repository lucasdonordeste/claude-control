const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseFrontmatter } = require('../src/project');

function withTempFile(contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, contents);
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('parseFrontmatter: reads name and description', () => {
  withTempFile('---\nname: my-skill\ndescription: Does a thing\n---\n# body\n', (file) => {
    const r = parseFrontmatter(file, 'fallback');
    assert.equal(r.name, 'my-skill');
    assert.equal(r.description, 'Does a thing');
    assert.equal(r.path, file);
  });
});

test('parseFrontmatter: falls back when there is no frontmatter', () => {
  withTempFile('# just a heading\n', (file) => {
    const r = parseFrontmatter(file, 'fallback');
    assert.equal(r.name, 'fallback');
    assert.equal(r.description, '');
  });
});

test('parseFrontmatter: keeps the fallback name when the file is unreadable', () => {
  const r = parseFrontmatter('/no/such/file.md', 'fallback');
  assert.equal(r.name, 'fallback');
  assert.equal(r.description, '');
});
