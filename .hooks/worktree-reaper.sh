# Hook: worktree-reaper
# Limpia worktrees huorfanos despues de cerrar un job
# Ubicado en: .hooks/worktree-reaper.sh

#!/usr/bin/env bash
set -euo pipefail

JOB_ID="${1:?Falta ID de job}"

# Listar worktrees y buscar los asociados al job
WT_LIST=$(git worktree list 2>/dev/null || true)

if echo "${WT_LIST}" | grep -q "${JOB_ID}"; then
  echo "Limpiando worktree asociado al job ${JOB_ID}..."
  git worktree remove --force "factory/worktrees/${JOB_ID}" 2>/dev/null || true
  echo "OK: Worktree limpiado."
else
  echo "No hay worktree huorfano para el job ${JOB_ID}."
fi

exit 0
