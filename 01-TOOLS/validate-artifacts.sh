#!/usr/bin/env bash
# validate-artifacts.sh — Valida el FORMATO de review-*.md y decision.md (no su veracidad).
# Uso: bash 01-TOOLS/validate-artifacts.sh <job-id> [round]     (round por defecto: el ultimo)
#   review-<x>.md (security, ux, ui, code): linea 1 `VERDICT: PASS|CHANGES|PASS (n/a)`, linea 2 `SCORE: 0..1`
#   decision.md (si existe): linea 1 `APPROVE|CHANGES|ESCALATE`
# VALIDATE_REVIEWS_ONLY=1 omite decision.md (next-step.sh y launch-reviewers.sh solo quieren validar los reviews).
# Los archivos `.commit` y las lineas extra de gate.md (COMMIT, GATE_FAIL_STREAK) no se validan aqui.
# Sale 0 solo si TODO es valido. Un valor ambiguo se trata como invalido (lado seguro).
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

JOB_ID="${1:?Uso: bash 01-TOOLS/validate-artifacts.sh <job-id> [round]}"
JOB_DIR="$(factory_jobs_dir)/${JOB_ID}"
if [ -n "${2:-}" ]; then ROUND_DIR="${JOB_DIR}/round-${2}"
else ROUND_DIR="$(ls -d "${JOB_DIR}"/round-* 2>/dev/null | sort -V | tail -1)"; fi
[ -n "${ROUND_DIR:-}" ] && [ -d "$ROUND_DIR" ] || { echo "FAIL: no hay round en ${JOB_DIR}"; exit 1; }

FAILURES=0
for role in security ux ui code; do
  f="${ROUND_DIR}/review-${role}.md"
  if [ ! -f "$f" ]; then echo "FAIL: falta ${f}"; FAILURES=$((FAILURES + 1)); continue; fi
  l1="$(head -1 "$f" | tr -d '\r')"; l2="$(sed -n '2p' "$f" | tr -d '\r')"; bad=0
  printf '%s\n' "$l1" | grep -qE '^VERDICT: (PASS|CHANGES|PASS \(n/a\))$' || { echo "FAIL: ${f} linea 1 sin VERDICT valido (tiene: ${l1})"; bad=1; }
  printf '%s\n' "$l2" | grep -qE '^SCORE: (0(\.[0-9]+)?|1(\.0+)?)$'      || { echo "FAIL: ${f} linea 2 sin SCORE entre 0 y 1 (tiene: ${l2})"; bad=1; }
  if [ "$bad" -eq 0 ]; then echo "OK: ${f} -> ${l1} | ${l2}"; else FAILURES=$((FAILURES + 1)); fi
done

d="${JOB_DIR}/decision.md"
if [ -f "$d" ] && [ "${VALIDATE_REVIEWS_ONLY:-0}" != "1" ]; then
  l1="$(head -1 "$d" | tr -d '\r')"
  if printf '%s\n' "$l1" | grep -qE '^(APPROVE|CHANGES|ESCALATE)$'; then echo "OK: ${d} -> ${l1}"
  else echo "FAIL: ${d} linea 1 sin decision valida (tiene: ${l1})"; FAILURES=$((FAILURES + 1)); fi
fi

if [ "$FAILURES" -eq 0 ]; then echo "VALIDACION COMPLETA: formato correcto"; exit 0; fi
echo "VALIDACION FALLO: ${FAILURES} problema(s)"; exit 1
