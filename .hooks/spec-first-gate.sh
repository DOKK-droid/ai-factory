#!/usr/bin/env bash
# spec-first-gate: el Builder no inicia sin un spec valido. Uso: spec-first-gate.sh <job-id>
set -euo pipefail
JOB_ID="${1:?Falta ID de job}"
SPEC="${FACTORY_JOBS_DIR:-factory/jobs}/${JOB_ID}/spec.md"
[ -f "$SPEC" ] || { echo "ERROR: no existe spec.md para el job ${JOB_ID}." >&2; exit 1; }
grep -Eq '^Surface:[[:space:]]*(page|none)[[:space:]]*$' "$SPEC" || { echo "ERROR: spec.md necesita la linea 'Surface: page' o 'Surface: none'." >&2; exit 1; }
grep -Eq '^[[:space:]]*[0-9]+[.)]' "$SPEC" || { echo "ERROR: spec.md no tiene criterios de aceptacion numerados." >&2; exit 1; }
echo "OK: spec valido para ${JOB_ID}."
