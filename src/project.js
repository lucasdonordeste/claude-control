// Project scope: paths under the open workspace folder, plus the single
// directory walker and frontmatter parser reused by every discovery routine.
const fs = require('fs');
const path = require('path');
const { fileExists } = require('./settings');

// One recursive walker for the whole codebase: skips node_modules/.git, caps
// depth, and calls onFile(fullPath, name) for each file matching `match(name)`.
function walkFiles(dir, opts, depth) {
  const maxDepth = opts.maxDepth == null ? 8 : opts.maxDepth;
  if ((depth || 0) > maxDepth) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walkFiles(full, opts, (depth || 0) + 1);
    } else if (e.isFile() && opts.match(e.name)) {
      opts.onFile(full, e.name);
    }
  }
}

// Reads `name`/`description` from a markdown file's YAML frontmatter, falling
// back to a supplied name (and an empty description) when absent.
function parseFrontmatter(file, fallbackName) {
  let name = fallbackName;
  let description = '';
  try {
    const txt = fs.readFileSync(file, 'utf8');
    const m = txt.match(/^---\s*([\s\S]*?)\s*---/);
    if (m) {
      const nm = m[1].match(/^name:\s*(.+)$/m);
      const dm = m[1].match(/^description:\s*(.+)$/m);
      if (nm) name = nm[1].trim();
      if (dm) description = dm[1].trim();
    }
  } catch (e) {
    /* keep the fallback name */
  }
  return { name, description, path: file };
}

// A SKILL.md's identity defaults to its containing folder name.
function parseSkill(file) {
  return parseFrontmatter(file, path.basename(path.dirname(file)));
}

function byName(a, b) {
  return a.name.localeCompare(b.name);
}
function dedupeByName(list) {
  const seen = new Set();
  return list.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));
}

// Collects every SKILL.md under `dir` into `out`.
function collectSkills(dir, out) {
  walkFiles(dir, {
    maxDepth: 8,
    match: (n) => n.toUpperCase() === 'SKILL.MD',
    onFile: (full) => out.push(parseSkill(full)),
  });
}

// Lists *.md in a directory tree as { name, description, path }.
function listMarkdown(dir) {
  const out = [];
  walkFiles(dir, {
    maxDepth: 6,
    match: (n) => n.toLowerCase().endsWith('.md'),
    onFile: (full, name) => out.push(parseFrontmatter(full, name.replace(/\.md$/i, ''))),
  });
  return out.sort(byName);
}

// Map of project-scope paths from the workspace root.
function projectPaths(root) {
  const dotClaude = path.join(root, '.claude');
  return {
    root,
    dotClaude,
    claudeMd: path.join(root, 'CLAUDE.md'),
    settings: path.join(dotClaude, 'settings.json'),
    settingsLocal: path.join(dotClaude, 'settings.local.json'),
    commands: path.join(dotClaude, 'commands'),
    skills: path.join(dotClaude, 'skills'),
    agents: path.join(dotClaude, 'agents'),
    mcp: path.join(root, '.mcp.json'),
  };
}

function listProjectSkills(root) {
  const out = [];
  collectSkills(projectPaths(root).skills, out);
  return out.sort(byName);
}

// Union of MCP server names declared in the project's .mcp.json and .claude/settings.json.
function listProjectMcp(root) {
  const p = projectPaths(root);
  const names = new Set();
  const addFrom = (file, pick) => {
    if (!fileExists(file)) return;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.keys(pick(j) || {}).forEach((k) => names.add(k));
    } catch (e) {
      /* ignore invalid json */
    }
  };
  addFrom(p.mcp, (j) => j.mcpServers || j);
  addFrom(p.settings, (j) => j.mcpServers);
  return [...names].sort();
}

module.exports = {
  walkFiles,
  parseFrontmatter,
  parseSkill,
  byName,
  dedupeByName,
  collectSkills,
  listMarkdown,
  projectPaths,
  listProjectSkills,
  listProjectMcp,
};
