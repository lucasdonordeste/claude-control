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
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.cc.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
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

// The sound/notify toggles only make sense if there are Stop/Notification hooks
// (that read the flags). Detect so we don't show inert switches.
function hooksReady() {
  const h = readSettingsSafe().hooks || {};
  return { sound: !!h.Stop, notify: !!h.Notification };
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
};
