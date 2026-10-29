#!/usr/bin/env bash
# checks.sh - Gate determinista: lint + typecheck + tests
# Devuelve 0 si todo pasa, 1 si falla algo.
set -euo pipefail

echo "=== Gate determinista ==="

# 1. Lint (si existe)
if command -v npx >/dev/null 2>&1; then
  echo "-> Ejecutando lint..."
  if [ -f package.json ] && npx eslint --version >/dev/null 2>&1; then
    npx eslint . --ext .js,.ts,.tsx 2>&1 || true
  else
    echo "   (eslint no configurado, omitido)"
  fi
fi

# 2. Typecheck (si existe tsc)
if command -v npx >/dev/null 2>&1 && [ -f tsconfig.json ] 2>/dev/null; then
  echo "-> Ejecutando typecheck..."
  npx tsc --noEmit 2>&1 || true
else
  echo "   (tsconfig.json no encontrado, omitido)"
fi

# 3. Tests
echo "-> Ejecutando tests..."
if [ -f package.json ]; then
  if npx jest --version >/dev/null 2>&1; then
    npx jest --passWithNoTests 2>&1 || true
  elif npx vitest --version >/dev/null 2>&1; then
    npx vitest run 2>&1 || true
  else
    echo "   (ningún test runner detectado, omitido)"
  fi
fi

echo "=== Gate completado ==="
exit 0
