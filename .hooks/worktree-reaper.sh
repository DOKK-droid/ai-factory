#!/usr/bin/env bash
# worktree-reaper: limpia la worktree de un job cerrado. NO borra trabajo sin commitear
# salvo FACTORY_FORCE=1. Nunca toca la worktree principal. Uso: worktree-reaper.sh <job-id>
set -euo pipefail
JOB_ID="${1:?Falta ID de job}"
MAIN="$(git rev-parse --show-toplevel)"
FOUND=0
FF=""; [ "${FACTORY_FORCE:-0}" = "1" ] && FF="--force"
while IFS= read -r wt; do
  [ "$wt" = "$MAIN" ] && continue
  case "$wt" in *"$JOB_ID"*) ;; *) continue ;; esac
  FOUND=1
  if [ "${FACTORY_FORCE:-0}" != "1" ] && [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
    echo "AVISO: ${wt} tiene cambios sin commitear; no se borra (usa FACTORY_FORCE=1)." >&2; continue
  fi
  git worktree remove $FF "$wt" && echo "OK: worktree ${wt} eliminada."
done < <(git worktree list --porcelain | sed -n 's/^worktree //p')
[ "$FOUND" -eq 1 ] || echo "No hay worktree para el job ${JOB_ID}."
