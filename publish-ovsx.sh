#!/bin/zsh
# Publishes the extension to Open VSX (Cursor's registry).
# Usage:  export OVSX_PAT=<your-token>   &&   ./publish-ovsx.sh
set -e
cd "$(dirname "$0")"

: "${OVSX_PAT:?Set OVSX_PAT to the token from https://open-vsx.org (Settings > Access Tokens)}"

echo "-> linting + testing"
npm run lint
npm test

echo "-> packaging a fresh claude-control.vsix"
npm run package

echo "-> ensuring the 'lucasdonordeste' namespace exists"
npx --yes ovsx create-namespace lucasdonordeste -p "$OVSX_PAT" 2>/dev/null \
  && echo "  namespace created" \
  || echo "  (namespace already exists - ok)"

echo "-> publishing"
npx --yes ovsx publish claude-control.vsix -p "$OVSX_PAT"

echo "Done. It appears at https://open-vsx.org/extension/lucasdonordeste/claude-control in a few minutes."
