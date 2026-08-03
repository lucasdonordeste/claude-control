'use strict';

// Things the panel *does*, as opposed to shows.
//
// Everything here is deliberately free of the `vscode` module: these are pure
// builders and filesystem operations, so they can be unit-tested with
// `node --test`. extension.js owns the UI half (terminals, modals, clipboard)
// and calls into this.
//
// The destructive operations are written defensively on purpose. A control panel
// that can delete things has to be certain about *what* it deletes, so every
// removal is checked against an allowlist and confined to ~/.claude before a
// single file is touched.
const fs = require('fs');
const path = require('path');
const { CLAUDE_DIR, writeJsonAtomic, fileExists } = require('./settings');
const { CLEANABLE, dirSize } = require('./doctor');

// --- shell command building ---------------------------------------------------

// POSIX single-quote quoting: wrap in ', and close/escape/reopen for embedded '.
function shQuote(s) {
  return "'" + String(s).replace(/'/g, `'\\''`) + "'";
}

// PowerShell single-quote quoting: embedded ' is doubled.
function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function quoteFor(platform, s) {
  return platform === 'win32' ? psQuote(s) : shQuote(s);
}

// Session ids are UUIDs; refuse anything else rather than interpolate it into a
// command line.
const SESSION_ID_RE = /^[0-9a-fA-F-]{8,64}$/;

// The command that puts a terminal back into an existing session.
//
// Two different verbs, because they are two different situations:
//   • a background/agent session is *detached* — `claude attach` joins it in this
//     terminal and it keeps running either way;
//   • an interactive session belongs to whatever terminal started it, so the way
//     back into that conversation is `claude --resume <id>`, which opens it here.
// Either way the command must run in the session's own directory, or Claude Code
// opens a different project — hence the explicit cd.
//
// `fork` matters when the interactive session is still running: plain --resume
// reuses the session id, so a second Claude Code ends up on the same transcript
// as the first and reports the first one's background agents as having no
// completion record. --fork-session branches the conversation into a new id.
function resumeCommand(sessionId, cwd, platform, kind, fork) {
  if (!SESSION_ID_RE.test(String(sessionId || ''))) throw new Error('Invalid session id');
  const p = platform || process.platform;
  const q = (s) => quoteFor(p, s);
  const cd = cwd ? `cd ${q(cwd)}; ` : '';
  const verb =
    kind && kind !== 'interactive'
      ? `attach ${sessionId}`
      : `--resume ${sessionId}${fork ? ' --fork-session' : ''}`;
  return `${cd}claude ${verb}`;
}

// `claude mcp login <name>` — the CLI path out of an expired MCP OAuth.
const MCP_NAME_RE = /^[A-Za-z0-9 ._:-]+$/;
function mcpLoginCommand(name, platform) {
  if (!MCP_NAME_RE.test(String(name || ''))) throw new Error('Invalid MCP server name');
  return `claude mcp login ${quoteFor(platform || process.platform, name)}`;
}

// --- secret indirection -------------------------------------------------------

function getIn(obj, segments) {
  let cur = obj;
  for (const s of segments) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[s];
  }
  return cur;
}

function setIn(obj, segments, value) {
  let cur = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const s = segments[i];
    if (!cur[s] || typeof cur[s] !== 'object') return false;
    cur = cur[s];
  }
  cur[segments[segments.length - 1]] = value;
  return true;
}

// Replaces a plaintext credential with a `${VAR}` reference and returns the value
// that was there, so the caller can put it on the clipboard for the user's shell
// profile. A `Bearer …` header keeps its scheme — only the token is indirected.
//
// Returns { ok, secret, replacement, envName } — `ok:false` when the value moved
// or changed since the finding was produced, which is the safe outcome: we would
// rather do nothing than write over something we no longer recognise.
function indirectSecret(file, segments, envName, expectedMasked, allowedFiles) {
  if (!Array.isArray(segments) || !segments.length) return { ok: false };
  if (!/^[A-Z][A-Z0-9_]*$/.test(String(envName || ''))) return { ok: false };
  // The one destructive write that legitimately reaches outside ~/.claude (a
  // project's .mcp.json), so it is confined to the exact set of files the health
  // check offered rather than to a directory.
  if (allowedFiles && !allowedFiles.some((f) => path.resolve(f) === path.resolve(file))) {
    return { ok: false, reason: 'path' };
  }
  let before;
  let j;
  try {
    before = fs.statSync(file);
    j = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { ok: false };
  }
  const cur = getIn(j, segments);
  if (typeof cur !== 'string' || !cur) return { ok: false };
  const bearer = /^(Bearer\s+)(\S+)$/i.exec(cur);
  const secret = bearer ? bearer[2] : cur;
  const replacement = (bearer ? bearer[1] : '') + '${' + envName + '}';
  // The finding was rendered at some earlier point; refuse if the value there is
  // no longer the one the user was shown. Without this, a rotated token — or a
  // ~/.claude.json restructured after a project moved — gets overwritten by a
  // reference to an env var that will never exist.
  if (expectedMasked && maskFor(secret) !== expectedMasked) return { ok: false, reason: 'stale' };
  if (!setIn(j, segments, replacement)) return { ok: false };

  // Claude Code rewrites ~/.claude.json on many events and it can be megabytes;
  // a parse+stringify is long enough to interleave with one of those writes, and
  // the rename below would revert it wholesale.
  try {
    const after = fs.statSync(file);
    if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
      return { ok: false, reason: 'changed' };
    }
  } catch (e) {
    return { ok: false };
  }

  const bak = file + '.bak';
  let wroteBak = false;
  try {
    fs.copyFileSync(file, bak);
    wroteBak = true;
  } catch (e) {
    /* best-effort backup */
  }
  writeJsonAtomic(file, j);
  // The backup exists to survive a failed write — and the write is atomic, so
  // once it returns there is nothing left to recover. Keeping it would leave the
  // plaintext credential sitting next to the config we just cleaned, which is
  // the opposite of what the user asked for.
  if (wroteBak) {
    try {
      fs.unlinkSync(bak);
    } catch (e) {
      /* if it cannot be removed, say so rather than pretend */
      return { ok: true, secret, replacement, envName, backupLeft: bak };
    }
  }
  return { ok: true, secret, replacement, envName };
}

// Kept in step with doctor.maskSecret so the staleness check above compares like
// with like.
function maskFor(v) {
  const s = String(v);
  return s.length <= 8 ? '••••' : s.slice(0, 4) + '••••' + s.slice(-4);
}

// The line the user adds to their shell profile after indirecting a secret.
function exportLine(envName, secret, platform) {
  return (platform || process.platform) === 'win32'
    ? `setx ${envName} ${psQuote(secret)}`
    : `export ${envName}=${shQuote(secret)}`;
}

// --- filesystem cleanup -------------------------------------------------------

const CLEANABLE_KEYS = new Set(CLEANABLE.filter((c) => c.safe).map((c) => c.key));

// Guard for every destructive path: it must resolve to something strictly inside
// ~/.claude. Anything else — a symlink out, a `..`, an absolute path from a
// stale message — is refused.
function insideClaudeDir(p) {
  const root = path.resolve(CLAUDE_DIR);
  const target = path.resolve(p);
  return target !== root && (target + path.sep).startsWith(root + path.sep);
}

// Empties one of the allowlisted cache directories, leaving the directory itself
// in place (Claude Code expects it to exist). Returns { removed, bytes, errors }.
function cleanCacheDir(key) {
  if (!CLEANABLE_KEYS.has(key)) throw new Error('Not a cleanable directory: ' + key);
  const dir = path.join(CLAUDE_DIR, key);
  if (!insideClaudeDir(dir)) throw new Error('Refusing to clean outside ~/.claude');
  // insideClaudeDir is lexical. If the cache directory is itself a symlink —
  // what someone short on disk does — walking it would empty a directory outside
  // ~/.claude while every guard above still passes.
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) {
      throw new Error('Refusing to clean through a symlink: ' + dir);
    }
  } catch (e) {
    if (e && /symlink/.test(e.message)) throw e;
    /* missing directory — the readdir below handles it */
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return { removed: 0, bytes: 0, errors: 0 };
  }
  let removed = 0;
  let bytes = 0;
  let errors = 0;
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (!insideClaudeDir(full)) continue;
    try {
      const st = fs.lstatSync(full);
      if (st.isDirectory()) {
        bytes += dirBytes(full);
        fs.rmSync(full, { recursive: true, force: true });
      } else {
        bytes += st.size;
        fs.unlinkSync(full);
      }
      removed++;
    } catch (err) {
      errors++;
    }
  }
  return { removed, bytes, errors };
}

// Byte size of a directory tree. Delegates to the doctor's walk rather than
// keeping a second copy: the duplicate here discarded the popped directory and
// leaned on Dirent.parentPath to rebuild paths, which silently undercounted on
// Node < 18.17 (still within our engines range), and it followed symlinks, so a
// link to a large file inflated the "cleaned N bytes" number by orders of
// magnitude.
function dirBytes(dir) {
  return dirSize(dir, Infinity).bytes;
}

// Deletes leftover registry files for processes that are gone.
function removeStaleSessionFiles(files) {
  let removed = 0;
  for (const f of files || []) {
    if (!insideClaudeDir(f)) continue;
    if (path.dirname(path.resolve(f)) !== path.resolve(path.join(CLAUDE_DIR, 'sessions'))) continue;
    try {
      fs.unlinkSync(f);
      removed++;
    } catch (e) {
      /* already gone */
    }
  }
  return removed;
}

// Moves a project's transcripts older than `days` into ~/.claude/archive/ rather
// than deleting them — conversation history is not something to throw away on a
// button press.
function archiveTranscripts(days, now) {
  // A hand-edited settings value reaches this directly; `days || 90` only catches
  // 0, and a negative would put the cutoff in the future and archive everything —
  // including the transcript the running session is writing to.
  const d = Number(days);
  const safeDays = Number.isFinite(d) && d >= 1 ? d : 90;
  const cutoff = (now || Date.now()) - safeDays * 86400000;
  const projects = path.join(CLAUDE_DIR, 'projects');
  const archive = path.join(CLAUDE_DIR, 'archive');
  let moved = 0;
  let bytes = 0;
  let dirs;
  try {
    dirs = fs.readdirSync(projects, { withFileTypes: true });
  } catch (e) {
    return { moved: 0, bytes: 0, dest: archive };
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const src = path.join(projects, d.name);
    let files;
    try {
      files = fs.readdirSync(src);
    } catch (e) {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(src, f);
      let st;
      try {
        st = fs.statSync(full);
      } catch (e) {
        continue;
      }
      if (st.mtimeMs >= cutoff) continue;
      const destDir = path.join(archive, d.name);
      try {
        fs.mkdirSync(destDir, { recursive: true });
        // rename() overwrites silently, and the archived copy is by definition
        // the only copy — a name collision would be an unrecoverable loss.
        let dest = path.join(destDir, f);
        for (let n = 1; fs.existsSync(dest) && n < 1000; n++) {
          dest = path.join(destDir, f.replace(/\.jsonl$/, '') + '.' + n + '.jsonl');
        }
        if (fs.existsSync(dest)) continue;
        fs.renameSync(full, dest);
        moved++;
        bytes += st.size;
      } catch (e) {
        /* cross-device or locked — skip it */
      }
    }
  }
  return { moved, bytes, dest: archive };
}

// Makes a hook script executable again.
function makeExecutable(file) {
  if (!fileExists(file)) return false;
  try {
    const mode = fs.statSync(file).mode;
    fs.chmodSync(file, mode | 0o111);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  resumeCommand,
  mcpLoginCommand,
  indirectSecret,
  exportLine,
  cleanCacheDir,
  removeStaleSessionFiles,
  archiveTranscripts,
  makeExecutable,
  insideClaudeDir,
  CLEANABLE_KEYS,
  // exported for unit tests
  shQuote,
  psQuote,
  getIn,
  setIn,
  dirBytes,
};
