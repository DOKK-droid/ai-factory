#!/usr/bin/env bash
# ship-guard: solo permite el camino rapido (merge sin humano) si TODO se cumple:
#   fast_path.enabled=true en la config, decision.md = APPROVE y human.md = FAST_PATH.
# Uso: ship-guard.sh <job-id>   Salida 0 = permitido, 1 = bloqueado.
set -euo pipefail
JOB_ID="${1:?Falta ID de job}"
JOB_DIR="${FACTORY_JOBS_DIR:-factory/jobs}/${JOB_ID}"
CONFIG="${FACTORY_CONFIG:-factory/config.json}"
first() { grep -m1 -v '^[[:space:]]*$' "$1" 2>/dev/null | sed 's/\r$//; s/[[:space:]]*$//' || true; }

[ -f "${JOB_DIR}/human.md" ] || { echo "ERROR: no existe human.md; el human-gate no evaluo el job." >&2; exit 1; }
ENABLED="$(node -p "try{(JSON.parse(require('fs').readFileSync('$CONFIG','utf8')).fast_path||{}).enabled===true}catch(e){false}" 2>/dev/null || echo false)"
[ "$ENABLED" = "true" ] || { echo "ERROR: fast_path desactivado en la config. Requiere PR y aprobacion humana." >&2; exit 1; }
[ "$(first "${JOB_DIR}/decision.md")" = "APPROVE" ] || { echo "ERROR: decision.md no es APPROVE." >&2; exit 1; }
case "$(first "${JOB_DIR}/human.md")" in
  FAST_PATH) echo "OK: FAST_PATH permitido para ${JOB_ID}."; exit 0 ;;
  NEEDS_HUMAN) echo "ERROR: el job requiere revision humana (NEEDS_HUMAN)." >&2; exit 1 ;;
  *) echo "ERROR: estado de human.md no reconocido." >&2; exit 1 ;;
esac
