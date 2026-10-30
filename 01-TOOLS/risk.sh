#!/usr/bin/env bash
# risk.sh — Human-gate DETERMINISTA. Escribe factory/jobs/<id>/human.md
# (primera linea: FAST_PATH o NEEDS_HUMAN).
# Uso (desde la worktree del job): bash 01-TOOLS/risk.sh <job-id>
#
# Principios: falla cerrado (cualquier dato ausente o ambiguo => NEEDS_HUMAN), usa el
# ULTIMO round, y calcula diff/rutas/dependencias/tests con `git diff` real, no con
# lo que el builder cuente en build.md.
#
# Variables opcionales: FACTORY_JOBS_DIR, FACTORY_CONFIG, FACTORY_BASE (rama base), FACTORY_HEAD
set -uo pipefail

JOB_ID="${1:?Uso: risk.sh <job-id>}"
JOBS_DIR="${FACTORY_JOBS_DIR:-factory/jobs}"
CONFIG="${FACTORY_CONFIG:-factory/config.json}"
JOB_DIR="${JOBS_DIR}/${JOB_ID}"
HEAD_REF="${FACTORY_HEAD:-HEAD}"

[ -d "$JOB_DIR" ] || { echo "ERROR: el job ${JOB_ID} no existe en ${JOB_DIR}" >&2; exit 2; }

cfg() { # cfg <expresion js sobre c> <defecto>
  node -p "try{const c=JSON.parse(require('fs').readFileSync('$CONFIG','utf8'));const v=($1);v===undefined||v===null?'$2':v}catch(e){'$2'}" 2>/dev/null || echo "$2"
}
MAX_DIFF_LINES="$(cfg 'c.max_diff_lines' 400)"
MIN_SCORE="$(cfg '(c.fast_path||{}).min_score' 0.85)"
FAST_PATH_ENABLED="$(cfg '(c.fast_path||{}).enabled' false)"
BASE_REF="${FACTORY_BASE:-$(cfg 'c.base_branch' main)}"

RISKS=(); EVID=()
add() { RISKS+=("$1"); EVID+=("$2"); }
trim() { sed 's/\r$//; s/^[[:space:]]*//; s/[[:space:]]*$//'; }

# ---------- 1. Reviews del ULTIMO round ----------
LAST_ROUND="$(ls -d "${JOB_DIR}"/round-* 2>/dev/null | sort -V | tail -1 || true)"
SURFACE="$(sed -n 's/^Surface:[[:space:]]*//p' "${JOB_DIR}/spec.md" 2>/dev/null | head -1 | trim)"
HAS_PASS=0; HAS_CHANGES=0
if [ -z "$LAST_ROUND" ]; then
  add "sin_reviews" "No hay ningun round-N con reviews"
else
  for r in security ux ui code; do
    f="${LAST_ROUND}/review-${r}.md"
    if [ ! -f "$f" ]; then add "review_faltante_${r}" "Falta ${f}"; continue; fi
    verdict="$(sed -n 's/^VERDICT:[[:space:]]*//p' "$f" | head -1 | trim)"
    score="$(sed -n 's/^SCORE:[[:space:]]*//p' "$f" | head -1 | trim)"
    case "$verdict" in
      PASS) HAS_PASS=1 ;;
      "PASS (n/a)") HAS_PASS=1
        [ "$SURFACE" = "page" ] && add "na_con_superficie_${r}" "${r} marco n/a pero el spec dice Surface: page" ;;
      CHANGES) HAS_CHANGES=1; add "reviewer_changes_${r}" "${r}: VERDICT CHANGES" ;;
      *) add "verdict_invalido_${r}" "${r}: veredicto '${verdict}' no reconocido" ;;
    esac
    if [ "$verdict" != "PASS (n/a)" ]; then
      if ! printf '%s' "$score" | grep -Eq '^(0(\.[0-9]+)?|1(\.0+)?)$'; then
        add "score_invalido_${r}" "${r}: SCORE '${score}' ausente o invalido"
      elif awk -v s="$score" -v m="$MIN_SCORE" 'BEGIN{exit !(s<m)}'; then
        add "score_bajo_${r}" "${r}: score ${score} < ${MIN_SCORE}"
      fi
    fi
  done
  [ "$HAS_PASS" -eq 1 ] && [ "$HAS_CHANGES" -eq 1 ] && add "reviewers_en_desacuerdo" "Hay reviewers en PASS y otros en CHANGES"
fi

# ---------- 2. Decision del approver y gate ----------
DECISION="$(grep -m1 -v '^[[:space:]]*$' "${JOB_DIR}/decision.md" 2>/dev/null | trim || true)"
[ "$DECISION" = "APPROVE" ] || add "approver_no_aprueba" "decision.md: '${DECISION:-ausente}' (se exige APPROVE)"
GATE="$(grep -m1 -v '^[[:space:]]*$' "${JOB_DIR}/gate.md" 2>/dev/null | trim || true)"
[ "$GATE" = "GATE: PASS" ] || add "gate_no_pasa" "gate.md: '${GATE:-ausente}' (se exige GATE: PASS)"

# ---------- 3. Diff real ----------
BASE_OK=""
for cand in "$BASE_REF" "origin/${BASE_REF}"; do
  if git rev-parse --verify -q "${cand}^{commit}" >/dev/null 2>&1; then BASE_OK="$cand"; break; fi
done
if [ -z "$BASE_OK" ] || ! git rev-parse --verify -q "${HEAD_REF}^{commit}" >/dev/null 2>&1; then
  add "diff_no_disponible" "No pude calcular el diff (base='${BASE_REF}', head='${HEAD_REF}')"
else
  NUMSTAT="$(git diff --numstat "${BASE_OK}...${HEAD_REF}" 2>/dev/null || true)"
  FILES="$(printf '%s\n' "$NUMSTAT" | awk 'NF>=3{print $3}')"
  DIFF_LINES="$(printf '%s\n' "$NUMSTAT" | awk 'NF>=3{ if($1!="-") a+=$1; if($2!="-") d+=$2 } END{print a+d+0}')"
  [ -z "$FILES" ] && add "diff_vacio" "El diff contra ${BASE_OK} esta vacio"
  [ "$DIFF_LINES" -gt "$MAX_DIFF_LINES" ] && add "diff_excede_limite" "Diff: ${DIFF_LINES} lineas > ${MAX_DIFF_LINES}"

  SENS_RE='(^|/)(auth|authn|authz|login|session|oauth|payments?|billing|checkout|pagos?|migrations?|migraci[oó]n|secrets?|credentials?)([/._-]|$)|\.github/workflows|(^|/)ci/|(^|/)deploy|dockerfile|docker-compose|terraform|\.tf$|(^|/)(helm|k8s|kubernetes|infra)(/|$)|(^|/)\.env'
  S="$(printf '%s\n' "$FILES" | grep -Ei "$SENS_RE" | head -5 | paste -sd, - || true)"
  [ -n "$S" ] && add "rutas_sensibles" "Rutas sensibles tocadas: ${S}"

  DEP_RE='(^|/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|Pipfile(\.lock)?|go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile(\.lock)?|composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?)$'
  D="$(printf '%s\n' "$FILES" | grep -E "$DEP_RE" | head -5 | paste -sd, - || true)"
  [ -n "$D" ] && add "dependencias_modificadas" "Manifiestos de dependencias modificados: ${D}"

  TEST_RE='(^|/)(tests?|__tests__|spec)(/|$)|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|(^|/)test_[^/]*\.py$'
  TFILES="$(printf '%s\n' "$FILES" | grep -E "$TEST_RE" || true)"
  SRC="$(printf '%s\n' "$FILES" | grep -E '\.(js|jsx|mjs|ts|tsx|py|go|rb|java|rs|php|cs)$' | grep -Ev "$TEST_RE" || true)"
  [ -n "$SRC" ] && [ -z "$TFILES" ] && add "sin_tests_en_el_diff" "Hay cambios de codigo pero ningun archivo de test en el diff (TDD)"
  if [ -n "$TFILES" ]; then
    DEL="$(printf '%s\n' "$NUMSTAT" | awk -F'\t' -v re="$TEST_RE" '$3 ~ re && $2!="-" {d+=$2} END{print d+0}')"
    [ "$DEL" -gt 0 ] && add "tests_existentes_modificados" "Se eliminaron ${DEL} lineas en archivos de test"
    # shellcheck disable=SC2086
    PATCH="$(git diff -U0 "${BASE_OK}...${HEAD_REF}" -- $(printf '%s\n' "$TFILES" | tr '\n' ' ') 2>/dev/null || true)"
    if printf '%s\n' "$PATCH" | grep -E '^\+' | grep -Eq 'expect\((true|1)\)\.(toBe|toEqual)\((true|1)\)|assert\(true\)|assert +True\b|assertTrue\(true\)|\.skip\(|\bxit\(|\bxdescribe\(|pytest\.mark\.skip|t\.Skip\('; then
      add "test_trivial_o_skip" "Se agregaron asserts triviales o tests saltados"
    fi
  fi
fi

# ---------- 4. Resultado ----------
RESULT="NEEDS_HUMAN"
if [ "${#RISKS[@]}" -eq 0 ] && [ "$FAST_PATH_ENABLED" = "true" ]; then RESULT="FAST_PATH"; fi

{
  echo "$RESULT"
  echo
  echo "# Decision del Human-Gate"
  echo
  echo "- Fecha: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- Job: ${JOB_ID}"
  echo "- Base: ${BASE_OK:-n/d} | Round evaluado: ${LAST_ROUND:-n/d}"
  echo "- fast_path.enabled: ${FAST_PATH_ENABLED}"
  echo
  echo "## Riesgos detectados"
  if [ "${#RISKS[@]}" -eq 0 ]; then echo "- Ninguno."; else
    for i in "${!RISKS[@]}"; do echo "- ${RISKS[$i]}: ${EVID[$i]}"; done
  fi
  echo
  if [ "$RESULT" = "NEEDS_HUMAN" ]; then
    echo "Requiere revision humana: abrir PR en borrador con este resumen y esperar aprobacion."
  else
    echo "FAST_PATH: cumple todos los criterios. Aun asi se exige CI verde y branch protection."
  fi
} > "${JOB_DIR}/human.md"

echo "Human-gate: ${RESULT} (${#RISKS[@]} riesgos) -> ${JOB_DIR}/human.md"
exit 0
