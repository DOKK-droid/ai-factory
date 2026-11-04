#!/usr/bin/env bash
# commit-brain.sh — commitea en la worktree del job SOLO la documentacion que escribio el memory-curator, para que
# viaje en el PR del job (revisable por el humano) sin invalidar el gate ni los reviews (ver factory_commit_fresh).
# Uso (desde la worktree del job):  bash 01-TOOLS/commit-brain.sh <job-id>
# Solo acepta cambios en FACTORY_CURATOR_PATHS (lib.sh). Cualquier otro cambio pendiente => error y no commitea nada.
# Salida: 0 = commit hecho o nada que commitear; 1 = error (rama distinta, cambios ajenos...)
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

JOB_ID="${1:?Uso: commit-brain.sh <job-id>}"
[[ "$JOB_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$ ]] && [[ "$JOB_ID" != *..* ]] || { echo "ERROR: job-id invalido" >&2; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "ERROR: no es un repositorio git" >&2; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "factory/${JOB_ID}" ] || { echo "ERROR: ejecuta esto desde la worktree del job (rama factory/${JOB_ID})" >&2; exit 1; }

mapfile -d '' -t ENTRIES < <(git status --porcelain=v1 -z --untracked-files=all)
[ "${#ENTRIES[@]}" -gt 0 ] || { echo "Nada que commitear."; exit 0; }
BAD=(); OK=()
for e in "${ENTRIES[@]}"; do
  f="${e:3}"; allowed=0
  for c in "${FACTORY_CURATOR_PATHS[@]}"; do [ "$f" = "$c" ] || [[ "$f" == "$c"/* ]] && { allowed=1; break; }; done
  if [ "$allowed" -eq 1 ]; then OK+=("$f"); else BAD+=("$f"); fi
done
if [ "${#BAD[@]}" -gt 0 ]; then
  echo "ERROR: hay cambios pendientes fuera de la documentacion del curator; no commiteo nada:" >&2
  printf '  %s\n' "${BAD[@]:0:10}" >&2; exit 1
fi
git add -- "${OK[@]}" || exit 1
git commit -q -m "docs(brain): documentacion del job ${JOB_ID}" || { echo "ERROR: git commit fallo" >&2; exit 1; }
echo "OK commit $(git rev-parse --short HEAD): ${OK[*]}"
