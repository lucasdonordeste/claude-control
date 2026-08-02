// Low-level access to ~/.claude config: paths, fs helpers, atomic settings.json
// read/write (with backup), and the sound/notify flag files.
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
const HOOKS_DIR = path.join(CLAUDE_DIR, 'hooks');

// Keys we refuse to write into config objects, so a value coming from untrusted
// JSON (e.g. a marketplace.json) can never inject a prototype-style key.
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
function isSafeKey(k) {
  return typeof k === 'string' && k.length > 0 && !UNSAFE_KEYS.has(k);
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
}
function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
}

// Atomic JSON write: write a temp file then rename onto the target, so an
// interrupted write (crash, full disk) can never leave a half-written file.
//
// Two things the rename would otherwise get wrong:
//   • it replaces a symlink with a regular file. A dotfiles setup that links
//     ~/.claude/settings.json into a git repo would end up with the edit in a
//     new local file and the *original* — including whatever we were trying to
//     remove from it — still in the repo. Resolve the link and write through it.
//   • a fresh temp file is created with the default umask, so a config the user
//     deliberately chmod'ed 600 comes back 644. Carry the mode over.
function writeJsonAtomic(file, obj) {
  let target = file;
  try {
    target = fs.realpathSync(file);
  } catch (e) {
    /* new file — realpath fails, the original path is right */
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let mode;
  try {
    mode = fs.statSync(target).mode & 0o777;
  } catch (e) {
    /* new file — let the umask decide */
  }
  const tmp = target + '.cc.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', mode ? { mode } : undefined);
  // writeFileSync's mode is only applied on create; enforce it for a reused temp.
  if (mode !== undefined) {
    try {
      fs.chmodSync(tmp, mode);
    } catch (e) {
      /* best-effort */
    }
  }
  fs.renameSync(tmp, target);
}

function readSettings() {
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
}
// Never throws — returns {} when settings.json is missing or malformed. Use this
// everywhere except where a parse error genuinely must surface.
function readSettingsSafe() {
  try {
    return readSettings();
  } catch (e) {
    return {};
  }
}
// Writes settings.json atomically, keeping a .bak of the previous file when one
// exists. Tolerates a missing source (fresh install — Claude Code may not have
// created settings.json yet).
function writeSettings(obj) {
  if (fileExists(SETTINGS_PATH)) {
    try {
      fs.copyFileSync(SETTINGS_PATH, SETTINGS_PATH + '.bak');
    } catch (e) {
      /* best-effort backup; never block the write on it */
    }
  }
  writeJsonAtomic(SETTINGS_PATH, obj);
}

// --- sound / notification flags (read by the hooks in real time) ---
function flagPath(which) {
  return path.join(HOOKS_DIR, which === 'sound' ? '.sound-off' : '.notify-off');
}
function flagOff(which) {
  return fileExists(flagPath(which));
}
function toggleFlag(which) {
  const p = flagPath(which);
  if (fileExists(p)) {
    fs.unlinkSync(p);
  } else {
    fs.mkdirSync(HOOKS_DIR, { recursive: true });
    fs.writeFileSync(p, '');
  }
}

// The sound/notify toggles only work through *our* hook scripts, because those
// are what read the .sound-off / .notify-off flag files. Checking merely that
// some Stop hook exists is not enough: plenty of setups have an unrelated Stop
// hook (a task runner, another extension), and then the panel shows switches
// that silently do nothing. Require the command to reference our script *and*
// the script to still be on disk.
function hookInstalled(groups, basenames) {
  return (groups || []).some((g) =>
    ((g && g.hooks) || []).some((h) => {
      const cmd = String((h && h.command) || '');
      return basenames.some((n) => cmd.includes(n) && fileExists(path.join(HOOKS_DIR, n)));
    })
  );
}

function hooksReady() {
  const h = readSettingsSafe().hooks || {};
  return {
    sound: hookInstalled(h.Stop, ['stop.sh', 'stop.ps1']),
    notify: hookInstalled(h.Notification, ['notify.sh', 'notify.ps1']),
  };
}

module.exports = {
  HOME,
  CLAUDE_DIR,
  SETTINGS_PATH,
  HOOKS_DIR,
  isSafeKey,
  fileExists,
  dirExists,
  writeJsonAtomic,
  readSettings,
  readSettingsSafe,
  writeSettings,
  flagOff,
  toggleFlag,
  hooksReady,
  hookInstalled,
};
