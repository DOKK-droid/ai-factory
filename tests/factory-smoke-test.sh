#!/usr/bin/env bash
# Smoke test: estructura minima + suite de comportamiento. Uso: bash tests/factory-smoke-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
need() { [ -e "$1" ] && echo "OK: $1" || { echo "ERROR: falta $1" >&2; exit 1; }; }
for f in .opencode/command/factory.md .opencode/plugins/factory-guard.js factory/scripts/command-guard.mjs \
         factory/config.json 01-TOOLS/checks.sh 01-TOOLS/risk.sh 02-DOCS/wiki/index.md 02-DOCS/wiki/sdd/constitution.md \
         03-SKILLS/factory-protocol/SKILL.md; do need "$f"; done
[ "$(ls .opencode/agent/*.md | wc -l)" -ge 11 ] && echo "OK: 11 agentes custom" || { echo "ERROR: faltan agentes"; exit 1; }
node factory/scripts/apply-models.js --check >/dev/null && echo "OK: modelos de los agentes coinciden con factory/config.json"
npm test --silent
echo "Smoke test OK"
