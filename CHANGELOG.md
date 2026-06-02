# Changelog

All notable changes to **Claude Control** are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.4]

### Changed

- **Footer.** The "developed by @lucasdonordeste" credit is now pinned to the
  bottom of the panel and is plain text (no link).

## [0.9.3]

### Added

- **Closed sessions disappear immediately.** Active sessions are now detected via
  Claude Code's IDE session locks (`~/.claude/ide/`), so a session's gauge is
  removed the moment you close it (with an mtime fallback for external terminals).
- **Real context window.** Each model's true window is learned from observed usage
  (e.g. Opus 4.8 is 1M), so even small sessions of a 1M model report against 1M
  instead of a fixed 200k.
- **Footer credit.** A small "developed by @lucasdonordeste" at the bottom of the
  panel (localized), linking to the GitHub profile.

## [0.9.2]

### Added

- **Per-session context gauges.** Projects with more than one active Claude Code
  session now get one context gauge per session in the status bar, each with a
  stable number (`S1`, `S2`…) and a tooltip naming the session (slug · branch ·
  model). The Usage tab lists every active session. Up to 3 sessions active
  within the last 6h; a single session keeps the simple `ctx:` label.

## [0.9.1]

### Changed

- **Status-bar context** now shows the explicit `ctx:91k/1M 9%` (tokens / window
  + percent) instead of a mini-bar — more informative at a glance.
- **Multi-session projects.** The Usage tab and status-bar tooltip now name the
  active session (slug · git branch) and note how many sessions a project has,
  so the model/context is unambiguous when more than one session exists.

## [0.9.0]

### Added

- **Session context & model.** The Usage tab now shows the **model in use**, the
  service **tier**, and the **context window** occupied by the active Claude Code
  session (read from the session transcript) as tokens and a %. The window is
  **auto-detected** (200k, or 1M once a session exceeds 200k). The status bar
  gains an optional **context** gauge alongside 5h/7d, and the ⚙️ tab has
  per-gauge toggles to choose which of **5h / 7d / context** appear there.
- **Settings tab (⚙️).** A new gear tab in the panel collects the configuration:
  the Sound / Notifications / Status bar toggles moved here from Global, plus a
  **Status bar color** picker (Adaptive / Usage / Custom / None) with a native
  color picker for the Custom color — all without opening VS Code settings.
- **Status-bar color modes.** New `claudeControl.statusBar.colorMode` setting:
  **adaptive** (default) adapts to the theme — neutral while healthy, with a
  native warning/error highlight at high usage that stays legible even on a
  colored status bar; **usage** keeps the original green → amber → red ramp;
  **custom** uses a single fixed color you pick (`claudeControl.statusBar.customColor`);
  **none** uses the theme's default text color. Fixes the gauges looking broken
  on themes/IDEs with a colored status bar.

## [0.8.0]

### Added

- **Localization.** The UI now defaults to **English**, with **Portuguese
  (pt-br)** offered as a locale (auto-selected from the editor language). Falls
  back to English for any untranslated string.

### Fixed

- **Data loss when installing notification hooks.** Installing the sound/notify
  hooks no longer overwrites pre-existing `Stop` / `Notification` hooks — they
  are now appended (and de-duplicated on re-install).
- **Removing a hook removed the wrong one.** Hooks are now removed by their
  command, so deleting one hook never drops a sibling in the same group and is
  robust to the settings file changing between render and click.
- **Corruptible config writes.** `settings.json` and project `.mcp.json` are now
  written atomically (temp file + rename), and writes tolerate a missing
  settings file on a fresh install.

### Security

- **Command-injection hardening.** Marketplace plugin names/ids are validated to
  a safe character set before they can reach the install command.
- Untrusted JSON keys (`__proto__`, `constructor`, `prototype`) are rejected
  before being written into config.
- The macOS Keychain token read uses a no-shell `execFile`, and the shared usage
  cache is written with `O_EXCL` + atomic rename.

### Changed

- **Internal refactor.** The data layer was split into focused modules
  (`settings`, `usage`, `primitives`, `project`) behind a thin barrel — no change
  to behaviour, but easier to maintain and unit-test.
- Tooling: ESLint, EditorConfig, unit tests (`node --test`), CI, and a
  documented package/publish flow.

## [0.7.3]

### Changed

- Plan-usage reads now share Claude Code's statusline cache (`$TMPDIR`), so the
  extension almost never calls the usage API directly — eliminating rate-limit
  (HTTP 429) errors during normal use.

## [0.7.2]

### Added

- Panel reorganized into **tabs** (Global · Project · Usage) with client-side
  search and a sticky header.
- **Agents** and **Commands** sections in the Global scope, with one-click
  scaffolding.
- A **trend sparkline** on the Usage tab, backed by a local usage history.

### Changed

- Usage poll interval raised to 60s and the rate-limit handling reworked
  (honours `retry-after`, never caches errors, keeps the last good value).

## [0.6.5]

### Added

- **Live plan usage in the status bar** — separate session (5h) and weekly (7d)
  gauges, each with its own color ramp, sharing a tooltip. Toggle via
  `claudeControl.statusBar.enabled`.

## [0.4.0]

### Added

- Cross-platform support (macOS / Windows / Linux) for notification hooks.
- Marketplace plugin install, skill scaffolding, curated MCP servers, and a
  Hooks section.

## [0.2.0]

### Changed

- UI rebuilt as a Webview with the "cockpit" aesthetic (custom icon, LED
  toggles, collapsible sections).

[0.8.0]: https://github.com/lucasdonordeste/claude-control/releases/tag/v0.8.0
[0.7.3]: https://github.com/lucasdonordeste/claude-control/releases/tag/v0.7.3
[0.7.2]: https://github.com/lucasdonordeste/claude-control/releases/tag/v0.7.2
[0.6.5]: https://github.com/lucasdonordeste/claude-control/releases/tag/v0.6.5
[0.4.0]: https://github.com/lucasdonordeste/claude-control/releases/tag/v0.4.0
[0.2.0]: https://github.com/lucasdonordeste/claude-control/releases/tag/v0.2.0
