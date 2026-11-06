#!/usr/bin/env bash
# commit-brain.sh — commitea en la worktree del job SOLO la documentacion que escribio el memory-curator, para que
# viaje en el PR del job (revisable por el humano) sin invalidar el gate ni los reviews (ver factory_commit_fresh).
# Uso (desde la worktree del job):  bash 01-TOOLS/commit-brain.sh <job-id>
# Solo acepta cambios en FACTORY_CURATOR_PATHS (lib.sh). Cualquier otro cambio pendiente => error y no commitea nada.
# Modo base documental:             bash 01-TOOLS/commit-brain.sh <job-id> --project [BR-n]
# Solo acepta cambios en 02-DOCS/wiki/project/ y 02-DOCS/wiki/sdd/decisions.md. Con BR-n, el commit lleva la linea
# `Brain-Request: BR-n`, que es lo que next-step.sh toma como "peticion aplicada" (ver factory/scripts/brain-request.mjs).
# Salida: 0 = commit hecho o nada que commitear; 1 = error (rama distinta, cambios ajenos...)
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

JOB_ID="${1:?Uso: commit-brain.sh <job-id> [--project [BR-n]]}"
MODE=curator; BR=""
if [ "${2:-}" = "--project" ]; then
  MODE=project; BR="${3:-}"
  [ -z "$BR" ] || [[ "$BR" =~ ^BR-[0-9]+$ ]] || { echo "ERROR: la peticion debe ser BR-n (tiene: ${BR})" >&2; exit 1; }
  [ "$#" -le 3 ] || { echo "ERROR: demasiados argumentos" >&2; exit 1; }
elif [ "$#" -gt 1 ]; then echo "ERROR: argumento desconocido: ${2} (se admite --project [BR-n])" >&2; exit 1; fi
if [ "$MODE" = project ]; then ALLOWED=(02-DOCS/wiki/project 02-DOCS/wiki/sdd/decisions.md); else ALLOWED=("${FACTORY_CURATOR_PATHS[@]}"); fi
[[ "$JOB_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$ ]] && [[ "$JOB_ID" != *..* ]] || { echo "ERROR: job-id invalido" >&2; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "ERROR: no es un repositorio git" >&2; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "factory/${JOB_ID}" ] || { echo "ERROR: ejecuta esto desde la worktree del job (rama factory/${JOB_ID})" >&2; exit 1; }

mapfile -d '' -t ENTRIES < <(git status --porcelain=v1 -z --untracked-files=all)
[ "${#ENTRIES[@]}" -gt 0 ] || { echo "Nada que commitear."; exit 0; }
BAD=(); OK=()
for e in "${ENTRIES[@]}"; do
  f="${e:3}"; allowed=0
  for c in "${ALLOWED[@]}"; do [ "$f" = "$c" ] || [[ "$f" == "$c"/* ]] && { allowed=1; break; }; done
  if [ "$allowed" -eq 1 ]; then OK+=("$f"); else BAD+=("$f"); fi
done
if [ "${#BAD[@]}" -gt 0 ]; then
  if [ "$MODE" = project ]; then echo "ERROR: hay cambios pendientes fuera de la base documental (02-DOCS/wiki/project/ y decisions.md); no commiteo nada:" >&2
  else echo "ERROR: hay cambios pendientes fuera de la documentacion del curator; no commiteo nada:" >&2; fi
  printf '  %s\n' "${BAD[@]:0:10}" >&2; exit 1
fi
git add -- "${OK[@]}" || exit 1
if [ "$MODE" = project ]; then
  if [ -n "$BR" ]; then MSG="docs(project): aplica la peticion ${BR} del job ${JOB_ID}"$'\n\n'"Brain-Request: ${BR}"
  else MSG="docs(project): alinea y aprueba la base documental del job ${JOB_ID}"; fi
else MSG="docs(brain): documentacion del job ${JOB_ID}"; fi
git commit -q -m "$MSG" || { echo "ERROR: git commit fallo" >&2; exit 1; }
echo "OK commit $(git rev-parse --short HEAD): ${OK[*]}"
