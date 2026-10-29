#!/usr/bin/env bash
# risk.sh - Human-gate determinista
# Evalúa criterios de riesgo y escribe human.md con FAST_PATH o NEEDS_HUMAN
# Uso: bash 01-TOOLS/risk.sh <job-id>
set -euo pipefail

JOB_ID="${1:?Falta ID de job}"
JOB_DIR="factory/jobs/${JOB_ID}"
CONFIG="factory/config.json"

if [ ! -d "${JOB_DIR}" ]; then
  echo "ERROR: Job ${JOB_ID} no existe en ${JOB_DIR}"
  exit 1
fi

# Leer configuración con node (solo valores flotantes)
MAX_DIFF_LINES=$(node -e "console.log(require('./${CONFIG}').max_diff_lines || 400)" 2>/dev/null || echo 400)
MIN_SCORE=$(node -e "console.log(require('./${CONFIG}').fast_path.min_score || 0.85)" 2>/dev/null || echo 0.85)
FAST_PATH_ENABLED=$(node -e "console.log(require('./${CONFIG}').fast_path.enabled || false)" 2>/dev/null || echo false)

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
RISKS=()
EVIDENCES=()

# Helper: comparar score < min_score usando node (para flotantes)
score_below_min() {
  local score="$1"
  node -e "console.log(parseFloat('${score}') < parseFloat('${MIN_SCORE}') ? 'yes' : 'no')" 2>/dev/null || echo "no"
}

# 1. Verificar decision.md del approver
if [ -f "${JOB_DIR}/decision.md" ]; then
  DECISION=$(head -1 "${JOB_DIR}/decision.md" 2>/dev/null || echo "")
  if [ "${DECISION}" = "CHANGES" ] || [ "${DECISION}" = "ESCALATE" ]; then
    RISKS+=("approver_devolvio_cambios")
    EVIDENCES+=("Aprobador devolvió: ${DECISION}")
  fi
fi

# 2. Verificar scores de los 4 revisores
for reviewer in security ux ui code; do
  REVIEW_FILE=$(ls "${JOB_DIR}"/round-*/review-${reviewer}.md 2>/dev/null | head -1)
  if [ -f "${REVIEW_FILE}" ]; then
    SCORE=$(grep "^SCORE:" "${REVIEW_FILE}" 2>/dev/null | awk '{print $2}' || echo "0")
    VERDICT=$(head -1 "${REVIEW_FILE}" 2>/dev/null || echo "")
    # Comparar score < min_score usando node para flotantes
    if [ "$(score_below_min "${SCORE}")" = "yes" ]; then
      RISKS+=("score_bajo_${reviewer}")
      EVIDENCES+=("${reviewer}: score ${SCORE} < ${MIN_SCORE}")
    fi
    # Verificar veredictos contradictorios
    if [ "${VERDICT}" = "CHANGES" ]; then
      RISKS+=("reviewer_changes_${reviewer}")
      EVIDENCES+=("${reviewer}: veredicto CHANGES")
    fi
  fi
done

# 3. Verificar diff > max_diff_lines (entero con bash)
DIFF_LINES=0
if [ -f "${JOB_DIR}/build.md" ]; then
  DIFF_LINES=$(grep -c "^[+-]" "${JOB_DIR}/build.md" 2>/dev/null || echo 0)
  DIFF_LINES=${DIFF_LINES:-0}
  # Asegurar que es un entero limpio
  DIFF_LINES=$(echo "${DIFF_LINES}" | tr -cd '0-9')
  DIFF_LINES=${DIFF_LINES:-0}
fi
if [ "${DIFF_LINES}" -gt "${MAX_DIFF_LINES}" ] 2>/dev/null; then
  RISKS+=("diff_excede_limite")
  EVIDENCES+=("Diff: ${DIFF_LINES} líneas > ${MAX_DIFF_LINES} máximo")
fi

# 4. Verificar rutas sensibles (auth, pagos, datos personales, migraciones, CI)
SENSITIVE_PATTERNS="auth|payment|pago|migraci|migration|ci/|\.github/workflows|deploy|despliegue|personal|datos"
SENSITIVE_FILES=0
if [ -f "${JOB_DIR}/build.md" ]; then
  SENSITIVE_FILES=$(grep -ciE "${SENSITIVE_PATTERNS}" "${JOB_DIR}/build.md" 2>/dev/null || echo 0)
  SENSITIVE_FILES=${SENSITIVE_FILES:-0}
fi
if [ "${SENSITIVE_FILES}" -gt 0 ] 2>/dev/null; then
  RISKS+=("rutas_sensibles")
  EVIDENCES+=("Archivos sensibles detectados: auth/pagos/migraciones/CI/despliegue")
fi

# 5. Verificar dependencias nuevas
NEW_DEPS=0
if [ -f "${JOB_DIR}/build.md" ]; then
  NEW_DEPS=$(grep -ciE "npm install|package\.json|add.*dependenc" "${JOB_DIR}/build.md" 2>/dev/null || echo 0)
  NEW_DEPS=${NEW_DEPS:-0}
fi
if [ "${NEW_DEPS}" -gt 0 ] 2>/dev/null; then
  RISKS+=("nuevas_dependencias")
  EVIDENCES+=("Se detectaron nuevas dependencias en build.md")
fi

# 6. Verificar tests modificados para hacerlos pasar
TESTS_MODIFIED=0
if [ -f "${JOB_DIR}/build.md" ]; then
  TESTS_MODIFIED=$(grep -ciE "test.*pasar|hacer.*pasar|test.*modify|modificar.*test" "${JOB_DIR}/build.md" 2>/dev/null || echo 0)
  TESTS_MODIFIED=${TESTS_MODIFIED:-0}
fi
if [ "${TESTS_MODIFIED}" -gt 0 ] 2>/dev/null; then
  RISKS+=("tests_modificados")
  EVIDENCES+=("Se detectaron pruebas modificadas posiblemente para hacerlas pasar")
fi

# 7. Verificar reviewers en desacuerdo
VERDICTS=()
for reviewer in security ux ui code; do
  REVIEW_FILE=$(ls "${JOB_DIR}"/round-*/review-${reviewer}.md 2>/dev/null | head -1)
  if [ -f "${REVIEW_FILE}" ]; then
    V=$(head -1 "${REVIEW_FILE}" 2>/dev/null || echo "")
    VERDICTS+=("${V}")
  fi
done
# Si hay al menos un PASS y un CHANGES, hay desacuerdo
HAS_PASS=0
HAS_CHANGES=0
for V in "${VERDICTS[@]}"; do
  if [ "${V}" = "PASS" ] || [ "${V}" = "PASS (n/a)" ]; then HAS_PASS=1; fi
  if [ "${V}" = "CHANGES" ]; then HAS_CHANGES=1; fi
done
if [ "${HAS_PASS}" -eq 1 ] && [ "${HAS_CHANGES}" -eq 1 ]; then
  RISKS+=("reviewers_en_desacuerdo")
  EVIDENCES+=("Reviewers con veredictos contradictorios: PASS y CHANGES")
fi

# Decisión final
if [ ${#RISKS[@]} -gt 0 ]; then
  RESULT="NEEDS_HUMAN"
else
  if [ "${FAST_PATH_ENABLED}" = "true" ]; then
    RESULT="FAST_PATH"
  else
    RESULT="NEEDS_HUMAN"
  fi
fi

# Escribir human.md
cat > "${JOB_DIR}/human.md" << EOFHUMAN
# Decisión del Human-Gate

Fecha: ${NOW}
Job: ${JOB_ID}

## Resultado

${RESULT}

## Riesgos detectados

EOFHUMAN

if [ ${#RISKS[@]} -gt 0 ]; then
  for i in "${!RISKS[@]}"; do
    echo "- ${RISKS[$i]}: ${EVIDENCES[$i]}" >> "${JOB_DIR}/human.md"
  done
else
  echo "- Ninguno. Todos los criterios de riesgo pasaron." >> "${JOB_DIR}/human.md"
fi

cat >> "${JOB_DIR}/human.md" << EOFHUMAN

## Evidencias

EOFHUMAN

if [ ${#EVIDENCES[@]} -gt 0 ]; then
  for i in "${!EVIDENCES[@]}"; do
    echo "- ${EVIDENCES[$i]}" >> "${JOB_DIR}/human.md"
  done
else
  echo "- Sin evidencias de riesgo." >> "${JOB_DIR}/human.md"
fi

cat >> "${JOB_DIR}/human.md" << EOFHUMAN

## Checklist de revisión

- [ ] Verificar que el diff no excede ${MAX_DIFF_LINES} líneas
- [ ] Confirmar que no hay cambios en auth, pagos o datos personales
- [ ] Verificar que no hay migraciones de base de datos
- [ ] Confirmar que no hay cambios en CI/infra/despliegue
- [ ] Revisar que no hay dependencias nuevas sin aprobación
- [ ] Verificar que los tests no se modificaron solo para hacerlos pasar
- [ ] Confirmar scores de revisores >= ${MIN_SCORE}
- [ ] Verificar que no hay desacuerdo entre revisores

## Decisión

**${RESULT}**

Si es NEEDS_HUMAN: preparar resumen claro con evidencias y obtener aprobación humana antes de merge.
Si es FAST_PATH: solo si fast_path.enabled=true, CI verde y branch protection lo permiten.
EOFHUMAN

echo "Human-gate: ${RESULT}"
echo "Escrito en: ${JOB_DIR}/human.md"
exit 0
