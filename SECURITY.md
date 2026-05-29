# Security Policy

Claude Control runs entirely on your machine. It reads and writes your local
Claude Code configuration under `~/.claude` (and the open project's `.claude/`),
and makes exactly one network request — to Anthropic's own usage API — using the
Claude Code token already on your machine. It has **no telemetry and no third
parties**, and the token is never logged, stored, or sent anywhere else.

## Reporting a vulnerability

If you find a security issue, please **do not open a public issue**. Instead,
report it privately via GitHub's
[security advisories](https://github.com/lucasdonordeste/claude-control/security/advisories/new)
for this repository.

Please include steps to reproduce and the affected version. You can expect an
initial response within a few days.
