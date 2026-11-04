#!/usr/bin/env bash
# launch-reviewers.sh — lanza los 4 reviewers (security, ux, ui, code) con el DIFF REAL del job.
# Uso (desde la worktree del job):  bash 01-TOOLS/launch-reviewers.sh <job-id> [round]
#
# Diseno (corrige el script anterior):
#  * El reviewer recibe spec + gate.md + el diff real (git). NO recibe la narracion del builder (build.md).
#  * El reviewer NO escribe nada: el SCRIPT guarda su respuesta como review-<rol>.md. No necesita bash ni edit.
#  * Se borra cualquier review previo antes de lanzar (un archivo viejo no puede pasar la validacion).
#  * Si la respuesta no cumple el formato: 1 reintento; si sigue mal => `VERDICT: CHANGES`, `SCORE: 0` (falla cerrado).
#  * No se mata ningun proceso ajeno: solo los PID lanzados aqui. Limite total (REVIEW_TIMEOUT_SECS) y por inactividad.
#  * Se comprueba que los IDs de modelo existen en `opencode models` antes de gastar nada.
#  * No se lanzan reviewers si el gate no paso (ahorra tokens).
#
# Variables: REVIEW_TIMEOUT_SECS (36000) REVIEW_IDLE_SECS (1800; 0 = sin vigilante) REVIEW_POLL_SECS (5)
#            REVIEW_MAX_PARALLEL (2; 1 si FACTORY_LOW_RESOURCES=1) REVIEW_MAX_DIFF_BYTES (120000) REVIEW_RETRIES (1)
#            REVIEW_PURE (1) REVIEW_AUTO (1) OPENCODE_BIN (opencode) FACTORY_SKIP_MODEL_CHECK (0)
# Salida: 0 = 4 reviews validos y del modelo; 1 = no se pudo empezar; 3 = algun reviewer fallo (hay review fail-closed)
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCOPE_JS="${HERE}/../factory/scripts/scope-check.mjs"
MODELS_JS="${HERE}/../factory/scripts/validate-models.mjs"

JOB_ID="${1:?Uso: launch-reviewers.sh <job-id> [round]}"
JOB_DIR="$(factory_jobs_dir)/${JOB_ID}"
ROLES=(security ux ui code)
TIMEOUT="${REVIEW_TIMEOUT_SECS:-36000}"; IDLE="${REVIEW_IDLE_SECS:-1800}"; POLL="${REVIEW_POLL_SECS:-5}"
LOWRES=2; [ "${FACTORY_LOW_RESOURCES:-0}" = "1" ] && LOWRES=1   # maquina con poca RAM: un reviewer a la vez
MAXPAR="${REVIEW_MAX_PARALLEL:-$LOWRES}"; MAXDIFF="${REVIEW_MAX_DIFF_BYTES:-120000}"; RETRIES="${REVIEW_RETRIES:-1}"
OC="${OPENCODE_BIN:-opencode}"

[ -d "$JOB_DIR" ] || { echo "ERROR: no existe ${JOB_DIR}" >&2; exit 1; }
[ -f "${JOB_DIR}/spec.md" ] || { echo "ERROR: falta spec.md" >&2; exit 1; }
[ "$(head -1 "${JOB_DIR}/gate.md" 2>/dev/null | tr -d '\r')" = "GATE: PASS" ] || { echo "ERROR: el gate no paso (gate.md != GATE: PASS); no se lanzan reviewers" >&2; exit 1; }
# El gate debe corresponder al HEAD actual: reviews sobre codigo distinto al verificado no valen.
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
GATE_COMMIT="$(sed -n 's/^COMMIT: \([0-9a-f]\{7,40\}\)\r\{0,1\}$/\1/p' "${JOB_DIR}/gate.md" | head -1)"
if [ -n "$GATE_COMMIT" ] && [ -n "$HEAD_SHA" ] && [ "$GATE_COMMIT" != "$HEAD_SHA" ]; then
  echo "ERROR: gate.md es de otro commit (${GATE_COMMIT:0:7}) y HEAD es ${HEAD_SHA:0:7}; vuelve a ejecutar checks.sh" >&2; exit 1
fi
if [ -n "${2:-}" ]; then ROUND="$2"
else last="$(ls -d "${JOB_DIR}"/round-* 2>/dev/null | sort -V | tail -1)"; ROUND=$(( $(basename "${last:-round-0}" | sed 's/round-//') + 1 )); fi
ROUND_DIR="${JOB_DIR}/round-${ROUND}"; mkdir -p "$ROUND_DIR"
rm -f "${ROUND_DIR}/.commit"   # una ejecucion interrumpida no puede parecer completa

if [ "${FACTORY_SKIP_MODEL_CHECK:-0}" != "1" ]; then
  node "$MODELS_JS" --agents reviewer-security,reviewer-ux,reviewer-ui,reviewer-code || { echo "ERROR: modelos de reviewers no validos; abortado" >&2; exit 1; }
fi

# ---- Contexto: spec + gate + DIFF REAL (nunca la prosa del builder) ----
MB="$(factory_merge_base || true)"; [ -n "$MB" ] || { echo "ERROR: no pude calcular el merge-base con la rama base" >&2; exit 1; }
CTX="${ROUND_DIR}/context.md"
{
  echo "# SPEC"; cat "${JOB_DIR}/spec.md"
  echo; echo "# GATE (salida determinista, verificada por script)"; sed -n '1,60p' "${JOB_DIR}/gate.md"
  echo; echo "# ARCHIVOS CAMBIADOS (git, vs ${MB:0:7})"; git diff --stat "$MB" | tail -n 40
  UNT="$(git ls-files --others --exclude-standard | head -20)"; [ -z "$UNT" ] || { echo "Sin seguimiento:"; echo "$UNT"; }
  echo; echo "# DIFF REAL"
  git diff -U3 "$MB" | head -c "$MAXDIFF"
  [ "$(git diff -U3 "$MB" | wc -c)" -le "$MAXDIFF" ] || echo $'\n[DIFF TRUNCADO a '"${MAXDIFF}"$' bytes: revisa tambien el listado de archivos de arriba]'
  while IFS= read -r f; do [ -f "$f" ] && { echo; echo "--- NUEVO (sin commitear): $f ---"; head -c 8000 "$f"; }; done <<< "$UNT"
} > "$CTX"

declare -A PID_ROLE=()
cleanup() { for p in "${!PID_ROLE[@]}"; do kill -TERM "$p" 2>/dev/null; done; }
trap cleanup INT TERM

valid_review() { # valid_review <archivo>
  [ -s "$1" ] && head -1 "$1" | grep -qE '^VERDICT: (PASS|CHANGES|PASS \(n/a\))$' && sed -n 2p "$1" | grep -qE '^SCORE: (0(\.[0-9]+)?|1(\.0+)?)$'
}

prompt_for() { # prompt_for <rol> <reintento 0|1>
  local role="$1" retry="$2"
  cat <<P
Eres reviewer-${role} de una AI Factory. Revisa SOLO desde tu especialidad (${role}) y SOLO lo que ves abajo: el spec, la salida del gate y el diff real. No confies en descripciones del autor.
Responde unicamente con texto (no uses herramientas, no escribas archivos). Formato EXACTO, sin bloques de codigo:
Linea 1: VERDICT: PASS   (o VERDICT: CHANGES, o VERDICT: PASS (n/a) si no aplica a este cambio)
Linea 2: SCORE: <numero entre 0 y 1>
Despues: hallazgos concretos con archivo:linea y severidad. Si el diff borra archivos o toca rutas fuera del alcance del spec, es un hallazgo bloqueante.
$( [ "$retry" = 1 ] && echo "ATENCION: tu respuesta anterior no cumplio el formato. Empieza EXACTAMENTE con las dos lineas VERDICT: y SCORE:." )

$(cat "$CTX")
P
}

extract_review() { # extract_review <raw> <destino>: desde la primera linea VERDICT:, sin ANSI ni vallas ```
  sed 's/\x1b\[[0-9;]*m//g; s/\r$//' "$1" | grep -v '^```' | awk '/^VERDICT:/{p=1} p' > "$2"
}

run_role() {
  local role="$1" review="${ROUND_DIR}/review-${role}.md" raw="${ROUND_DIR}/raw-${role}.txt" err="${ROUND_DIR}/err-${role}.txt"
  rm -f "$review" "$raw" "$err"
  local model attempt=0 reason="" args
  model="$(sed -n 's/^model:[[:space:]]*//p' ".opencode/agent/reviewer-${role}.md" 2>/dev/null | head -1)"
  args=(run --agent "reviewer-${role}"); [ -n "$model" ] && args+=(--model "$model")
  [ "${REVIEW_PURE:-1}" = 1 ] && args+=(--pure); [ "${REVIEW_AUTO:-1}" = 1 ] && args+=(--auto)
  while [ "$attempt" -le "$RETRIES" ]; do
    : > "$raw"; : > "$err"
    local retry=0; [ "$attempt" -gt 0 ] && retry=1
    local setsid_cmd=(); command -v setsid >/dev/null 2>&1 && setsid_cmd=(setsid)
    "${setsid_cmd[@]}" "$OC" "${args[@]}" "$(prompt_for "$role" "$retry")" >"$raw" 2>"$err" &
    local pid=$! start now last_change size last_size=-1; start=$(date +%s); last_change=$start; reason=""
    trap 'kill -TERM -- "-$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null; exit 143' TERM INT
    while kill -0 "$pid" 2>/dev/null; do
      sleep "$POLL"; now=$(date +%s)
      size=$(( $(stat -c %s "$raw" 2>/dev/null || echo 0) + $(stat -c %s "$err" 2>/dev/null || echo 0) ))
      if [ "$size" -ne "$last_size" ]; then last_size=$size; last_change=$now; fi
      if [ $((now - start)) -ge "$TIMEOUT" ]; then reason="timeout total ${TIMEOUT}s"; fi
      if [ "$IDLE" -gt 0 ] && [ $((now - last_change)) -ge "$IDLE" ]; then reason="inactivo ${IDLE}s"; fi
      if [ -n "$reason" ]; then kill -TERM -- "-$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null; sleep 2; kill -KILL -- "-$pid" 2>/dev/null; kill -KILL "$pid" 2>/dev/null; break; fi
    done
    wait "$pid" 2>/dev/null; local rc=$?
    [ -z "$reason" ] && [ "$rc" -ne 0 ] && reason="opencode salio con codigo ${rc}"
    if [ -z "$reason" ]; then extract_review "$raw" "$review"; valid_review "$review" && { echo "OK   reviewer-${role}: $(head -1 "$review") | $(sed -n 2p "$review")"; return 0; }; reason="respuesta sin formato VERDICT/SCORE"; fi
    attempt=$((attempt + 1))
  done
  printf 'VERDICT: CHANGES\nSCORE: 0\n\nREVIEWER_FALLO: %s (modelo %s). Falla cerrado: requiere revision humana.\n' "$reason" "${model:-?}" > "$review"
  echo "FAIL reviewer-${role}: ${reason}"; return 3
}

echo "Round ${ROUND} | diff real: ${CTX} | paralelismo ${MAXPAR} | timeout ${TIMEOUT}s | inactividad ${IDLE}s"
RUNNING=0; ANYFAIL=0
rm -f "${ROUND_DIR}"/.status-*
for role in "${ROLES[@]}"; do
  while [ "$RUNNING" -ge "$MAXPAR" ]; do wait -n 2>/dev/null; RUNNING=$((RUNNING - 1)); done
  ( run_role "$role"; echo $? > "${ROUND_DIR}/.status-${role}" ) &
  PID_ROLE[$!]="$role"; RUNNING=$((RUNNING + 1))
done
wait
for role in "${ROLES[@]}"; do [ "$(cat "${ROUND_DIR}/.status-${role}" 2>/dev/null || echo 9)" = 0 ] || ANYFAIL=1; done

# `.commit` = HEAD revisado. Solo se escribe al terminar los 4 roles (con review valido o fail-closed).
[ -z "$HEAD_SHA" ] || printf '%s\n' "$HEAD_SHA" > "${ROUND_DIR}/.commit"

VALIDATE_REVIEWS_ONLY=1 bash "${HERE}/validate-artifacts.sh" "$JOB_ID" "$ROUND" || ANYFAIL=1
[ "$ANYFAIL" -eq 0 ] && exit 0 || exit 3
