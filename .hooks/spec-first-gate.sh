#!/usr/bin/env bash
# spec-first-gate: el Builder no inicia sin un spec valido (Surface, criterios numerados y Alcance).
# Uso: spec-first-gate.sh <job-id>
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../01-TOOLS/lib.sh"
JOB_ID="${1:?Falta ID de job}"
SPEC="$(factory_jobs_dir)/${JOB_ID}/spec.md"
SCOPE_JS="$(dirname "${BASH_SOURCE[0]}")/../factory/scripts/scope-check.mjs"
[ -f "$SPEC" ] || { echo "ERROR: no existe spec.md para el job ${JOB_ID}." >&2; exit 1; }
grep -Eq '^Surface:[[:space:]]*(page|none)[[:space:]]*$' "$SPEC" || { echo "ERROR: spec.md necesita la linea 'Surface: page' o 'Surface: none'." >&2; exit 1; }
grep -Eq '^[[:space:]]*[0-9]+[.)]' "$SPEC" || { echo "ERROR: spec.md no tiene criterios de aceptacion numerados." >&2; exit 1; }
if ! OUT="$(node "$SCOPE_JS" check "$SPEC" </dev/null)"; then
  echo "ERROR: spec.md necesita una seccion 'Alcance:' con las rutas que el job puede tocar (no '**'). ${OUT}" >&2; exit 1
fi
echo "OK: spec valido para ${JOB_ID}."
