# Changelog

All notable changes to **Claude Control** are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.1]

### Fixed

- **The pet was below the fold.** It was appended after the last session card, so
  with two sessions open it sat off-screen — you had to scroll the Live tab to
  its end to find it, which defeats the only job it has. It is now pinned to the
  bottom of the panel and visible from every tab, since what the sessions are
  doing is worth knowing wherever you are.

  It also had to move out of the tab body to get there: that body is wrapped in
  `.fade`, whose entry animation uses a `transform`, and a transformed ancestor
  breaks `position: sticky` in its descendants. Left inside, the pet would have
  come unstuck on every re-render — every four seconds on the Live tab.

## [1.8.0]

### Added

- **The new features are switchable from the panel.** Everything added over the
  last few releases shipped as a `settings.json` key and nothing else, which made
  each one invisible to anyone who never opens the JSON — the pet in particular
  was off by default *and* unmentioned anywhere in the UI. Settings now carries
  all four: the quota warning threshold (Off · 15m · 30m · 60m), whether to watch
  Anthropic's status, how the subagent tree opens (Open · While running ·
  Closed), and the pet.

  Switching the status watch off clears the banner and the status-bar item
  immediately rather than at the next five-minute tick, and changing the quota
  threshold re-evaluates the gauge marker on the spot.

## [1.7.0]

### Added

- **A warning when two sessions share one folder.** Running several sessions at
  once is normal, and the most reported friction is two of them writing to the
  same checkout — one moves a file the other is mid-edit on, or they fight over
  the branch. The card now says so. It only names the collision: rearranging
  someone's checkouts from a sidebar would be worse than the problem. The
  counterpart is also shown — a session in its own linked worktree reports the
  branch it is isolated on, so you can see at a glance which ones are safe.

- **Sixteen hook events that were missing.** The picker knew fifteen; Claude Code
  fires thirty-one. Added `TaskCreated`, `TaskCompleted`, `WorktreeCreate`,
  `WorktreeRemove`, `FileChanged`, `CwdChanged`, `ConfigChange`, `PostCompact`,
  `MessageDisplay`, `TeammateIdle`, `InstructionsLoaded`, `UserPromptExpansion`,
  `PermissionDenied`, `PostToolBatch`, `Elicitation` and `ElicitationResult`, and
  the list is now ordered by lifecycle rather than by accident. `FileChanged`
  takes a matcher (the filenames to watch), so it gets one.

- **A cat, if you want one.** Off by default: at the foot of the Live tab, it is
  curled up when nothing runs, its tail goes while an agent works, and it sits up
  in warning colour when a session needs you. The same news the cards carry, in a
  form you catch without reading. Its art is ours — `vscode-pets` is MIT but its
  sprites are individual artists' work under no stated licence. Honours
  `prefers-reduced-motion`. `claudeControl.pet.enabled`.

### Fixed

- **Amber was unreadable on light themes.** `#e8b339` is 1.9:1 on a near-white
  sidebar and the status banner renders 10.5px text in it. Text now uses darkened
  `--warn-text` / `--danger-text` variables, while the waiting LED, the tab's
  attention dot and the card's edge keep the original hue — they are lights, and
  must keep reading as lit. Same split the clay accent has always used.

- **The plan-usage setting still claimed to be the only network request.** It has
  not been since 1.6.0 added the status page. Corrected in both languages.

## [1.6.0]

### Added

- **The Files button now shows what changed, not just what was touched.** Each
  file carries `+42 −7` alongside its edit count, and picking one opens VS Code's
  native side-by-side diff — with per-line revert for free. Files the session
  *created* are included: they are untracked, so `git diff HEAD` alone would miss
  them, which is the most common case when an agent runs unattended.

  The numbers come from git rather than from replaying the transcript, which
  buys the native diff viewer and rename handling at a price worth naming: a
  file you also edited shows your changes mixed with the agent's, and everything
  disappears once you commit (you get "no pending changes", not a silent empty
  list). Outside a git repository the button behaves exactly as it did before.

- **A warning before the quota runs out.** The burn-rate projection has existed
  for a while, but only if you were looking at the panel. Now, when the current
  rate projects your 5-hour or weekly window running out within 30 minutes, you
  get one notification and a marker on the status-bar gauge. Once per reset
  window — it rearms itself when the window turns over, and stays quiet when the
  reset arrives before the ceiling does. `claudeControl.quotaWarning.minutes`
  moves the threshold; `0` turns it off.

- **Anthropic's status, where you already are.** When Claude Code or the API is
  degraded, a coloured banner appears under the tab bar on every tab — carrying
  the incident's own headline, with a button to the real status page — and a
  warning lands in the status bar so you are told even with the panel closed.
  "Is it me or is it them?" is the first question when sessions start failing,
  and the answer used to live in a browser tab.

  It watches the two components a terminal session actually depends on (Claude
  Code and the API), not the whole page — claude.ai or the Console can be down
  without affecting you, and a banner that cries wolf is one you stop reading.
  While everything is healthy it renders nothing at all, in the panel and in the
  status bar both.

  **On privacy:** this is an anonymous `GET` of a public page every five minutes
  — no token, no cookie, no query string, nothing about you or your machine —
  cached for five minutes and backed off for fifteen after a failure. It is not
  telemetry, and `claudeControl.status.enabled` turns it off entirely, after
  which no request is ever made. The README's privacy section has been corrected:
  it claimed a single network request, and there are now two.

## [1.5.0]

### Fixed

- **Resume put a second Claude Code on a session that was already running.** The
  Live tab only lists sessions whose process is alive, so the button's `claude
  --resume <id>` almost always targeted a conversation already open in its own
  terminal — and since `--resume` reuses the session id, two processes ended up
  sharing one transcript. The newcomer then found the original's background
  agents with no completion record and said so ("No completion record was found
  for background agent …"), which is the symptom people hit. Resume now tells the
  three cases apart: a terminal we already opened for that session is raised
  instead of duplicated, a detached session is still `claude attach`, and a live
  interactive one offers a copy under a new session id (`--fork-session`) or the
  command to run yourself.

### Added

- **The subagent tree starts open.** It used to open only while an agent was
  still working, so it folded itself away the moment the last one returned —
  exactly when you go looking for what the session delegated. The new
  `claudeControl.live.expandAgents` setting keeps the old behaviour available
  (`whileRunning`) or pins the tree shut (`never`). Opening or closing a tree by
  hand still wins over the setting.

## [1.4.2]

### Fixed

- **Stop, Transcript and Open folder did nothing** — every item in a session
  card's overflow menu, broken since 1.2.0 introduced it. The host re-dispatched
  the choice as `{ type: 'killSession', ...msg }`, and `msg` still carried
  `type: 'sessionMenu'`, so the spread put the old type back and the menu simply
  re-opened itself. The signal was never sent; the pids were always reachable.
  The webview's own forwarding had the same latent hole — a `data-type`
  attribute would have redirected any action — and is now closed too.

### Internal

- **The webview↔host wiring is now checked by tests.** The two sides talk through
  bare strings (`data-act="x"` on one, `case 'x':` on the other) and nothing
  verified they agreed, so a renamed action was a button that silently did
  nothing. The suite now asserts that every action has a handler, that no handler
  is unreachable, that a re-dispatch cannot be overwritten by the message it is
  re-dispatching, that every contributed command is registered, and that every
  setting read at runtime is declared in the manifest.

## [1.4.1]

### Added

- **Permission rules are now chosen from a list, not typed from memory.** "Add"
  opened a blank box expecting `Bash(git push:*)` — you cannot pick from a
  vocabulary nobody has shown you. It now offers a catalogue grouped by intent
  (reading the code, changing files, running commands, reaching the internet,
  delegating work), each rule with a one-line description of what it actually
  governs — *"Push — publishes to the remote"*, *"Install dependencies — executes
  install scripts"*. **Your configured MCP servers are listed too**, since
  `mcp__<server>` is the rule most often needed and least often spelled right.
  Rules already in a bucket are marked rather than hidden, and the free-text box
  is still there for anything the list cannot anticipate.

### Fixed

- **Finished subagents filled the card again after a restart.** A returned agent
  with no children of its own cannot be folded — folding a childless node hides
  nothing — so thirteen of them rendered as thirteen rows. Whole finished
  branches now leave the tree and become a single count, and the count opens:
  its top-level agents appear, each still openable in turn. Nothing is discarded,
  and a session that ran forty agents is one line until you ask.

## [1.4.0]

Three additions drawn from a survey of what the rest of the ecosystem surfaces
that this panel did not.

### Added

- **Prompt search across every project.** Claude Code appends every prompt you
  send to `~/.claude/history.jsonl` — a complete cross-project index that nothing
  reads. *"What was that thing I asked about the webhook retry, three weeks ago,
  in the other repo"* is a question only that file can answer, and every search
  in this ecosystem is scoped to a single transcript. **Claude Control: Search
  prompt history** ranks by where the term falls in the prompt, whole-word hits
  and recency, then offers to resume that session, copy the prompt, or open its
  transcript. It is a picker rather than a tab: search is what a QuickPick *is*,
  and the panel already has six tabs. 5,000 prompts load in ~11 ms.
- **Tools, with a failure rate.** The Metrics tab measured what a session cost
  and never what it *did*. Now: which tools were reached for, how often, and what
  share of those calls failed — a tool failing one call in ten is a broken setup
  nobody was being told about.
- **When you work.** A 24-hour histogram of turn timestamps. Collected in the
  same transcript pass as everything else, so it costs ~250 ms on a cold scan and
  nothing thereafter.

### Deliberately not used

`~/.claude/stats-cache.json` holds first-party rollups — an hour histogram, tool
counts, longest session — and looked like a free fast path. It is recomputed only
when Claude Code's own stats view is opened: **24 days stale on the machine this
was written on**. Presenting it as current would be misleading, so both new
sections derive from the transcripts already being read. Fresher, and with no
dependency on someone else's cache being warm.

### Fixed

- **The prompt-search ranking did not do what its own comment claimed.** Recency
  was weighted heavily enough to overturn a genuinely better textual match —
  yesterday's passing mention beating last month's prompt that was actually about
  the thing. The positional score is continuous now and recency is bounded well
  below it. Caught by tests that isolate one variable at a time, after the first
  attempt asserted an opinion that varied two at once.

## [1.3.1]

### Changed

- **Finished subagents are folded away, not deleted.** 1.2.x removed each agent
  as it returned and dropped the whole tree once the last one did — which erased
  the record of delegated work exactly when it became worth reading: what was
  delegated, to which model, and what it cost. Folding is now three-state: a
  branch with nothing left running folds itself at any depth, an explicit click
  always wins, and nothing is discarded. A session that ran forty agents is a
  couple of rows until you open it, and the per-agent transcript link survives
  for a post-mortem.

### Fixed

- **A fold chevron could fold nothing.** It was drawn from a subtree size counted
  on the full list while the walk ran over a pruned one, so an agent whose
  children had been removed still offered to collapse them.
- **Fold choices grew in stored state forever.** They are keyed by agent id, so
  the session-level sweep never reached them.
- The subagent list is capped in height and scrolls, instead of a deep tree
  pushing the card's actions off the panel.

### Internal

- **The webview has tests now** — it had none. They cover the three-state fold at
  every depth and, more importantly, lock down the invariant that every value and
  every attribute *name* rendered by the shared primitives is escaped, which was
  previously maintained by hand across twenty-odd call sites.

## [1.3.0]

A pass over what should be configurable, and a contrast bug it turned up.

### Fixed

- **The accent colour failed WCAG contrast on light themes.** Clay `#d97757`
  measures **2.81:1** against a light sidebar — not merely below AA, an outright
  failure — and the panel renders 9.5px text in it: the active tab label, action
  rows, badges, burn rates. Light and high-contrast-light themes now get a
  darkened clay (4.6:1 on a light sidebar, 5.1:1 on white) for anything that is
  *text*, while dots, rules and bars keep the brand tone, where text contrast
  rules do not apply. Dark themes were already 5.7:1 and are untouched.
- **The daily chart drew 30 columns while its header said "last 90 days".** The
  label now reports the window actually plotted.
- Removed a `MAX_SESSIONS` constant whose comment described a cap that was never
  applied, and de-duplicated the usage colour ramp, which existed twice with
  nothing keeping the two copies in agreement.
- The README had two Contributing sections.

### Added

- **Findings can be dismissed.** Some warnings are right about the file and wrong
  about the intent — a deliberate local dev token, or a skill knowingly shadowing
  a plugin's, which is the documented override path. Left undismissable they keep
  the tab's warning dot lit permanently, and a permanent alarm is one nobody
  reads. Dismissed findings are counted and restorable, never silently dropped.
- **`claudeControl.planUsage.enabled`** — plan usage is the extension's only
  network request and its only credential read, in a product whose first promise
  is "no telemetry, no third parties". Turning it off leaves everything else
  working. Previously the only way to stop it was to disable the status bar *and*
  keep the panel closed; an API-key user got an empty gauge and still paid for a
  Keychain shell-out every minute.
- **`claudeControl.live.refreshSeconds`** (1–60, default 4) — each tick re-reads
  every live session's transcript tail and subagent directory, and the mtime
  cache cannot help an *active* session, which is exactly the one being watched.
  Adjustable in both directions.
- **`claudeControl.statusBar.alignment`** — the extension can claim six left-hand
  slots, which on a small screen pushes the branch name off the bar. VS Code lets
  you hide an item but not move it, so the only remedy was turning gauges off.

### Changed

- **Sessions sort by what needs you**, not by last touched: waiting first, then
  working, then the idle terminals somebody left open. Registry order buried a
  session waiting on an answer under three doing nothing.
- **A model outside the preset list is now shown as selected.** A Bedrock/Vertex
  id, or an alias newer than the build, matched nothing in the segmented control,
  which renders as *nothing selected* — so the panel reported an unset model for
  a configured one.

### Deliberately not added

The same study proposed and then rejected roughly fifteen further settings —
per-badge visibility, density modes, custom secret patterns, poll intervals for
the plan gauge, tab ordering. Each is a permanent obligation across six files in
this codebase, and none of them unblocked anyone. Two of its findings were fixed
as better defaults instead: sessions and the model picker, below.

## [1.2.1]

### Added

- **Branches of the subagent tree fold.** Any agent that spawned its own agents
  gets a chevron; folded, it shows how many it is hiding. Nesting reaches three
  levels in practice — a research agent that fans out, whose children fan out
  again — and a dozen rows of it needed a way to be put away.

### Changed

- **Only status LEDs pulse now.** Every activity line carried its own blinking
  dot on top of the row's status dot, so a card with eight live agents animated
  sixteen points at once. The verb's colour already says it is live.

### Fixed

- **A live agent whose parent had finished rendered orphaned.** 1.2.0 hid
  finished agents while others ran, which removed parents out from under their
  own working children — the child stayed indented under nothing. Only branches
  that are finished *all the way down* are collapsed into the summary line now;
  a returned agent with work still under it stays as context.

## [1.2.0]

### Changed

- **The session card's actions were reconsidered from scratch.** Four equal
  buttons wrapped onto two rows at sidebar width and gave the same weight to
  actions of very unequal value. Now: one primary action (**Resume** / **Attach**),
  one that answers the question you actually have about an agent loose in your
  repo (**Files**), and an overflow menu for the rest — transcript, folder, copy
  session id, copy the resume command, and stop, which is rare and destructive
  and is better behind a deliberate step.
- **"Transcript" was the weakest button and no longer pretends otherwise.** It
  opens the raw JSONL — measured on a real session: 7.5 MB, lines averaging 1,500
  characters of JSON. It is the source of truth and worth keeping, but it is not
  a way to read a conversation, so it moved into the menu.

### Added

- **Files** lists every file the session has written, most-edited first, with
  its edit count, and opens the one you pick. Files that were since deleted are
  marked rather than silently failing to open.
  Computed over the whole transcript rather than the recent window, because a
  session's edits are spread across its entire history — the last megabyte of the
  session being measured contained zero edits while the session had written 37
  files. It runs only when asked, and a 7.5 MB transcript takes ~30 ms.
- **Finished subagents collapse to a single line** while others are still
  running (`4 finished · 253k tokens`), instead of a second wave of agents having
  to be read through the wreckage of the first.

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

[1.4.2]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.4.2
[1.4.1]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.4.1
[1.4.0]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.4.0
[1.3.1]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.3.1
[1.3.0]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.3.0
[1.2.1]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.2.1
[1.2.0]: https://github.com/lucasdonordeste/claude-control/releases/tag/v1.2.0
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
