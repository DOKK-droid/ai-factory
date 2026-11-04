#!/usr/bin/env bash
# new-job.sh — crea la worktree AISLADA de un job. El builder trabaja y commitea SOLO alli.
# Uso (desde el checkout principal):  bash 01-TOOLS/new-job.sh <job-id>
#   -> rama factory/<job-id>, worktree factory/worktrees/<job-id> (ignorada por git),
#      carpeta de jobs factory/jobs/<job-id> y job.json.
# La worktree se crea desde la rama BASE (origin/<base> si existe), NUNCA desde tu directorio de trabajo:
# lo que tengas sin commitear en el checkout principal no puede colarse en el job.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

JOB_ID="${1:?Uso: new-job.sh <job-id>}"
[[ "$JOB_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$ ]] && [[ "$JOB_ID" != *..* ]] || { echo "ERROR: job-id invalido (letras, numeros, . _ -)" >&2; exit 2; }

ROOT="$(factory_main_root)" || { echo "ERROR: no es un repositorio git" >&2; exit 1; }
# Comprobar ANTES de cambiar de carpeta: si se invoca desde una worktree, git-dir != git-common-dir
if [ "$(git rev-parse --path-format=absolute --git-dir)" != "$(git rev-parse --path-format=absolute --git-common-dir)" ]; then
  echo "ERROR: ejecuta new-job.sh desde el checkout principal (${ROOT}), no desde una worktree" >&2; exit 1
fi
cd "$ROOT"

BASE="${FACTORY_BASE:-$(factory_cfg 'c.base_branch' main)}"
git fetch -q origin "$BASE" 2>/dev/null || echo "AVISO: no pude hacer fetch de origin/${BASE}; se usa la rama local"
BASE_REF=""
for cand in "origin/${BASE}" "$BASE"; do
  if git rev-parse --verify -q "${cand}^{commit}" >/dev/null; then BASE_REF="$cand"; break; fi
done
[ -n "$BASE_REF" ] || { echo "ERROR: no existe la rama base ${BASE}" >&2; exit 1; }

BRANCH="factory/${JOB_ID}"
WT="${ROOT}/factory/worktrees/${JOB_ID}"
[ ! -e "$WT" ] || { echo "ERROR: ya existe ${WT}" >&2; exit 1; }
if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then echo "ERROR: ya existe la rama ${BRANCH}" >&2; exit 1; fi
[ -z "$(git status --porcelain)" ] || echo "AVISO: tu checkout principal tiene cambios sin commitear; NO pasan al job (la worktree sale de ${BASE_REF})"

git worktree add -q -b "$BRANCH" "$WT" "$BASE_REF"
JOB_DIR="$(factory_jobs_dir)/${JOB_ID}"
mkdir -p "$JOB_DIR"
node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({id:process.argv[2],branch:process.argv[3],worktree:process.argv[4],base:process.argv[5],created:new Date().toISOString()},null,2)+'\n')" \
  "$JOB_DIR/job.json" "$JOB_ID" "$BRANCH" "$WT" "$BASE_REF"

echo "OK job ${JOB_ID}"
echo "  rama:     ${BRANCH} (desde ${BASE_REF})"
echo "  worktree: ${WT}"
echo "  jobs:     ${JOB_DIR}"
echo "  siguiente: trabaja DENTRO de la worktree; commitea alli; luego: bash 01-TOOLS/checks.sh ${JOB_ID}"
