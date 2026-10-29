# Hook: spec-first-gate
# Evita que el Builder inicie sin un Spec aprobado en el job
# Ubicado en: .hooks/spec-first-gate.sh

#!/usr/bin/env bash
set -euo pipefail

JOB_ID="${1:?Falta ID de job}"
JOB_DIR="factory/jobs/${JOB_ID}"

if [ ! -f "${JOB_DIR}/spec.md" ]; then
  echo "ERROR: No existe spec.md para el job ${JOB_ID}. El Builder no puede iniciar sin Spec."
  exit 1
fi

if ! grep -q "^Surface: " "${JOB_DIR}/spec.md" 2>/dev/null; then
  echo "ERROR: spec.md no tiene la linea 'Surface: page | none' requerida."
  exit 1
fi

echo "OK: Spec presente y valido para el job ${JOB_ID}"
exit 0
