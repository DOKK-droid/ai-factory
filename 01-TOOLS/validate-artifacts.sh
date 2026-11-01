#!/usr/bin/env bash
#
# validate-artifacts.sh — Valida que review-*.md y decision.md tengan formato correcto.
#
# Uso: bash 01-TOOLS/validate-artifacts.sh <job-id> <round>
#
# Qué hace:
#   1. Verifica que cada review-<x>.md (security, ux, ui, code) tenga:
#        - Línea 1: VERDICT: PASS | CHANGES | PASS (n/a)
#        - Línea 2: SCORE: 0-1
#   2. Verifica que decision.md tenga:
#        - Línea 1: APPROVE | CHANGES | ESCALATE
#   3. Retorna código 0 si todo es válido; código 1 si hay algún problema.
#
# Regla: cualquier valor ambiguo → CHANGES / ESCALATE / NEEDS_HUMAN (lado seguro).

set -uo pipefail

JOB_ID="${1:?Uso: bash 01-TOOLS/validate-artifacts.sh <job-id> <round>}"
ROUND="${2:-1}"

F_DIR="factory"; J_DIR="jobs"; JOB_DIR="${F_DIR}/${J_DIR}/${JOB_ID}"
ROUND_DIR="${JOB_DIR}/round-${ROUND}"

FAILURES=0

# ── Validar reviews de los 4 revisores ──────────────────────────────────────
for role in security ux ui code; do
  review_file="${ROUND_DIR}/review-${role}.md"
  if [ ! -f "$review_file" ]; then
    echo "FAIL: falta ${review_file}"
    FAILURES=$((FAILURES + 1))
    continue
  fi
  first_line=$(head -1 "$review_file" | tr -d '\r')
  second_line=$(sed -n '2p' "$review_file" | tr -d '\r')
  if ! echo "$first_line" | grep -qE "^VERDICT: (PASS|CHANGES|PASS \(n/a\))$"; then
    echo "FAIL: ${review_file} línea 1 no tiene VERDICT válido (tiene: ${first_line})"
    FAILURES=$((FAILURES + 1))
  fi
  if ! echo "$second_line" | grep -qE "^SCORE: [0-9](\.[0-9]+)?$"; then
    echo "FAIL: ${review_file} línea 2 no tiene SCORE válido (tiene: ${second_line})"
    FAILURES=$((FAILURES + 1))
  fi
  echo "OK: ${review_file} -> ${first_line} | ${second_line}"
done

# ── Validar decision.md si existe ───────────────────────────────────────────
decision_file="${JOB_DIR}/decision.md"
if [ -f "$decision_file" ]; then
  first_line=$(head -1 "$decision_file" | tr -d '\r')
  if ! echo "$first_line" | grep -qE "^(APPROVE|CHANGES|ESCALATE)$"; then
    echo "FAIL: ${decision_file} línea 1 no tiene decisión válida (tiene: ${first_line})"
    FAILURES=$((FAILURES + 1))
  else
    echo "OK: ${decision_file} -> ${first_line}"
  fi
fi

# ── Resultado ───────────────────────────────────────────────────────────────
if [ "$FAILURES" -eq 0 ]; then
  echo "VALIDACIÓN COMPLETA: todos los artefactos tienen formato correcto"
  exit 0
else
  echo "VALIDACIÓN FALLÓ: ${FAILURES} problema(s) encontrado(s)"
  exit 1
fi
