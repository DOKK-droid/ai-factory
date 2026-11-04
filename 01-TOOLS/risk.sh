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
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCOPE_JS="${HERE}/../factory/scripts/scope-check.mjs"

JOB_ID="${1:?Uso: risk.sh <job-id>}"
JOBS_DIR="$(factory_jobs_dir)"
CONFIG="${FACTORY_CONFIG:-factory/config.json}"
JOB_DIR="${JOBS_DIR}/${JOB_ID}"
HEAD_REF="${FACTORY_HEAD:-HEAD}"

[ -d "$JOB_DIR" ] || { echo "ERROR: el job ${JOB_ID} no existe en ${JOB_DIR}" >&2; exit 2; }

cfg() { factory_cfg "$@"; }
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
# Obsolescencia (solo si el artefacto declara su commit; los gate/reviews antiguos sin COMMIT no se penalizan aqui,
# pero next-step.sh los trata como obsoletos).
HEAD_NOW="$(git rev-parse "${HEAD_REF}^{commit}" 2>/dev/null || true)"
GATE_COMMIT="$(sed -n 's/^COMMIT:[[:space:]]*\([0-9a-f]\{7,40\}\)\r\{0,1\}$/\1/p' "${JOB_DIR}/gate.md" 2>/dev/null | head -1)"
[ -z "$GATE_COMMIT" ] || [ -z "$HEAD_NOW" ] || factory_commit_fresh "$GATE_COMMIT" "$HEAD_REF" || add "gate_obsoleto" "gate.md es de ${GATE_COMMIT:0:7} y HEAD es ${HEAD_NOW:0:7}"
if [ -n "$LAST_ROUND" ] && [ -f "${LAST_ROUND}/.commit" ]; then
  ROUND_COMMIT="$(head -1 "${LAST_ROUND}/.commit" | trim)"
  [ -z "$HEAD_NOW" ] || factory_commit_fresh "$ROUND_COMMIT" "$HEAD_REF" || add "reviews_obsoletas" "Los reviews son de ${ROUND_COMMIT:0:7} y HEAD es ${HEAD_NOW:0:7}"
fi
UNV="$(sed -n 's/^UNVERIFIED_TESTS:[[:space:]]*//p' "${JOB_DIR}/gate.md" 2>/dev/null | head -1 | trim)"
[ -z "$UNV" ] || add "tests_cambiados_sin_ejecutar" "El gate no pudo ejecutar estos tests cambiados: ${UNV}"

# ---------- 3. Diff real ----------
BASE_OK=""
for cand in "$BASE_REF" "origin/${BASE_REF}"; do
  if git rev-parse --verify -q "${cand}^{commit}" >/dev/null 2>&1; then BASE_OK="$cand"; break; fi
done
if [ -z "$BASE_OK" ] || ! git rev-parse --verify -q "${HEAD_REF}^{commit}" >/dev/null 2>&1; then
  add "diff_no_disponible" "No pude calcular el diff (base='${BASE_REF}', head='${HEAD_REF}')"
else
  mapfile -t CUR_EX < <(factory_curator_excludes)   # la documentacion del curator no cuenta como diff de codigo
  NUMSTAT="$(git diff --numstat "${BASE_OK}...${HEAD_REF}" -- . "${CUR_EX[@]}" 2>/dev/null || true)"
  FILES="$(printf '%s\n' "$NUMSTAT" | awk 'NF>=3{print $3}')"
  DIFF_LINES="$(printf '%s\n' "$NUMSTAT" | awk 'NF>=3{ if($1!="-") a+=$1; if($2!="-") d+=$2 } END{print a+d+0}')"
  [ -z "$FILES" ] && add "diff_vacio" "El diff contra ${BASE_OK} esta vacio"

  # Alcance declarado en el spec: archivos fuera de la lista (sobre todo BORRADOS) => humano
  SPEC="${JOB_DIR}/spec.md"
  MB="$(git merge-base "$BASE_OK" "$HEAD_REF" 2>/dev/null || true)"
  if [ ! -f "$SPEC" ]; then add "sin_spec" "No existe spec.md: no se puede comprobar el alcance"
  elif [ -n "$MB" ]; then
    SC_OUT="$(node "$SCOPE_JS" changes "$MB" 2>/dev/null | node "$SCOPE_JS" check "$SPEC")"; SC_RC=$?
    if [ "$SC_RC" -eq 2 ]; then add "sin_alcance_definido" "${SC_OUT}"
    elif [ "$SC_RC" -eq 1 ]; then
      DELS="$(printf '%s\n' "$SC_OUT" | awk -F'\t' '$1=="BORRADO_FUERA_DE_ALCANCE"{print $2}' | head -5 | paste -sd, -)"
      OUTS="$(printf '%s\n' "$SC_OUT" | awk -F'\t' '$1=="FUERA_DE_ALCANCE"{print $2}' | head -5 | paste -sd, -)"
      [ -n "$DELS" ] && add "borrado_fuera_de_alcance" "Archivos borrados fuera del alcance del spec: ${DELS}"
      [ -n "$OUTS" ] && add "diff_fuera_de_alcance" "Archivos cambiados fuera del alcance del spec: ${OUTS}"
    fi
  fi
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
