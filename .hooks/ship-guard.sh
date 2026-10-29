# Hook: ship-guard
# Bloquea merge a main sin aprobacion del human-gate
# Ubicado en: .hooks/ship-guard.sh

#!/usr/bin/env bash
set -euo pipefail

JOB_ID="${1:?Falta ID de job}"
JOB_DIR="factory/jobs/${JOB_ID}"

if [ ! -f "${JOB_DIR}/human.md" ]; then
  echo "ERROR: No existe human.md. El human-gate no ha evaluado el job."
  exit 1
fi

if grep -q "^FAST_PATH" "${JOB_DIR}/human.md" 2>/dev/null; then
  echo "OK: Fast path habilitado. Merge permitido."
  exit 0
fi

if grep -q "^NEEDS_HUMAN" "${JOB_DIR}/human.md" 2>/dev/null; then
  echo "ERROR: El job requiere revision humana (NEEDS_HUMAN). Merge bloqueado."
  exit 1
fi

echo "ERROR: Estado de human.md no reconocido para el job ${JOB_ID}."
exit 1
