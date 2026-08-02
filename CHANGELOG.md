# Changelog

All notable changes to **Claude Control** are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.5]

### Fixed

- **Toggling a newly added setting right after an update failed with a raw error**
  — "claudeControl.statusBar.showSessions is not a registered configuration".
  VS Code builds its settings registry when the window loads, and updating an
  extension in place does not rebuild it, so the first click on any setting
  introduced by that update fails. That is the normal update path, not an edge
  case. The panel now recognises the condition and offers a **Reload window**
  button that fixes it, instead of surfacing an error that reads like a bug in
  the setting itself.

## [1.1.4]

### Changed

- **Finished subagent trees disappear from the card.** Once every agent has
  returned the tree is history, not status, and it would otherwise sit there for
  the rest of the session saying nothing. The transcripts remain on disk.

### Fixed

- **A session that switched models taught the panel the wrong context window —
  permanently.** The high-water mark was measured across the whole scanned tail
  but recorded against the newest turn's model, so a tail holding a 420k Opus
  turn followed by a Haiku turn wrote "Haiku has a 1M window" to the learned
  table, and every later Haiku session showed its gauge against 1M. Peaks are
  now tracked per model.
- **An interrupt or API error blanked the context gauge and renamed the model.**
  Claude Code writes a synthetic turn for those — real usage block, no real
  model, zero counts — and it was taken as the latest turn, so the card read
  `<synthetic>` with no gauge exactly when the user pressed Esc and was looking.
  Synthetic turns are now skipped, and the junk entry they left in the learned
  window table is dropped on read.
- **One corrupt sidecar file emptied the entire Live tab.** A task item or agent
  metadata file containing `null` parses fine and then threw on the first
  property read; the throw escaped far enough to clear every session and gauge in
  the panel, with nothing shown to explain it. Shapes are validated, and each
  session is now composed in isolation so one bad file costs one card.
- **A finished agent could read as running for 15 minutes.** About one in ten
  closes with `stop_reason: null` on a plain text block rather than the explicit
  `end_turn` marker; those are now recognised as settled and confirmed after a
  short quiet period instead of waiting out the safety net.
- **A just-spawned agent read as finished and sorted ahead of its siblings.**
  Between its metadata being written and its transcript being created it had no
  activity timestamp at all, which made it look infinitely idle. It now inherits
  the moment its metadata was created.
- **A tool call answered inside its own transcript entry read as still running**,
  and an `AskUserQuestion` answered that way marked the session "waiting for you"
  — including firing the notification. The scan walks a single entry's content
  backwards now, matching the direction of the outer scan it depends on.
- Removed a dead code path that invented live sessions from any old transcript
  whenever the registry was simply empty rather than absent.

### Internal

- Localization is now enforced by tests: a referenced key with no translation, a
  dead key, a placeholder that skips `{0}`, or a pt-BR string whose placeholders
  disagree with English all fail the build. This caught a button labelled
  literally `btn.openFile`, a modal reading `Empty the "{1}" cache?`, a dropped
  argument in the exposed-secret finding, and eleven strings that were still
  English inside the Portuguese UI.

## [1.1.3]

Hardening pass over the code that deletes, kills and rewrites — driven by an
adversarial review of the 1.1 release. Most of these were latent rather than
exploitable, but they are all in the code with the highest consequence.

### Security

- **A negative pid in the session registry could SIGTERM every process the user
  owns.** `killSession` only rejected `0`, and `kill(2)` reads a negative value
  as a process *group* — `-1` means "everything you may signal". The pid comes
  from a file in `~/.claude/sessions`, so any local process that can drop one
  JSON file there turned a single click into a full logout. Pids are now required
  to be positive integers both at the handler and in the registry parser.
- **A session id is now validated as an id.** It is joined into filesystem paths
  (transcript, tasks, subagents), and the registry accepted any string — `../..`
  in that field walked straight out of `~/.claude`. Validated at the source and
  re-checked in the `openTranscript` handler.
- **Moving a secret to an env var left the secret in a `.bak`.** The backup sat
  next to the config it had just been removed from, was never rescanned, and was
  never mentioned — so the panel reported clean while the credential was still on
  disk. The write is atomic, so the backup has no job once it succeeds: it is now
  deleted, and the user is told if it could not be.
- **Rewriting a symlinked config replaced the link and left the original.** With
  `~/.claude/settings.json` linked into a dotfiles repo — a common setup — the
  cleaned copy became a new local file while the plaintext secret stayed in the
  repo, still tracked, and Claude Code silently stopped reading the user's edits.
  Writes now resolve the link and write through it.
- **Config writes downgraded file permissions from 0600 to 0644.** A credentials
  file deliberately locked down became world-readable the first time any toggle
  was flipped. The mode is now carried across the atomic write.
- **The staleness guard on the secret fix never ran** — the argument was declared
  and never passed, so any non-empty string at the recorded address was replaced.
  A rotated token, or a `~/.claude.json` restructured after a project moved,
  would be overwritten with a reference to an env var that never existed. The
  masked value is now carried through the finding and checked.
- `fixSecret` and `chmodHook` are confined to the exact paths the health check
  reported; `installPlugin` re-validates its arguments at the handler, since the
  trust boundary is the message, not the DOM element it came from.

### Fixed

- **`archiveTranscripts` could silently destroy a transcript.** `rename()`
  overwrites without error and the archived copy is by definition the only copy;
  colliding names are now suffixed. A hand-edited negative `archive.days` also
  put the cutoff in the future and would have archived every transcript,
  including the one the running session was writing.
- **`killSession` did not re-check the pid after the confirmation.** The modal can
  sit open indefinitely; if the session exited meanwhile, the signal went to
  whatever recycled that pid. It is now re-verified against the registry.
- **The "cleaned N bytes" figure could be wrong by orders of magnitude** — the
  size walk followed symlinks and rebuilt paths from a `Dirent` property absent
  on older Node, silently undercounting nested trees. It now delegates to the
  one correct implementation.
- **`cleanCacheDir` claimed to refuse symlinks and did not.** A cache directory
  that is itself a link — what you do when short on disk — would have been walked
  and emptied outside `~/.claude`.
- **The oldest leftover session files could never be cleaned**, because the
  cleanup listed them through a 24-hour staleness filter that had already
  discarded them.
- A session or task status of `constructor` / `toString` corrupted the card's
  class attribute via a prototype lookup; a session id of `__proto__` wedged a
  card permanently open.
- **Keyboard focus was destroyed every four seconds** on the Live tab, which
  re-renders on each poll — fatal for a panel where every control is a focusable
  div. Focus is now restored across renders.
- Expanded-card state grew forever in persisted storage; it is now pruned to the
  sessions that still exist.
- A search query typed on Global kept filtering after switching to a tab with no
  search box, hiding rows with nothing on screen to explain why.
- Project MCP rows rendered as clickable with no file behind them, so a click
  could only ever report "Could not open: ".
- An unknown activity verb rendered as the raw i18n key in agent rows.

### Internal

- The operations that delete, move and rewrite user data had **no tests at all**.
  They now have coverage against a real temp filesystem, including the symlink
  and permission cases above.

## [1.1.2]

### Fixed

- **Every subagent showed as finished the moment it started.** Liveness was read
  from the parent transcript: the `tool_use` that spawned the agent getting its
  `tool_result` was treated as the agent returning. That was true when subagents
  ran in the foreground — but since Claude Code 2.1 they are **backgrounded by
  default**, so the spawning call is answered instantly ("agent launched
  successfully") and keeps that result for the whole run. Every background agent
  was therefore green before it had done anything.
  Liveness now comes from the agent's own transcript: `stop_reason: "end_turn"`
  on its last assistant entry means it returned; anything else means it is still
  going. Found by running four real agents against the panel and watching them
  all turn green immediately.
- **A working agent could still be called finished.** The idle fallback was 120
  seconds, and a single reasoning turn at high effort routinely writes nothing
  for longer than that. It is now 15 minutes and exists only to catch an agent
  that was killed mid-run — reporting a dead agent as running for a while is a
  much smaller error than reporting a working one as done.
- **Running rows clipped what they were doing.** The one line you actually want
  to read — the command, the file, the query — was cut at the column edge. While
  an agent or session is live its activity now wraps over up to three lines;
  finished rows still stay on one so the tree keeps its shape.

## [1.1.1]

### Fixed

- **1.1.0 shipped with ~100 KB of local scratch files in the package** — browser
  screenshots and page snapshots left behind by a UI check, swept in by a
  careless `git add -A`. They were inert, but they had no business in a release.
  Removed, and both `.gitignore` and `.vscodeignore` now exclude them so it
  cannot happen again.

## [1.1.0]

Session cards were showing what a session *is* but not what it is *doing*. This
release fixes that: identity on every agent, the checklist in plain sight, and a
card you can open for the whole story.

### Added

- **Every subagent is now identifiable at a glance.** Each row in the tree carries
  its type, the **model it is running**, the tokens it has spent and **when it
  last moved** — and, while it is still working, its own live activity on a
  second line ("editing CheckoutForm.tsx"). All of this was already being read
  out of the agent transcripts; none of it was being shown.
- **The checklist is visible on the card**, not hidden behind the expander. It is
  the most legible thing about a running session — it says what the work *is*,
  where the current tool call only says what this instant is. Long lists window
  around the item in progress and report the remainder.
- **Cards expand.** Click the title for what the session was asked to do, a trail
  of its **recent actions** (not just the current one), and its tier, pid,
  version and slug.
- **Last activity next to uptime.** Uptime says how long a session has been
  going; last activity says whether it is still moving — the difference between a
  session working and one wedged.

### Fixed

- A session in plan mode showed **"PLAN PLAN"**: `mode` and `permissionMode` are
  different concepts that often hold the same word, and rendering both read as a
  bug. The second is now shown only when it differs.
- Times under five seconds rendered as **"0s"**; they now say "now".

## [1.0.3]

### Fixed

- **"Open folder" appeared to do nothing.** It always asked the editor to open
  the session's directory in a new window — but for a session in the project you
  already have open, that just focuses the window you are looking at. With the
  project scope on by default, that is now the normal case. The button is now
  what it says: for the open workspace it **reveals the folder in your file
  manager**, and only for a session in another project does it open a window.
- **"Resume" used the wrong verb for detached sessions.** Claude Code has two
  ways back into a conversation, and they are not interchangeable: `claude
  attach <id>` joins a background session that is still running, while `claude
  --resume <id>` reopens an interactive session's conversation in this terminal.
  The button now picks by the session's kind and is labelled **Attach** when
  that is what it will do.

## [1.0.2]

### Added

- **One project scope for the whole panel, on by default.** Live, Metrics and
  Doctor now share a single "Only the open project" switch, and it starts
  enabled. On a machine with a dozen projects the useful default is *this* one —
  otherwise every tab opens on other projects' sessions, other projects' tokens
  and other projects' leaked keys, and you filter before you can read. Each tab
  reports what the scope is holding back (`N hidden from other projects`) so a
  narrowed list is never mistaken for an empty one, and Live says so explicitly
  when the only sessions running are elsewhere.
  - Doctor keeps every **global** finding — those affect all sessions — and drops
    only what demonstrably belongs to another project (secrets stored under
    `projects.<path>` in `~/.claude.json`).
  - Metrics narrows totals, the daily chart and the model split to the open
    project, and hides the per-project ranking when there is only one.

### Fixed

- **The plan gauges disappeared whenever the usage endpoint rate-limited.** The
  cache shared with Claude Code's statusline was only accepted if younger than
  75 seconds, so once it aged out and the API answered 429 there was nothing
  left to show — the 5h and 7d items vanished from the status bar while the
  context gauge stayed, which looked like a broken feature rather than a busy
  endpoint. The last statusline value is now used as a fallback (up to 6 hours,
  after which it stops meaning anything) and labelled as such.
- **"Only the open project" could not be switched on at all after an in-place
  upgrade.** It was stored as a VS Code setting, and a newly contributed setting
  is not registered until the window reloads, so clicking it raised
  "claudeControl.live.onlyCurrentProject is not a registered configuration". It
  is view state, not Claude Code configuration, so it now lives in the
  extension's own storage: it works immediately, needs no reload, and cannot
  fail that way. The setting was removed from the manifest.

## [1.0.1]

### Fixed

- **The "Only the open project" switch could disagree with the list it controls.**
  Its state was kept in the webview instead of read from
  `claudeControl.live.onlyCurrentProject`, which the host actually filters on. Two
  sources of truth meant the switch showed ON while sessions from other projects
  were still listed (and changing the setting from the VS Code settings UI never
  moved the switch). It now renders from the setting itself.

### Note

Upgrading in place does not register the new settings until the window reloads —
until then, toggling one reports "not a registered configuration". **Reload the
window after updating.**

## [1.0.0]

The release that turns Claude Control from a config viewer into a cockpit. Three
new tabs, real session control, and a health check that finds the failures Claude
Code never tells you about.

### Added

- **Live tab — every session on the machine.** Claude Code keeps a registry at
  `~/.claude/sessions/<pid>.json`; reading it means the panel now sees *every*
  running session, in every project, with its real state — not just the one in
  the open folder. Each session card shows its AI-generated title, model, effort,
  permission mode, git branch, uptime, context gauge, live to-do list and what it
  is doing this second ("editing main.js", "running npm test").
- **Subagent tree.** Sessions that delegate show their agents nested by real
  parentage, with type, description, token use and a live/finished dot. Built
  from `subagents/agent-*.meta.json`, so the depth and parent link are exact
  rather than guessed.
- **"Waiting for you".** A session blocked on a question is detected (an
  unanswered `AskUserQuestion` / `ExitPlanMode` call), highlighted in amber with
  the question text, flagged on the tab and in the status bar, and — if you want
  — announced with a notification. This is the one thing you cannot see from
  another window.
- **Session actions.** Resume a session in a terminal at the right directory,
  open its transcript, open its folder in a new window, or stop a stuck one
  (SIGTERM, behind a modal, so Claude Code still flushes its transcript).
- **Metrics tab.** Token analytics computed from your own transcripts: totals,
  turns, a 30-day column chart, and splits by project and by model. Plus
  **cache efficiency** — the share of each prompt replayed from cache instead of
  re-sent, which is the number that decides what a long session costs — and a
  **burn rate** that projects when the 5h/7d window fills, or says so when the
  window resets first. Deliberately no monetary estimate: prices change and a
  stale table prints confident wrong numbers.
- **Doctor tab.** Health checks for the failures that are otherwise silent:
  - **plaintext secrets** in `settings.json`, `.claude.json`, project settings
    and `.mcp.json` — masked, with a one-click move to a `${VAR}` reference that
    backs up the file and puts the export line on your clipboard;
  - **broken hooks** — a command pointing at a script that is missing or not
    executable (distinguishing the ones guarded with `[ -x … ]`, which are fine);
  - **invalid JSON**, which makes Claude Code ignore an entire config file;
  - **MCP servers that need to sign in again**;
  - **shadowed skills / agents / commands** defined under the same name twice;
  - mixed Claude Code versions across sessions, a failed self-update, and
    leftover session files.
  - **Disk usage** per cache directory, with guarded cleanup and an archive
    action that moves old transcripts aside instead of deleting them.
- **Settings: Claude Code itself.** Pick the **model**, **reasoning effort** and
  **startup permission mode**, and edit the **allow / ask / deny** permission
  rules and **environment variables** — with validation — without opening JSON.
- **Hook library.** Six ready-made hooks installed in one click, each shipped as
  a real script you can read and edit: protect secret files, keep writes inside
  the project, format after every edit, log shell commands, run tests before
  finishing, and log session starts.
- **Status bar.** A new item counting running sessions and subagents across all
  projects, turning amber when one needs you.
- **Command palette.** `Claude Control: Show live sessions`, `Run health checks`
  and `Show token metrics`.

### Changed

- **Tabs are now icon-first** — inactive tabs collapse to their icon and the
  active one shows its label, which is what makes six sections fit a sidebar.
- **Session detection no longer relies on IDE locks.** The old approach only saw
  sessions attached to an editor window and could not tell what they were doing;
  a session in an external terminal was invisible. The registry replaces it, with
  the previous behaviour kept as a fallback for older Claude Code versions.
- **The webview is split** into `icons` / `ui` / `views` / `main`, and transcript
  parsing is cached on `(mtime, size)` so idle sessions and finished subagents
  cost a `stat()` instead of a re-read.
- Skills, agents and commands show **which plugin they come from**, and
  user-level definitions are correctly listed as the ones that win.
- Scaffolded skills/agents/commands use the **2.x frontmatter**, with the
  optional keys present as comments.

### Fixed

- **Sound / notification switches could be inert.** `hooksReady()` only checked
  that *some* `Stop` / `Notification` hook existed, so an unrelated hook from
  another tool made the panel offer switches that did nothing. It now requires
  our own script, and that the script still exists on disk.
- **MCP servers added by `claude mcp add` were invisible.** The list only read
  `settings.json` and ignored `~/.claude.json`, which is where the CLI writes.
- **Interrupted plugin installs double-listed everything.** The plugin cache's
  leftover `temp_git_*` / `*.clone` directories are now skipped.
- **The new-hook picker was missing half the events** — `StopFailure`,
  `PostToolUseFailure`, `PermissionRequest`, `SubagentStart`, `SessionEnd`,
  `Setup` and `DirectoryAdded` are all offered now, with a matcher prompt on the
  events that support one.
- Hooks are no longer added twice when the same command is registered again, and
  a matcher is only written on events where it means something.
- Every interactive element is reachable by keyboard and carries an accessible
  role and label.

## [0.9.5]

### Added

- **Plans browser.** A new Plans section (Global) lists your plan-mode documents
  from `~/.claude/plans`, titled by their heading and openable in the editor.
- **Live “working on”.** Each session in the Usage tab shows its in-progress
  to-do (what it's doing right now) and an X/Y-done count, read from the session's
  task list. A debounced file watcher keeps it live without extra polling.

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

[1.1.5]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.1.5
[1.1.4]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.1.4
[1.1.3]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.1.3
[1.1.2]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.1.2
[1.1.1]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.1.1
[1.1.0]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.1.0
[1.0.3]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.0.3
[1.0.2]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.0.2
[1.0.1]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.0.1
[1.0.0]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.0.0
[0.8.0]: https://github.com/lucasdonordeste/claude-control/releases/tag/v0.8.0
[0.7.3]: https://github.com/lucasdonordeste/claude-control/releases/tag/v0.7.3
[0.7.2]: https://github.com/lucasdonordeste/claude-control/releases/tag/v0.7.2
[0.6.5]: https://github.com/lucasdonordeste/claude-control/releases/tag/v0.6.5
[0.4.0]: https://github.com/lucasdonordeste/claude-control/releases/tag/v0.4.0
[0.2.0]: https://github.com/lucasdonordeste/claude-control/releases/tag/v0.2.0
