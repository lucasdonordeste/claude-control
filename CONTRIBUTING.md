# Contributing to Claude Control

Thanks for your interest! This is a small, no-build extension in plain
JavaScript — there's no bundler or transpile step.

## Layout

| Path | What it is |
|---|---|
| `extension.js` | VS Code glue: activation, status bar, the webview provider and message handling |
| `src/settings.js` | `~/.claude` paths, atomic `settings.json` read/write, sound/notify flags |
| `src/usage.js` | plan-usage token discovery + cached HTTP client with backoff |
| `src/primitives.js` | plugins, marketplace, MCP, hooks, skills/agents/commands |
| `src/project.js` | project-scope paths + the shared file walker / frontmatter parser |
| `src/claude.js` | thin barrel re-exporting the data-layer public API |
| `src/i18n.js` | localized strings (English default, `pt-br` locale) |
| `media/` | webview renderer (`main.js`), styles (`main.css`), icons |

## Develop

1. `npm install`
2. Press **F5** (Run Extension) to launch an Extension Development Host.
3. Open the **Claude Control** view from the Activity Bar.

## Before opening a PR

```sh
npm run lint
npm test
npm run package   # produces claude-control.vsix
```

## Localization

User-facing strings live in `src/i18n.js` (extension host + webview bundle) and
`package.nls*.json` (manifest contributions). Add new strings as keys in the
English `en` map first; add the `pt-br` translation when you have it (missing
keys fall back to English).

## Conventions

- 2-space indent, LF line endings (see `.editorconfig`).
- Code comments in English.
- Keep the data layer free of `vscode` imports so it stays unit-testable.
