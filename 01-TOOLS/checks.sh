#!/usr/bin/env bash
# checks.sh — Gate determinista: lint + typecheck + tests.
# Uso: bash 01-TOOLS/checks.sh [job-id]
# Sale con codigo != 0 si algo falla. Si se pasa job-id escribe factory/jobs/<id>/gate.md
# (primera linea: `GATE: PASS` o `GATE: FAIL`).
#
# Variables opcionales:
#   FACTORY_TEST_CMD=<cmd>       comando de tests (tiene prioridad)
#   FACTORY_ALLOW_NO_TESTS=1     permitir proyectos sin tests (por defecto FALLA)
#   FACTORY_CONFIG=<ruta>        config (por defecto factory/config.json; clave gate.test_cmd)
#   FACTORY_JOBS_DIR=<ruta>      carpeta de jobs (por defecto factory/jobs)
set -uo pipefail
unset FORCE_COLOR; export NO_COLOR=1 NODE_DISABLE_COLORS=1

JOB_ID="${1:-}"
JOBS_DIR="${FACTORY_JOBS_DIR:-factory/jobs}"
CONFIG="${FACTORY_CONFIG:-factory/config.json}"
FAILED=0
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

say() { echo "$*" | tee -a "$LOG"; }

run_step() {
  local name="$1"; shift
  say "-> ${name}: $*"
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  [ -n "$out" ] && printf '%s\n' "$out" | tail -n 40 | tee -a "$LOG" >/dev/null && printf '%s\n' "$out" | tail -n 40
  if [ "$rc" -ne 0 ]; then say "   FALLO (${name}, codigo ${rc})"; FAILED=1; else say "   OK (${name})"; fi
}

fail_step() { say "-> $1"; say "   FALLO: $2"; FAILED=1; }

say "=== Gate determinista ==="

# 1. Lint (solo si hay configuracion; si esta configurado y no instalado, FALLA)
if ls eslint.config.* .eslintrc* >/dev/null 2>&1 || grep -q '"eslintConfig"' package.json 2>/dev/null; then
  if [ -x node_modules/.bin/eslint ]; then run_step lint node_modules/.bin/eslint .
  else fail_step lint "eslint esta configurado pero no instalado (ejecuta npm ci)"; fi
else
  say "-> lint: omitido (sin configuracion de eslint)"
fi

# 2. Typecheck
if [ -f tsconfig.json ]; then
  if [ -x node_modules/.bin/tsc ]; then run_step typecheck node_modules/.bin/tsc --noEmit
  else fail_step typecheck "tsconfig.json existe pero tsc no esta instalado (ejecuta npm ci)"; fi
else
  say "-> typecheck: omitido (sin tsconfig.json)"
fi

# 3. Tests (obligatorios: TDD exige tests)
TEST_CMD="${FACTORY_TEST_CMD:-}"
if [ -z "$TEST_CMD" ] && [ -f "$CONFIG" ]; then
  TEST_CMD="$(node -p "(JSON.parse(require('fs').readFileSync('$CONFIG','utf8')).gate||{}).test_cmd||''" 2>/dev/null || true)"
fi
if [ -n "$TEST_CMD" ]; then
  run_step tests bash -c "$TEST_CMD"
elif [ -f package.json ] && node -e "
  const s=(JSON.parse(require('fs').readFileSync('package.json','utf8')).scripts||{}).test;
  process.exit(s && !/no test specified/.test(s) ? 0 : 1)" 2>/dev/null; then
  run_step tests npm test --silent
elif [ -f pytest.ini ] || [ -f pyproject.toml ] || [ -d tests ] && command -v pytest >/dev/null 2>&1 && ls tests/*.py tests/**/*.py >/dev/null 2>&1; then
  run_step tests pytest -q
elif [ -f go.mod ]; then
  run_step tests go test ./...
elif [ "${FACTORY_ALLOW_NO_TESTS:-0}" = "1" ]; then
  say "-> tests: omitidos (FACTORY_ALLOW_NO_TESTS=1)"
else
  fail_step tests "no hay runner de tests (define scripts.test, gate.test_cmd o FACTORY_TEST_CMD). TDD exige tests."
fi

RESULT="PASS"; [ "$FAILED" -ne 0 ] && RESULT="FAIL"
say "=== Gate: ${RESULT} ==="

if [ -n "$JOB_ID" ]; then
  mkdir -p "${JOBS_DIR}/${JOB_ID}"
  { echo "GATE: ${RESULT}"; echo; cat "$LOG"; } > "${JOBS_DIR}/${JOB_ID}/gate.md"
fi
[ "$FAILED" -eq 0 ]
