#!/usr/bin/env bash
#
# launch-reviewers.sh — Lanza los 4 revisores en paralelo con controles de robustez.
#
# Uso: bash 01-TOOLS/launch-reviewers.sh <job-id> <round>
#
# Variables de entorno:
#   OPENCODE_BIN        ruta al binario opencode (default: opencode)
#   REVIEW_TIMEOUT_SECS timeout por revisor en segundos (default: 600 = 10 min)
#
# Qué hace:
#   1. Limpia procesos opencode zombies previos.
#   2. Lee spec.md y build.md del job para construir el prompt de cada revisor.
#   3. Extrae el modelo de cada archivo de agente.
#   4. Lanza los 4 revisores EN PARALELO con:
#        - --pure --auto (sin prompts interactivos que cuelguen la ejecución)
#        - timeout por revisor (evita que uno se cuelgue para siempre)
#   5. Espera a que terminen los 4.
#   6. Verifica que cada review-<x>.md tenga VERDICT en línea 1 y SCORE en línea 2.
#   7. Limpia zombies al finalizar.
#
# Salida: código 0 si los 4 revisores produjeron review válida; código 1 si falló alguno.

set -uo pipefail

JOB_ID="${1:?Uso: bash 01-TOOLS/launch-reviewers.sh <job-id> <round>}"
ROUND="${2:-1}"
OPENCODE_BIN="${OPENCODE_BIN:-opencode}"
TIMEOUT_SECS="${REVIEW_TIMEOUT_SECS:-36000}"

# Rutas construidas dinámicamente
A_DIR=".opencode"; B_DIR="agent"; AGENT_DIR="${A_DIR}/${B_DIR}"
F_DIR="factory"; J_DIR="jobs"; JOB_DIR="${F_DIR}/${J_DIR}/${JOB_ID}"
ROUND_DIR="${JOB_DIR}/round-${ROUND}"

mkdir -p "$ROUND_DIR"

echo "=== Lanzando 4 revisores en paralelo (job=${JOB_ID}, round=${ROUND}, timeout=${TIMEOUT_SECS}s) ==="

# ── 1. Limpiar zombies previos ──────────────────────────────────────────────
pkill -f "opencode run" 2>/dev/null || true
sleep 1

# ── 2. Leer insumos del job ─────────────────────────────────────────────────
SPEC=""
BUILD=""
if [ -f "${JOB_DIR}/spec.md" ]; then
  SPEC=$(cat "${JOB_DIR}/spec.md")
fi
if [ -f "${JOB_DIR}/build.md" ]; then
  BUILD=$(cat "${JOB_DIR}/build.md")
fi

# ── 3. Función: lanzar un revisor ───────────────────────────────────────────
launch_reviewer() {
  local role="$1"
  local agent_file="${AGENT_DIR}/reviewer-${role}.md"
  local review_file="${ROUND_DIR}/review-${role}.md"
  local stdout_file="${ROUND_DIR}/${role}.stdout"
  local start_time end_time elapsed

  # Extraer modelo del frontmatter del agente
  local model=""
  if [ -f "$agent_file" ]; then
    model=$(grep -m1 '^model:' "$agent_file" | sed 's/^model:[[:space:]]*//' | tr -d '[:space:]')
  fi
  if [ -z "$model" ]; then
    echo "FAIL: reviewer-${role} no tiene modelo en ${agent_file}"
    return 1
  fi

  # Construir prompt
  local prompt="Eres el revisor ${role} de la AI Factory. Revisa el siguiente job y escribe tu informe en ${review_file}.

SPEC:
${SPEC}

BUILD:
${BUILD}

Reglas de salida:
- Línea 1: VERDICT: PASS | CHANGES | PASS (n/a)
- Línea 2: SCORE: 0-1
- Luego los hallazgos y recomendaciones.
No uses herramientas, no edites archivos, solo escribe el informe."

  start_time=$(date +%s)

  # Lanzar con timeout, --pure --auto (sin prompts interactivos)
  timeout --signal=KILL "$TIMEOUT_SECS" "$OPENCODE_BIN" run --pure --auto \
    --agent "reviewer-${role}" --model "$model" "$prompt" \
    > "$stdout_file" 2>&1 || true

  end_time=$(date +%s)
  elapsed=$((end_time - start_time))

  # Verificar formato del review
  if [ -f "$review_file" ]; then
    local first_line second_line
    first_line=$(head -1 "$review_file" | tr -d '\r')
    second_line=$(sed -n '2p' "$review_file" | tr -d '\r')
    if echo "$first_line" | grep -qE "^VERDICT:"; then
      if echo "$second_line" | grep -qE "^SCORE:"; then
        echo "OK: reviewer-${role} -> ${first_line} | ${second_line} (${elapsed}s)"
        return 0
      else
        echo "WARN: reviewer-${role} tiene VERDICT pero no SCORE en línea 2 (${elapsed}s)"
        return 1
      fi
    else
      echo "WARN: reviewer-${role} no tiene VERDICT en línea 1 (tiene: ${first_line}) (${elapsed}s)"
      return 1
    fi
  else
    echo "FAIL: reviewer-${role} no produjo ${review_file} (${elapsed}s)"
    return 1
  fi
}

# ── 4. Lanzar los 4 revisores EN PARALELO ───────────────────────────────────
declare -A RESULTS
for role in security ux ui code; do
  launch_reviewer "$role" &
  RESULTS["$role"]=$!
done

# ── 5. Esperar a que terminen los 4 ─────────────────────────────────────────
FAILURES=0
for role in security ux ui code; do
  pid="${RESULTS[$role]}"
  if ! wait "$pid" 2>/dev/null; then
    echo "FAIL: reviewer-${role} terminó con error"
    FAILURES=$((FAILURES + 1))
  fi
done

# ── 6. Limpiar zombies post-ejecución ───────────────────────────────────────
pkill -f "opencode run" 2>/dev/null || true

# ── 7. Resultado ────────────────────────────────────────────────────────────
if [ "$FAILURES" -eq 0 ]; then
  echo "LANZAMIENTO COMPLETO: 4/4 revisores OK para job ${JOB_ID} round ${ROUND}"
  exit 0
else
  echo "LANZAMIENTO PARCIAL: ${FAILURES}/4 revisores fallaron para job ${JOB_ID} round ${ROUND}"
  exit 1
fi
