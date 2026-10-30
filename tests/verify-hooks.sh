#!/usr/bin/env bash
# Verificacion de comportamiento de las protecciones (no solo de que existan archivos).
# Ejecuta los tests de guard, hooks, gate y risk. Uso: bash tests/verify-hooks.sh
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== Tests de comportamiento (guard, hooks, gate, risk, apply-models, A/B) =="
node --test tests/*.test.mjs
echo
echo "== Estado del repo local =="
HP="$(git config core.hooksPath || true)"
if [ "$HP" = ".hooks/git" ]; then echo "OK: core.hooksPath=.hooks/git (git hooks activos)"; else echo "AVISO: git hooks NO activos. Ejecuta: npm run hooks:install"; fi
[ -f .opencode/plugins/factory-guard.js ] && echo "OK: plugin factory-guard.js presente" || { echo "ERROR: falta el plugin"; exit 1; }
echo "RECORDATORIO: prueba tambien EN VIVO dentro de OpenCode (ver PATCH_INSTRUCCIONES.md, paso 6)."
