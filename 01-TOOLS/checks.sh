#!/usr/bin/env bash
# checks.sh — Gate determinista del job. Sale con codigo != 0 si algo falla.
# Uso: bash 01-TOOLS/checks.sh [job-id]     (desde la worktree del job)
# Con job-id escribe <jobs>/<id>/gate.md: linea 1 `GATE: PASS|FAIL`; si hay tests cambiados que no se
# pudieron ejecutar anade `UNVERIFIED_TESTS: ...` (risk.sh lo trata como riesgo, nunca como verde).
#
# Que comprueba:
#   1. ALCANCE   los cambios reales (git) caben en `Alcance:` del spec (solo con job-id)
#   2. SINTAXIS  cada archivo cambiado (js/mjs/cjs, json, sh, py) parsea
#   3. lint, typecheck y la suite de tests del proyecto
#   4. Los tests que el job CAMBIO se ejecutan explicitamente (la suite puede no incluirlos)
# Variables: FACTORY_TEST_CMD, FACTORY_ALLOW_NO_TESTS=1, FACTORY_CONFIG, FACTORY_JOBS_DIR, FACTORY_BASE
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCOPE_JS="${HERE}/../factory/scripts/scope-check.mjs"

JOB_ID="${1:-}"
JOBS_DIR="$(factory_jobs_dir)"
FAILED=0
UNVERIFIED=()
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

say() { echo "$*" | tee -a "$LOG"; }
fail_step() { say "-> $1"; say "   FALLO: $2"; FAILED=1; }
run_step() {
  local name="$1"; shift
  say "-> ${name}: $*"
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  [ -n "$out" ] && { printf '%s\n' "$out" | tail -n 40 | tee -a "$LOG"; }
  if [ "$rc" -ne 0 ]; then say "   FALLO (${name}, codigo ${rc})"; FAILED=1; else say "   OK (${name})"; fi
}

say "=== Gate determinista ==="

# `node --check x.js` devuelve 0 sobre un .js ROTO si usa sintaxis ESM sin "type": "module" (falso verde).
# Por eso un .js se comprueba como modulo (.mjs) y como CommonJS (.cjs): debe parsear en al menos uno.
js_syntax_ok() {
  local f="$1" t out; t="$(mktemp -d)"
  cp "$f" "$t/a.mjs"; cp "$f" "$t/a.cjs"
  if node --check "$t/a.mjs" >"$t/o" 2>&1 || node --check "$t/a.cjs" >"$t/o2" 2>&1; then rm -rf "$t"; return 0; fi
  out="$(grep -m1 -E 'SyntaxError' "$t/o" || head -n1 "$t/o")"; rm -rf "$t"; printf '%s' "$out"; return 1
}

# ---------- 0. Cambios reales del job (si hay git y rama base) ----------
CHANGES=""
if git rev-parse --git-dir >/dev/null 2>&1 && MB="$(factory_merge_base)" && [ -n "$MB" ]; then
  CHANGES="$(node "$SCOPE_JS" changes "$MB" 2>/dev/null || true)"
  say "-> cambios detectados vs ${MB:0:7}: $(printf '%s\n' "$CHANGES" | grep -c . || true) archivos"
else
  say "-> cambios: no se pudo calcular el diff (sin git o sin rama base); se omiten ALCANCE y SINTAXIS de archivos cambiados"
fi
CHANGED_LIVE="$(printf '%s\n' "$CHANGES" | awk -F'\t' '$1!="D" && NF>=2 {print $2}')"

# ---------- 1. Alcance ----------
if [ -n "$JOB_ID" ] && [ -n "$CHANGES" ]; then
  SPEC="${JOBS_DIR}/${JOB_ID}/spec.md"
  if [ ! -f "$SPEC" ]; then fail_step alcance "no existe ${SPEC}"
  else
    OUT="$(printf '%s\n' "$CHANGES" | node "$SCOPE_JS" check "$SPEC")"; RC=$?
    if [ "$RC" -eq 0 ]; then say "-> alcance: OK"
    else fail_step alcance "$(printf '%s' "$OUT" | tr '\n' ';')"; fi
  fi
fi

# ---------- 2. Sintaxis de los archivos cambiados ----------
if [ -n "$CHANGED_LIVE" ]; then
  SYNTAX_BAD=0
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    case "$f" in
      *.js)             out="$(js_syntax_ok "$f")" || { say "   SINTAXIS ${f}: ${out}"; SYNTAX_BAD=1; } ;;
      *.mjs|*.cjs)      out="$(node --check "$f" 2>&1)" || { say "   SINTAXIS ${f}: ${out%%$'\n'*}"; SYNTAX_BAD=1; } ;;
      *.json)           out="$(node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" 2>&1)" || { say "   SINTAXIS ${f}: JSON invalido"; SYNTAX_BAD=1; } ;;
      *.sh)             out="$(bash -n "$f" 2>&1)" || { say "   SINTAXIS ${f}: ${out%%$'\n'*}"; SYNTAX_BAD=1; } ;;
      *.py)             if command -v python3 >/dev/null 2>&1; then out="$(python3 -m py_compile "$f" 2>&1)" || { say "   SINTAXIS ${f}: ${out%%$'\n'*}"; SYNTAX_BAD=1; }; fi ;;
    esac
  done <<< "$CHANGED_LIVE"
  if [ "$SYNTAX_BAD" -eq 1 ]; then fail_step sintaxis "hay archivos cambiados que no parsean"; else say "-> sintaxis: OK (archivos cambiados)"; fi
fi

# ---------- 3. Lint / typecheck / suite ----------
if ls eslint.config.* .eslintrc* >/dev/null 2>&1 || grep -q '"eslintConfig"' package.json 2>/dev/null; then
  if [ -x node_modules/.bin/eslint ]; then run_step lint node_modules/.bin/eslint .
  else fail_step lint "eslint esta configurado pero no instalado (ejecuta npm ci)"; fi
else say "-> lint: omitido (sin configuracion de eslint)"; fi

if [ -f tsconfig.json ]; then
  if [ -x node_modules/.bin/tsc ]; then run_step typecheck node_modules/.bin/tsc --noEmit
  else fail_step typecheck "tsconfig.json existe pero tsc no esta instalado (ejecuta npm ci)"; fi
else say "-> typecheck: omitido (sin tsconfig.json)"; fi

TEST_CMD="${FACTORY_TEST_CMD:-}"
if [ -z "$TEST_CMD" ]; then TEST_CMD="$(factory_cfg '(c.gate||{}).test_cmd' '')"; fi
if [ -n "$TEST_CMD" ]; then
  run_step tests bash -c "$TEST_CMD"
elif [ -f package.json ] && node -e "
  const s=(JSON.parse(require('fs').readFileSync('package.json','utf8')).scripts||{}).test;
  process.exit(s && !/no test specified/.test(s) ? 0 : 1)" 2>/dev/null; then
  run_step tests npm test --silent
elif { [ -f pytest.ini ] || [ -f pyproject.toml ] || [ -d tests ]; } && command -v pytest >/dev/null 2>&1 && ls tests/*.py >/dev/null 2>&1; then
  run_step tests pytest -q
elif [ -f go.mod ]; then
  run_step tests go test ./...
elif [ "${FACTORY_ALLOW_NO_TESTS:-0}" = "1" ]; then
  say "-> tests: omitidos (FACTORY_ALLOW_NO_TESTS=1)"
else
  fail_step tests "no hay runner de tests (define scripts.test, gate.test_cmd o FACTORY_TEST_CMD). TDD exige tests."
fi

# ---------- 4. Los tests CAMBIADOS por el job se ejecutan explicitamente ----------
TEST_RE='(^|/)(tests?|__tests__|spec)(/|$)|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|(^|/)test_[^/]*\.py$'
CHANGED_TESTS="$(printf '%s\n' "$CHANGED_LIVE" | grep -E "$TEST_RE" | while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done || true)"
if [ -n "$CHANGED_TESTS" ]; then
  NODE_TESTS=(); OTHER_JS=(); PY_TESTS=()
  while IFS= read -r f; do
    case "$f" in
      *.js|*.mjs|*.cjs|*.ts|*.tsx|*.jsx)
        if grep -qE "from ['\"]node:test['\"]|require\(['\"]node:test['\"]\)" "$f" 2>/dev/null && [[ "$f" =~ \.(js|mjs|cjs)$ ]]; then NODE_TESTS+=("$f"); else OTHER_JS+=("$f"); fi ;;
      *.py) PY_TESTS+=("$f") ;;
      *.go) ;;  # cubierto por `go test ./...`
      *) ;;
    esac
  done <<< "$CHANGED_TESTS"

  if [ "${#NODE_TESTS[@]}" -gt 0 ]; then
    say "-> tests cambiados (node:test): ${NODE_TESTS[*]}"
    OUT="$(node --test --test-reporter=tap "${NODE_TESTS[@]}" 2>&1)"; RC=$?
    N="$(printf '%s\n' "$OUT" | sed -n 's/^# tests \([0-9]*\).*/\1/p' | tail -1)"
    if [ "$RC" -ne 0 ]; then printf '%s\n' "$OUT" | grep -E "^not ok|SyntaxError|Error" | head -8 | tee -a "$LOG"; fail_step tests-cambiados "fallan los tests que cambio el job"
    elif [ -z "$N" ] || [ "$N" -eq 0 ]; then fail_step tests-cambiados "los tests cambiados no ejecutaron ningun caso (0 tests)"
    else say "   OK: ${N} casos ejecutados de los archivos cambiados"; fi
  fi
  if [ "${#OTHER_JS[@]}" -gt 0 ]; then
    if [ -x node_modules/.bin/vitest ]; then run_step tests-cambiados node_modules/.bin/vitest run "${OTHER_JS[@]}"
    elif [ -x node_modules/.bin/jest ]; then run_step tests-cambiados node_modules/.bin/jest --runTestsByPath "${OTHER_JS[@]}"
    else UNVERIFIED+=("${OTHER_JS[@]}"); say "-> tests cambiados SIN runner disponible (no verificados): ${OTHER_JS[*]}"; fi
  fi
  if [ "${#PY_TESTS[@]}" -gt 0 ]; then
    if command -v pytest >/dev/null 2>&1; then run_step tests-cambiados pytest -q "${PY_TESTS[@]}"
    else UNVERIFIED+=("${PY_TESTS[@]}"); say "-> tests python cambiados SIN pytest (no verificados): ${PY_TESTS[*]}"; fi
  fi
fi

RESULT="PASS"; [ "$FAILED" -ne 0 ] && RESULT="FAIL"
say "=== Gate: ${RESULT} ==="

if [ -n "$JOB_ID" ]; then
  mkdir -p "${JOBS_DIR}/${JOB_ID}"
  {
    echo "GATE: ${RESULT}"
    if [ "${#UNVERIFIED[@]}" -gt 0 ]; then echo "UNVERIFIED_TESTS: $(IFS=,; echo "${UNVERIFIED[*]}")"; fi
    echo; cat "$LOG"
  } > "${JOBS_DIR}/${JOB_ID}/gate.md"
fi
[ "$FAILED" -eq 0 ]
