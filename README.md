<div align="center">

# Claude Control

**A control panel for [Claude Code](https://www.anthropic.com/claude-code), right in your editor sidebar.**

Toggle plugins, sound and notifications, and browse your skills, MCP servers, agents and commands — across both your global config and the open project. Not just a viewer: the switches actually *do* things.

[![Open VSX Version](https://img.shields.io/open-vsx/v/lucasdonordeste/claude-control?label=Open%20VSX)](https://open-vsx.org/extension/lucasdonordeste/claude-control)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/lucasdonordeste/claude-control)](https://open-vsx.org/extension/lucasdonordeste/claude-control)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`no telemetry` · `no third parties` · `VS Code + Cursor` · `macOS · Windows · Linux`

<br />

<img src="https://raw.githubusercontent.com/lucasdonordeste/claude-control/main/media/panel.png" alt="Claude Control panel — Global scope with Config toggles plus Plugins, Skills, Agents, Commands, MCP servers and Hooks" width="360" />

<br />
<br />

### Plan usage, live in your status bar

![Claude plan usage in the status bar — session and weekly gauges filling and changing color](https://raw.githubusercontent.com/lucasdonordeste/claude-control/main/media/statusbar.gif)

Your **session (5h)** and **weekly (7d)** usage, each with its own gauge and color — green → amber → red as you consume. Auto-refreshes every 60s; click it to open the panel.

</div>

---

## Why Claude Control

Claude Code is configured through files scattered across `~/.claude` and each project's `.claude/` folder. Claude Control surfaces all of it in one tidy panel — and lets you flip the important switches without hunting through JSON.

- **It's interactive.** Enable/disable plugins, mute sound, silence notifications — one click, no file editing.
- **Two scopes, one view.** See your **Global** setup (`~/.claude`) and the **Project** setup (the folder you have open) side by side.
- **Stays out of the way.** Native look that adapts to your theme, with a precise, instrument-panel aesthetic.

## Features

| | |
|---|---|
| ⚙️ **Config** | Toggle Claude Code **sound** and **notifications** instantly — and if you don't have notification hooks yet, **install them in one click** (cross-platform). |
| 🧩 **Plugins** | Enable/disable installed plugins with a switch, and **install new ones** from your marketplace right in the panel. Changes are written safely (with backup). |
| ✨ **Skills** | Browse every skill from your plugins and your own — and **scaffold a new skill** with one click. |
| 🤖 **Agents & Commands** | Browse your subagents and slash commands (from plugins and your own), and **scaffold a new agent or command** in one click. |
| 🔌 **MCP servers** | See configured servers and **add popular ones** from a curated list (filesystem, GitHub, fetch, Playwright, Context7…). |
| ⚡ **Hooks** | View all your hooks by event and **create new ones** without touching JSON. |
| 📊 **Live plan usage** | A **Usage** tab and a **status-bar gauge** show your real **session** and **weekly** usage (the same numbers as `/usage`) — colored by how much you've used, plus a **trend sparkline**. Auto-refreshed every 60s; toggle the status-bar item any time. |
| 📁 **Project scope** | `CLAUDE.md`, project `settings.json`, `commands/`, `skills/`, `agents/` and `.mcp.json` for the open folder. |

## Compatibility

- **Editors:** Visual Studio Code and Cursor (any VS Code 1.75+ compatible editor).
- **Platforms:** macOS, Windows and Linux. Paths are resolved per-OS; everything reads from your local `~/.claude` and workspace.
- **Language:** the UI defaults to **English**, with **Portuguese (pt-br)** auto-selected when your editor's display language is Portuguese.

## Install

**Cursor** — open **Extensions**, search for **"Claude Control"**, and install. (Cursor uses the Open VSX registry, where this extension is published.) Or grab it from the [Open VSX page](https://open-vsx.org/extension/lucasdonordeste/claude-control).

**VS Code** — not on the VS Code Marketplace yet. Download the latest `claude-control.vsix` from [Releases](https://github.com/lucasdonordeste/claude-control/releases), then run **"Extensions: Install from VSIX…"**.

Then **reload the window** and click the **sliders icon** in the Activity Bar.

## Privacy

Claude Control runs **on your machine** and has **no telemetry and no third parties**. It reads and writes your local Claude Code files. To show your plan-usage gauge it reads the **existing local Claude Code token** (from `~/.claude/.credentials.json` or the macOS Keychain) and makes a single request to **Anthropic's own usage API** — exactly what `/usage` already does. Results are cached in a temporary file shared with Claude Code's own statusline so we rarely call the API at all. The token is never logged, stored, or sent anywhere else; nothing leaves your machine.

## Requirements

[Claude Code](https://www.anthropic.com/claude-code) installed, with its configuration in `~/.claude`. The panel reads whatever is there; nothing else to set up.

## Good to know

- **Plugin toggles** edit `settings.json` and take effect after you **restart your Claude Code session** (the panel reminds you). A `.bak` backup is written before every change.
- **Sound / notification toggles** rely on Claude Code **hooks** that read the on/off flags. If no hooks are configured, the panel hides those switches and offers to install them.
- **The live usage gauge** uses the same Claude.ai login token that powers `/usage`. If you authenticate only with an API key, the gauge stays empty — everything else still works.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). It's a small, no-build plain-JS extension: `npm install`, then press **F5** to launch an Extension Development Host.

## License

[MIT](LICENSE) © Lucas do Nordeste
