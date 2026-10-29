# Hook: branch-guard
# Protege main y exige worktree limpio desde main
# Ubicado en: .hooks/branch-guard.sh

#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:?Falta nombre de branch}"

if [ "${BRANCH}" = "main" ] || [ "${BRANCH}" = "master" ]; then
  echo "ERROR: No se permite trabajar directamente sobre ${BRANCH}. Usar worktree/branch propia."
  exit 1
fi

# Verificar que no haya cambios sin commitear en main
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  echo "WARN: Hay cambios sin commitear. Se recomienda hacer stash o commit antes de continuar."
fi

echo "OK: Branch ${BRANCH} autorizada para worktree."
exit 0
