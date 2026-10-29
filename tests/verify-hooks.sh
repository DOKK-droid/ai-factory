#!/usr/bin/env bash
# tests/verify-hooks.sh
# Verifica que los hooks de protección están activos y funcionan.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO_ROOT}"

echo "=============================================="
echo "  Verificación de Hooks de Protección"
echo "=============================================="

# 1. pre-commit
echo "-> Verificando .git/hooks/pre-commit..."
if [ -f .git/hooks/pre-commit ] && [ -x .git/hooks/pre-commit ]; then
  echo "   OK: pre-commit existe y es ejecutable"
else
  echo "   ERROR: pre-commit no existe o no es ejecutable"
  exit 1
fi

# 2. pre-push
echo "-> Verificando .git/hooks/pre-push..."
if [ -f .git/hooks/pre-push ] && [ -x .git/hooks/pre-push ]; then
  echo "   OK: pre-push existe y es ejecutable"
else
  echo "   ERROR: pre-push no existe o no es ejecutable"
  exit 1
fi

# 3. opencode.json denegados
echo "-> Verificando opencode.json..."
if grep -q '"git push": "deny"' opencode.json; then
  echo "   OK: git push denegado"
else
  echo "   ERROR: git push no está denegado"
  exit 1
fi

if grep -q '"git merge": "deny"' opencode.json; then
  echo "   OK: git merge denegado"
else
  echo "   ERROR: git merge no está denegado"
  exit 1
fi

if grep -q '"gh pr merge": "deny"' opencode.json; then
  echo "   OK: gh pr merge denegado"
else
  echo "   ERROR: gh pr merge no está denegado"
  exit 1
fi

# 4. Plugin factory-guard
echo "-> Verificando plugin factory-guard.js..."
if [ -f .opencode/plugins/factory-guard.js ]; then
  echo "   OK: factory-guard.js existe"
else
  echo "   ERROR: factory-guard.js no existe"
  exit 1
fi

# 5. .gitignore de aislamiento
echo "-> Verificando .gitignore de aislamiento..."
if grep -q "AISLAMIENTO CRÍTICO" .gitignore; then
  echo "   OK: .gitignore tiene reglas de aislamiento"
else
  echo "   ERROR: .gitignore no tiene reglas de aislamiento"
  exit 1
fi

echo ""
echo "=============================================="
echo "  Verificación de Hooks: TODOS PASARON"
echo "=============================================="
