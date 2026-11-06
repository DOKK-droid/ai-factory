#!/usr/bin/env bash
# next-step.sh — plano de control de la fabrica: maquina de estados DETERMINISTA, sin LLM y de SOLO LECTURA.
# Lee los artefactos de factory/jobs/<id>/ y dice la proxima accion exacta. El orchestrator solo hace un bucle:
#   next-step.sh -> ejecutar lo que diga -> repetir hasta DONE o STOP.
#
# Uso:  bash 01-TOOLS/next-step.sh <job-id>      (desde el checkout principal o desde una worktree)
#       bash 01-TOOLS/next-step.sh --new-id ["frase corta"]   (imprime un id de job nuevo; no escribe nada)
#         con frase: <palabras-clave>-<aammdd>-<4 hex>, p. ej. "funcion clamp numeros" -> funcion-clamp-numeros-261104-8acd
#
# Salida: la PRIMERA linea es la accion; despues van lineas opcionales STATE:, PHASE:, WHY:, CMD:, READ:.
#   PHASE: fase metodologica del paso (Análisis, Diseño, Desarrollo, Pruebas, Revisión, Documentación, Entrega).
#   RUN: <comando exacto>                          -> ejecutalo tal cual
#   DELEGATE: @<agente> | <que produce> | <archivo[,archivo]> (siempre 3 campos separados por ' | ') -> lanza ese agente por Task (y que lea las paginas READ: del Brain)
#   STOP: <CODIGO>                                  -> espera al humano (WHY: explica; CMD: comando que puede ejecutar el humano)
#   DONE                                            -> job terminado
# Codigos de salida: 0 = RUN/DELEGATE/DONE, 2 = STOP, 1 = error de uso.
#
# Politica por proyecto (versionada): factory/project.json  (el Brain aconseja, esto decide, los permisos hacen cumplir)
#   { "require_spec_ok": true, "max_rounds": 3, "human_review_surfaces": ["page"], "spec_profile": "full",
#     "brain": { "default": ["02-DOCS/wiki/index.md"], "agents": { "spec-writer": ["02-DOCS/wiki/sdd/decisions.md"] } } }
#   spec_profile: "standard" (por defecto) o "full" (Actores, RF-n, Diseño, ADR, trazabilidad y pagina del job en el Brain).
#   project_docs: "off" (por defecto) o "required": con required el job no pasa del estado 1 mientras `project-lint gate` falle
#   (la base documental del proyecto, 02-DOCS/wiki/project/, debe estar aprobada y fresca).
#   Sin el archivo: spec.ok exigido, max_rounds de factory/config.json (o 3), sin superficies que exijan humano.
#   FACTORY_REQUIRE_SPEC_OK=0 (entorno del humano; el guard prohibe a los agentes escribirlo) desactiva spec.ok.
#
# Marcas del humano (las crea el humano con `touch`; el guard impide que un agente las cree):
#   spec.ok (spec confirmado), review.ok (superficie que exige revision humana), pr.url (PR creado a mano),
#   brain.ok (peticion de cambio al Brain normativo confirmada; ver factory/scripts/brain-request.mjs).
#
# Obsolescencia atada al commit: gate.md lleva `COMMIT: <sha>` y round-N/.commit el sha revisado; si HEAD de la
# worktree es otro, el artefacto es OBSOLETO (salvo que lo posterior solo toque paginas del curator: factory_commit_fresh). decision.md y human.md se consideran vigentes solo si son MAS
# NUEVOS (mtime) que lo que las origina. Cualquier valor ambiguo o ilegible => STOP, nunca se avanza.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPEC_LINT="${HERE}/../factory/scripts/spec-lint.mjs"
BRAIN_REQ="${HERE}/../factory/scripts/brain-request.mjs"
PROJECT_LINT="${HERE}/../factory/scripts/project-lint.mjs"

if [ "${1:-}" = "--new-id" ]; then
  # Con frase: slug determinista (sin LLM) de sus primeras palabras clave + fecha + 4 hex para que no choque.
  HEX="$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
  if [ -n "${2:-}" ]; then
    SLUG="$(printf '%s' "$2" | node -e '
      const stop = new Set("a al con de del el la las los lo un una unos unas en y o u e para por que se su sus es son the an of to in and for with crea crear haz hacer agrega agregar anade anadir implementa implementar nueva nuevo nuevos nuevas funcion funciones tarea job".split(" "));
      const t = require("fs").readFileSync(0, "utf8").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ");
      const out = []; for (const w of t) { if (w.length < 2 || stop.has(w) || out.includes(w)) continue; if ([...out, w].join("-").length > 32) break; out.push(w); if (out.length === 5) break; }
      process.stdout.write((out.length ? out.join("-") : t.join("").slice(0, 24)).replace(/^-+|-+$/g, ""));' 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g')"
    [ -n "$SLUG" ] || SLUG="job"
    printf '%s-%s-%s\n' "$SLUG" "$(date +%y%m%d)" "${HEX:0:4}"
  else
    printf 'job-%s-%s\n' "$(date +%s%3N)" "$HEX"
  fi
  exit 0
fi
JOB_ID="${1:-}"
[ -n "$JOB_ID" ] || { echo "Uso: next-step.sh <job-id> | --new-id [\"frase corta\"]" >&2; exit 1; }
[[ "$JOB_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$ ]] && [[ "$JOB_ID" != *..* ]] || { echo "ERROR: job-id invalido (letras, numeros, . _ -)" >&2; exit 1; }

ROOT="$(factory_main_root)" || { echo "ERROR: no es un repositorio git" >&2; exit 1; }
JOBS_DIR="$(factory_jobs_dir)"
JOB_DIR="${JOBS_DIR}/${JOB_ID}"
WT="${ROOT}/factory/worktrees/${JOB_ID}"
BRANCH="factory/${JOB_ID}"
export FACTORY_CONFIG="${FACTORY_CONFIG:-${ROOT}/factory/config.json}"
STATE=""

# ---------- salida ----------
brain_read() { # brain_read <agente>: paginas del Brain que ese agente debe leer antes de actuar (solo las que existen)
  local a="$1" p out=()
  for p in "${BRAIN_DEFAULT[@]}" ${BRAIN_AGENT[$a]:-}; do
    [ -f "${ROOT}/${p}" ] || continue
    case " ${out[*]:-} " in *" $p "*) ;; *) out+=("$p") ;; esac
  done
  [ "${#out[@]}" -eq 0 ] || echo "READ: $(IFS=,; echo "${out[*]}" | sed 's/,/, /g')"
}
phase() { # fase metodologica del estado: el flujo es Análisis -> Diseño -> Desarrollo -> Pruebas -> Revisión -> Documentación -> Entrega
  case "$1" in
    0|1) echo "Análisis" ;; 2|3) echo "Análisis y diseño" ;; 4|6|9) echo "Desarrollo" ;; 5|7) echo "Pruebas" ;;
    8|10|11b) echo "Revisión" ;; 11) echo "Documentación" ;; 12|13|14) echo "Entrega" ;; *) echo "" ;;
  esac; }
meta() { [ -z "${STATE}" ] || { echo "STATE: ${STATE}"; local ph; ph="$(phase "$STATE")"; [ -z "$ph" ] || echo "PHASE: ${ph}"; }; }
run_() { echo "RUN: $1"; meta; [ -z "${2:-}" ] || echo "WHY: $2"; exit 0; }
delegate() { # delegate <agente> <que produce> <archivo> [por que]
  echo "DELEGATE: @$1 | $2 | $3"; meta; [ -z "${4:-}" ] || echo "WHY: $4"; brain_read "$1"; exit 0; }
stop() { # stop <CODIGO> <por que> [comando del humano...]
  local code="$1" why="$2"; shift 2
  echo "STOP: ${code}"; meta; printf '%s\n' "$why" | sed 's/^/WHY: /'
  for c in "$@"; do echo "CMD: ${c}"; done; exit 2; }
done_() { echo "DONE"; STATE=14; meta; [ -z "${1:-}" ] || echo "WHY: $1"; exit 0; }

# ---------- politica del proyecto (factory/project.json) ----------
declare -A BRAIN_AGENT=(); BRAIN_DEFAULT=()
REQUIRE_SPEC_OK=1; MAX_ROUNDS=3; HUMAN_SURFACES=""; SPEC_PROFILE=standard; PROJECT_DOCS=off
POLICY="$(node -e '
  const fs = require("fs"); const [pf, cf] = process.argv.slice(1);
  const bad = (m) => { process.stdout.write("INVALID " + m + "\n"); process.exit(0); };
  const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return e.code === "ENOENT" ? null : "ERR"; } };
  const p = rd(pf), c = rd(cf);
  if (p === "ERR") bad("factory/project.json no es JSON valido");
  const o = p || {};
  let req = true; if ("require_spec_ok" in o) { if (typeof o.require_spec_ok !== "boolean") bad("require_spec_ok debe ser true o false"); req = o.require_spec_ok; }
  let mr = c && c !== "ERR" && Number.isInteger(c.max_rounds) ? c.max_rounds : 3;
  if ("max_rounds" in o) { if (!Number.isInteger(o.max_rounds) || o.max_rounds < 1) bad("max_rounds debe ser un entero >= 1"); mr = o.max_rounds; }
  if (!Number.isInteger(mr) || mr < 1) bad("max_rounds invalido");
  const sp = o.spec_profile === undefined ? "standard" : o.spec_profile;
  if (sp !== "standard" && sp !== "full") bad("spec_profile debe ser standard o full");
  const hs = o.human_review_surfaces === undefined ? [] : o.human_review_surfaces;
  if (!Array.isArray(hs) || hs.some((x) => typeof x !== "string" || !/^[A-Za-z0-9_-]+$/.test(x))) bad("human_review_surfaces debe ser una lista de nombres");
  const pd = o.project_docs === undefined ? "off" : o.project_docs;
  if (pd !== "off" && pd !== "required") bad("project_docs debe ser off o required");
  const okPage = (x) => typeof x === "string" && /^[A-Za-z0-9._\/-]+$/.test(x) && !x.startsWith("/") && !x.split("/").includes("..");
  const br = o.brain === undefined ? {} : o.brain;
  const def = br.default === undefined ? ["02-DOCS/wiki/index.md"] : br.default;
  const ag = br.agents === undefined ? {} : br.agents;
  if (!Array.isArray(def) || !def.every(okPage)) bad("brain.default debe ser una lista de rutas relativas");
  if (typeof ag !== "object" || ag === null || Array.isArray(ag)) bad("brain.agents debe ser un objeto");
  const out = ["OK", "REQUIRE_SPEC_OK=" + (req ? 1 : 0), "MAX_ROUNDS=" + mr, "HUMAN_SURFACES=" + hs.join(","), "SPEC_PROFILE=" + sp, "PROJECT_DOCS=" + pd, "BRAIN_DEFAULT=" + def.join(" ")];
  for (const [k, v] of Object.entries(ag)) {
    if (!/^[a-z-]+$/.test(k) || !Array.isArray(v) || !v.every(okPage)) bad("brain.agents." + k + " invalido");
    out.push("BRAIN_AGENT:" + k + "=" + v.join(" "));
  }
  process.stdout.write(out.join("\n") + "\n");
' "${FACTORY_PROJECT_FILE:-${ROOT}/factory/project.json}" "${FACTORY_CONFIG}" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g')"
case "$(printf '%s\n' "$POLICY" | head -1)" in
  OK) ;;
  INVALID*) STATE=policy; stop PROJECT_INVALID "$(printf '%s\n' "$POLICY" | head -1 | sed 's/^INVALID //')" "corrige factory/project.json (lo edita el humano)" ;;
  *) STATE=policy; stop PROJECT_INVALID "no pude leer la politica del proyecto (factory/project.json / factory/config.json)" ;;
esac
while IFS= read -r l; do
  case "$l" in
    REQUIRE_SPEC_OK=*) REQUIRE_SPEC_OK="${l#*=}" ;;
    MAX_ROUNDS=*) MAX_ROUNDS="${l#*=}" ;;
    HUMAN_SURFACES=*) HUMAN_SURFACES="${l#*=}" ;;
    SPEC_PROFILE=*) SPEC_PROFILE="${l#*=}" ;;
    PROJECT_DOCS=*) PROJECT_DOCS="${l#*=}" ;;
    BRAIN_DEFAULT=*) read -r -a BRAIN_DEFAULT <<< "${l#*=}" ;;
    BRAIN_AGENT:*) k="${l#BRAIN_AGENT:}"; BRAIN_AGENT["${k%%=*}"]="${k#*=}" ;;
  esac
done <<< "$POLICY"
[ "${FACTORY_REQUIRE_SPEC_OK:-1}" != "0" ] || REQUIRE_SPEC_OK=0

# ---------- utilidades ----------
trim() { sed 's/\r$//; s/^[[:space:]]*//; s/[[:space:]]*$//'; }
line1() { head -1 "$1" 2>/dev/null | trim; }
nonempty() { [ -f "$1" ] && [ -s "$1" ] && grep -q '[^[:space:]]' "$1"; }
wt_git() { git --no-optional-locks -C "$WT" "$@"; }
# bash [ a -nt b ]: a es mas nuevo que b (si b no existe, a es mas nuevo; si a no existe, no)

# ---------- 0. el job existe? ----------
STATE=0
HAS_DIR=0; [ -f "${JOB_DIR}/job.json" ] && HAS_DIR=1
HAS_WT=0; [ -e "$WT" ] && HAS_WT=1
if [ "$HAS_DIR" -eq 0 ] && [ "$HAS_WT" -eq 0 ] && [ ! -e "$JOB_DIR" ]; then
  run_ "bash 01-TOOLS/new-job.sh ${JOB_ID}" "el job no existe: se crea la worktree aislada y job.json"
fi
if [ "$HAS_DIR" -eq 0 ] || [ "$HAS_WT" -eq 0 ]; then
  stop JOB_INCONSISTENT "job a medias (job.json: $([ $HAS_DIR -eq 1 ] && echo si || echo no); worktree ${WT}: $([ $HAS_WT -eq 1 ] && echo si || echo no)). No lo reparo yo: revisa a mano."
fi
JOB_BASE="$(node -p "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));String(j.id===process.argv[2]&&typeof j.base==='string'?j.base:'')}catch(e){''}" "${JOB_DIR}/job.json" "$JOB_ID" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | head -1)"
[ -n "$JOB_BASE" ] || stop JOB_INCONSISTENT "job.json ilegible o de otro id (${JOB_DIR}/job.json)"
[ "$(wt_git rev-parse --abbrev-ref HEAD 2>/dev/null)" = "$BRANCH" ] || stop JOB_INCONSISTENT "la worktree ${WT} no esta en la rama ${BRANCH}"
HEAD_SHA="$(wt_git rev-parse HEAD 2>/dev/null)" || stop JOB_INCONSISTENT "no pude leer HEAD de la worktree ${WT}"
git --no-optional-locks -C "$ROOT" rev-parse -q --verify "${JOB_BASE}^{commit}" >/dev/null 2>&1 || stop BASE_UNKNOWN "no existe la rama base ${JOB_BASE} (job.json)"
BASE_NAME="${JOB_BASE#origin/}"

# ---------- 1. input ----------
STATE=1
nonempty "${JOB_DIR}/input.md" || delegate intake "normalizar la tarea del humano (texto, issue o error)" "factory/jobs/${JOB_ID}/input.md" "falta input.md (o esta vacio)"

# ---------- 1b. peticiones de cambio al Brain normativo (brain-request.md) ----------
# Toda la logica vive en factory/scripts/brain-request.mjs; aqui solo se traduce la primera palabra de su respuesta.
# Cualquier respuesta que no sea una de las listadas (vacia, error de node, texto raro) es un STOP: fail-closed.
STATE=brain
BRS="$(node "$BRAIN_REQ" state --job-dir "$JOB_DIR" --job-id "$JOB_ID" --worktree "$WT" --base "$JOB_BASE" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g')"
BR_FIRST="$(printf '%s\n' "$BRS" | head -1)"
br() { printf '%s\n' "$BRS" | sed -n "s/^$1: //p"; }   # valor(es) de la linea "CLAVE: valor"
case "$BR_FIRST" in
  NONE|DONE) ;;
  CONFIRM) stop HUMAN_CONFIRM_BRAIN "$(br WHY)" "$(br CMD)" ;;
  "APPLY BR-"*|ALIGN)
    [ -n "$(br OWNER)" ] && [ -n "$(br FILES)" ] && [ -n "$(br WHAT)" ] || stop BRAIN_REQUEST_INVALID "brain-request.mjs no indico agente, archivo o tarea para '${BR_FIRST}'"
    delegate "$(br OWNER)" "$(br WHAT)" "$(br FILES)" "$(br WHY | paste -sd';' - | sed 's/;/; /g')" ;;
  COMMIT) [ -n "$(br CMD)" ] || stop BRAIN_REQUEST_INVALID "brain-request.mjs pidio un commit sin comando"
    run_ "$(br CMD)" "$(br WHY)" ;;
  REAPPROVE) stop HUMAN_CONFIRM_PROJECT "$(br WHY)" "$(br CMD)" ;;
  INVALID) stop BRAIN_REQUEST_INVALID "$(br WHY)" ;;
  *) stop BRAIN_REQUEST_INVALID "brain-request.mjs devolvio una respuesta inesperada ('$(printf '%s' "$BR_FIRST" | cut -c1-60)'); no avanzo" ;;
esac

# ---------- 1c. politica project_docs: la base documental aprobada antes del primer spec ----------
if [ "$PROJECT_DOCS" = "required" ]; then
  STATE=project
  if ! PG="$(node "$PROJECT_LINT" gate --root "$WT" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"; then
    PG_LISTO="$(printf '%s\n' "$PG" | sed -n 's/^GATE \([0-9][0-9]-[a-z-]*\): LISTO$/\1/p' | paste -sd' ' -)"
    stop HUMAN_CONFIRM_PROJECT "project_docs=required: la base documental del proyecto no esta aprobada y fresca.
$(printf '%s\n' "$PG" | head -12)
Completala con /factory-init; el humano aprueba cada documento listo con el CMD (si lo hay)." ${PG_LISTO:+"node factory/scripts/project-lint.mjs approve ${PG_LISTO}"}
  fi
fi

# ---------- 2. spec + tasks ----------
STATE=2
SPEC="${JOB_DIR}/spec.md"; TASKS="${JOB_DIR}/tasks.md"
spec_problem() { # un problema por linea (vacio = valido). Lo calcula spec-lint.mjs segun el perfil del proyecto.
  nonempty "$SPEC" || { echo "falta spec.md o esta vacio"; return; }
  node "$SPEC_LINT" check "$SPEC" "$TASKS" "$SPEC_PROFILE" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g'
}
P="$(spec_problem)"
if [ -n "$P" ]; then
  WHAT="SDD spec con Surface, criterios numerados y Alcance, y el desglose de tareas"
  [ "$SPEC_PROFILE" != "full" ] || WHAT="SDD spec completo (perfil full: Actores, Requisitos funcionales RF-n, Diseño, ADR, criterios que citan [RF-n], Alcance) y tasks.md con el RF que cubre cada tarea; plantilla en 02-DOCS/wiki/sdd/spec-template.md"
  delegate spec-writer "$WHAT" "factory/jobs/${JOB_ID}/spec.md,factory/jobs/${JOB_ID}/tasks.md" "$(printf '%s\n' "$P" | paste -sd';' - | sed 's/;/; /g')"
fi

# ---------- 3. confirmacion humana del spec ----------
STATE=3
SURFACE="$(sed -n 's/^[Ss]urface:[[:space:]]*//p' "$SPEC" | head -1 | trim | tr 'A-Z' 'a-z')"
if [ "$REQUIRE_SPEC_OK" = "1" ]; then
  if [ ! -f "${JOB_DIR}/spec.ok" ]; then WHYSPEC="el humano aun no confirmo el spec"
  elif [ "$SPEC" -nt "${JOB_DIR}/spec.ok" ]; then WHYSPEC="spec.md cambio despues de la confirmacion (spec.ok es mas antiguo)"
  else WHYSPEC=""; fi
  if [ -n "$WHYSPEC" ]; then
    SUMMARY="$(node "$SPEC_LINT" summary "$SPEC" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g')"
    stop HUMAN_CONFIRM_SPEC "${WHYSPEC}
${SUMMARY}
Lee ${SPEC} y, si esta bien, confirma con el CMD (solo el humano crea esta marca)." "touch factory/jobs/${JOB_ID}/spec.ok"
  fi
fi

# ---------- 4. el builder ha commiteado algo? ----------
STATE=4
# Los commits que solo tocan la base documental (peticiones aplicadas, 1b) no son trabajo del builder.
NCOMMITS="$(git --no-optional-locks -C "$ROOT" rev-list --count "${JOB_BASE}..${HEAD_SHA}" -- . ':(exclude)02-DOCS/wiki/project' ':(exclude)02-DOCS/wiki/sdd/decisions.md' 2>/dev/null)" || stop BASE_UNKNOWN "no pude contar los commits del job sobre ${JOB_BASE}"
[ "$NCOMMITS" -gt 0 ] || delegate builder "implementar el spec con TDD y commitear (solo en la worktree)" "factory/worktrees/${JOB_ID}/" "la worktree no tiene commits sobre ${JOB_BASE}"

# ---------- 5. gate vigente ----------
STATE=5
# Cambios sin commitear: los del curator (Brain del job) se commitean en el estado 11; cualquier otro => STOP.
CURATOR_RE='^(02-DOCS/wiki/jobs/|02-DOCS/wiki/index\.md$|02-DOCS/wiki/sdd/decisions\.md$)'
DIRT_ALL="$(wt_git status --porcelain=v1 -z --untracked-files=all 2>/dev/null | tr '\0' '\n' | sed 's/^...//' | grep . || true)"
DIRT_CODE="$(printf '%s\n' "$DIRT_ALL" | grep -vE "$CURATOR_RE" | grep . || true)"
if [ -n "$DIRT_CODE" ]; then
  stop WORKTREE_DIRTY "la worktree tiene cambios sin commitear: el gate y los reviews verian codigo que no se subiria.
$(printf '%s\n' "$DIRT_CODE" | head -10)
Comitea (git add <archivos concretos>) o descarta esos cambios y vuelve a llamar."
fi
fresh() { factory_commit_fresh "$1" "$HEAD_SHA" "$WT"; }   # igual a HEAD, o lo posterior solo es documentacion del curator
GATE="${JOB_DIR}/gate.md"
CHECKS_CMD="cd factory/worktrees/${JOB_ID} && bash 01-TOOLS/checks.sh ${JOB_ID}"
[ -f "$GATE" ] || run_ "$CHECKS_CMD" "falta gate.md"
GATE_L1="$(line1 "$GATE")"
GATE_COMMIT="$(sed -n '1,8p' "$GATE" | sed -n 's/^COMMIT: \([0-9a-f]\{7,40\}\)\r\{0,1\}$/\1/p' | head -1)"
case "$GATE_L1" in "GATE: PASS"|"GATE: FAIL") ;; *) run_ "$CHECKS_CMD" "gate.md ilegible (linea 1: '${GATE_L1}'): se regenera con el script" ;; esac
[ -n "$GATE_COMMIT" ] || run_ "$CHECKS_CMD" "gate.md sin linea COMMIT: no se puede atar a un commit"
fresh "$GATE_COMMIT" || run_ "$CHECKS_CMD" "gate.md obsoleto (es de ${GATE_COMMIT:0:7}, HEAD es ${HEAD_SHA:0:7})"

# rondas existentes
CUR=0
for d in "${JOB_DIR}"/round-*; do
  [ -d "$d" ] || continue
  n="${d##*/round-}"; [[ "$n" =~ ^[0-9]+$ ]] || continue
  [ "$n" -gt "$CUR" ] && CUR="$n"
done

# ---------- 6. gate en rojo ----------
STATE=6
if [ "$GATE_L1" = "GATE: FAIL" ]; then
  STREAK="$(sed -n '1,8p' "$GATE" | sed -n 's/^GATE_FAIL_STREAK: \([0-9][0-9]*\)\r\{0,1\}$/\1/p' | head -1)"
  if [ "$CUR" -ge "$MAX_ROUNDS" ] || [ "${STREAK:-1}" -ge "$MAX_ROUNDS" ]; then
    stop MAX_ROUNDS "el gate sigue en rojo y se agotaron las rondas (max_rounds=${MAX_ROUNDS}, rondas=${CUR}, gates seguidos en rojo=${STREAK:-?}). Decide tu."
  fi
  delegate builder "corregir lo que reporta gate.md y commitear (solo en la worktree)" "factory/worktrees/${JOB_ID}/" "GATE: FAIL; lee factory/jobs/${JOB_ID}/gate.md"
fi

# ---------- 7. reviews vigentes ----------
STATE=7
reviews_ok() { VALIDATE_REVIEWS_ONLY=1 bash "${HERE}/validate-artifacts.sh" "$JOB_ID" "$1" >/dev/null 2>&1; }
launch() { # launch <ronda> <por que>
  [ "$1" -le "$MAX_ROUNDS" ] || stop MAX_ROUNDS "haria falta la ronda $1 y max_rounds=${MAX_ROUNDS}. Decide tu."
  run_ "cd factory/worktrees/${JOB_ID} && bash 01-TOOLS/launch-reviewers.sh ${JOB_ID} $1" "$2"
}
if [ "$CUR" -eq 0 ]; then launch 1 "aun no hay reviews"; fi
RDIR="${JOB_DIR}/round-${CUR}"
RC="$(head -1 "${RDIR}/.commit" 2>/dev/null | trim)"
if [ -z "$RC" ]; then launch "$CUR" "la ronda ${CUR} no termino (sin .commit): se repite"
elif ! fresh "$RC"; then launch $((CUR + 1)) "los reviews de la ronda ${CUR} son de ${RC:0:7} y HEAD es ${HEAD_SHA:0:7}"
elif ! reviews_ok "$CUR"; then launch "$CUR" "los reviews de la ronda ${CUR} faltan o no cumplen el formato VERDICT/SCORE"
fi
if grep -ql '^REVIEWER_FALLO' "${RDIR}"/review-*.md 2>/dev/null; then
  stop REVIEWER_FAILED "algun reviewer fallo (infraestructura, no codigo): $(grep -l '^REVIEWER_FALLO' "${RDIR}"/review-*.md | xargs -n1 basename | paste -sd, -).
No se lo mando al builder. Revisa memoria/modelos y repite la ronda." "cd factory/worktrees/${JOB_ID} && bash 01-TOOLS/launch-reviewers.sh ${JOB_ID} ${CUR}"
fi

# ---------- 8. decision del approver ----------
STATE=8
DEC="${JOB_DIR}/decision.md"
if [ ! -f "$DEC" ]; then delegate approver "consolidar los 4 reviews de la ronda ${CUR} en APPROVE, CHANGES o ESCALATE (linea 1); para ver los commits usa git -C factory/worktrees/${JOB_ID} log o diff" "factory/jobs/${JOB_ID}/decision.md" "falta decision.md"; fi
if ! [ "$DEC" -nt "${RDIR}/.commit" ]; then
  delegate approver "consolidar los 4 reviews de la ronda ${CUR} (decision.md es anterior a esos reviews); para ver los commits usa git -C factory/worktrees/${JOB_ID} log o diff" "factory/jobs/${JOB_ID}/decision.md" "decision.md obsoleta"
fi
DECISION="$(line1 "$DEC")"

# ---------- 9. CHANGES / ESCALATE ----------
STATE=9
case "$DECISION" in
  APPROVE) ;;
  CHANGES)
    [ "$CUR" -lt "$MAX_ROUNDS" ] || stop MAX_ROUNDS "el approver pide CHANGES en la ronda ${CUR} y max_rounds=${MAX_ROUNDS}. Decide tu."
    delegate builder "aplicar los cambios que pide el approver y commitear (solo en la worktree)" "factory/worktrees/${JOB_ID}/" "decision.md = CHANGES; lee factory/jobs/${JOB_ID}/decision.md y round-${CUR}/review-*.md" ;;
  ESCALATE) stop ESCALATED "el approver escalo el job a un humano (decision.md = ESCALATE). Lee factory/jobs/${JOB_ID}/decision.md." ;;
  *) stop DECISION_INVALID "decision.md linea 1 no es APPROVE | CHANGES | ESCALATE (tiene: '${DECISION}')" ;;
esac

# ---------- 10. human gate ----------
STATE=10
HUM="${JOB_DIR}/human.md"
RISK_CMD="cd factory/worktrees/${JOB_ID} && bash 01-TOOLS/risk.sh ${JOB_ID}"
if [ ! -f "$HUM" ]; then run_ "$RISK_CMD" "falta human.md"; fi
if ! [ "$HUM" -nt "$DEC" ]; then run_ "$RISK_CMD" "human.md es anterior a decision.md"; fi
HUM_L1="$(line1 "$HUM")"
case "$HUM_L1" in
  NEEDS_HUMAN) ;;
  FAST_PATH)
    [ "$(factory_cfg '(c.fast_path||{}).enabled' false)" = "true" ] || stop HUMAN_LINE_INVALID "human.md dice FAST_PATH pero fast_path.enabled no es true: la linea 1 la fija risk.sh, alguien la cambio. Regenera con risk.sh." "$RISK_CMD" ;;
  *) stop HUMAN_LINE_INVALID "human.md linea 1 no es FAST_PATH | NEEDS_HUMAN (tiene: '${HUM_L1}')" "$RISK_CMD" ;;
esac
if [ "$HUM_L1" = "NEEDS_HUMAN" ] && ! grep -q '^## Resumen para el humano' "$HUM"; then
  delegate human-gate "añadir al final de human.md la seccion '## Resumen para el humano' (riesgos, evidencias, checklist); NO cambiar la linea 1" "factory/jobs/${JOB_ID}/human.md" "NEEDS_HUMAN sin resumen para el humano"
fi

# ---------- 11. documentacion: trace + Brain del job (antes del push) ----------
STATE=11
TRACE="${JOB_DIR}/trace.md"
JOB_PAGE="02-DOCS/wiki/jobs/${JOB_ID}.md"
ADR_TITLE="$(node "$SPEC_LINT" adr "$SPEC" 2>/dev/null | head -1 | trim)"; [ -n "$ADR_TITLE" ] || ADR_TITLE=none
NEXT_ADR="$(sed -n 's/^## ADR-0*\([0-9][0-9]*\):.*/\1/p' "${WT}/02-DOCS/wiki/sdd/decisions.md" 2>/dev/null | sort -n | tail -1)"; NEXT_ADR="$(printf '%03d' $(( 10#${NEXT_ADR:-0} + 1 )))"
if [ "$REQUIRE_SPEC_OK" = "1" ]; then ADR_STATUS=Aprobado; ADR_WHY="el humano confirmo el spec con spec.ok: esa confirmacion aprueba la decision, no hay otro paso manual"
else ADR_STATUS=Propuesto; ADR_WHY="este proyecto no exige spec.ok, asi que nadie aprobo la decision: la aprueba el humano al revisar el PR"; fi
brain_problem() { # imprime por que el Brain/trace no sirve (vacio = valido)
  [ -f "$TRACE" ] || { echo "falta trace.md"; return; }
  grep -q '^Brain: .' "$TRACE" || { echo "trace.md sin linea 'Brain: <paginas>'"; return; }
  [ "$TRACE" -nt "$HUM" ] || { echo "trace.md es anterior a human.md"; return; }
  local line pages p listed=" "
  line="$(grep -m1 '^Brain: ' "$TRACE" | sed 's/^Brain:[[:space:]]*//; s/\r$//')"
  if [ "$line" != "sin cambios" ]; then
    IFS=',' read -r -a pages <<< "$line"
    for p in "${pages[@]}"; do
      p="$(printf '%s' "$p" | trim)"
      [[ "$p" =~ ^02-DOCS/wiki/[A-Za-z0-9._/-]+$ ]] && [[ "$p" != *..* ]] || { echo "la linea Brain: lista '${p}', que no es una pagina de 02-DOCS/wiki/"; return; }
      printf '%s\n' "$p" | grep -qE "$CURATOR_RE" || { echo "el curator solo puede escribir ${JOB_PAGE}, 02-DOCS/wiki/index.md y 02-DOCS/wiki/sdd/decisions.md (no '${p}')"; return; }
      [ -f "${WT}/${p}" ] || { echo "la pagina '${p}' de la linea Brain: no existe en la worktree (${WT})"; return; }
      listed="${listed}${p} "
    done
  fi
  [ "$SPEC_PROFILE" = "full" ] || [ "$ADR_TITLE" != "none" ] || return 0
  if [ "$SPEC_PROFILE" = "full" ]; then
    case "$listed" in *" ${JOB_PAGE} "*) ;; *) echo "perfil full: la linea Brain: debe incluir ${JOB_PAGE}"; return ;; esac
    local h; for h in "Actores" "Requisitos funcionales" "Diseño" "Implementación" "Pruebas" "Lecciones"; do
      grep -qiE "^#{2,3}[[:space:]]+${h}" "${WT}/${JOB_PAGE}" || { echo "${JOB_PAGE} sin la seccion '## ${h}'"; return; }
    done
    grep -q "${GATE_COMMIT:0:7}" "${WT}/${JOB_PAGE}" || { echo "${JOB_PAGE} no cita el commit del gate (${GATE_COMMIT:0:7}): las pruebas se afirman con la evidencia de gate.md, no de memoria"; return; }
  fi
  if [ "$ADR_TITLE" != "none" ]; then
    case "$listed" in *" 02-DOCS/wiki/sdd/decisions.md "*) ;; *) echo "el spec declara 'ADR: ${ADR_TITLE}': la linea Brain: debe incluir 02-DOCS/wiki/sdd/decisions.md"; return ;; esac
    grep -E '^## ADR-[0-9]+:' "${WT}/02-DOCS/wiki/sdd/decisions.md" | grep -qiF -- "$ADR_TITLE" || { echo "decisions.md no tiene un '## ADR-N: ${ADR_TITLE}'"; return; }
    # El estado del ADR no lo decide el curator: lo fija la aprobacion humana del flujo (spec.ok confirma el diseño y la decision).
    ADR_BLOCK="$(awk -v t="$ADR_TITLE" '/^## ADR-[0-9]+:/ { if (inb) exit; if (index(tolower($0), tolower(t))) { inb=1; next } } inb && /^## / { exit } inb { print }' "${WT}/02-DOCS/wiki/sdd/decisions.md")"
    printf '%s\n' "$ADR_BLOCK" | grep -qE "^Estado:[[:space:]]*${ADR_STATUS}\b" || { echo "el ADR '${ADR_TITLE}' debe llevar 'Estado: ${ADR_STATUS}' (${ADR_WHY})"; return; }
  fi
}
BP="$(brain_problem)"
if [ -n "$BP" ]; then
  WHAT="actualizar el Brain EN LA WORKTREE (solo ${JOB_PAGE}, index.md y decisions.md) y completar trace.md con una linea 'Brain: <paginas separadas por coma, o sin cambios>'"
  [ "$SPEC_PROFILE" != "full" ] || WHAT="escribir ${JOB_PAGE} en la worktree (## Resumen, Actores, Requisitos funcionales, Diseño, Implementación, Pruebas citando el COMMIT de gate.md, Lecciones), enlazarla en index.md y completar trace.md con 'Brain: <paginas>'"
  [ "$ADR_TITLE" = "none" ] || WHAT="${WHAT}; registrar en decisions.md '## ADR-${NEXT_ADR}: ${ADR_TITLE}' con 'Estado: ${ADR_STATUS}' (${ADR_WHY})"
  FILES="factory/jobs/${JOB_ID}/trace.md,factory/worktrees/${JOB_ID}/${JOB_PAGE},factory/worktrees/${JOB_ID}/02-DOCS/wiki/index.md"
  [ "$ADR_TITLE" = "none" ] || FILES="${FILES},factory/worktrees/${JOB_ID}/02-DOCS/wiki/sdd/decisions.md"
  delegate memory-curator "$WHAT" "$FILES" "$BP"
fi
# La documentacion escrita se commitea en la rama del job para que viaje en el PR (no invalida gate ni reviews).
if [ -n "$DIRT_ALL" ]; then
  run_ "cd factory/worktrees/${JOB_ID} && bash 01-TOOLS/commit-brain.sh ${JOB_ID}" "hay documentacion del curator sin commitear en la worktree"
fi

STATE="11b"
# ---------- 11b. superficies que exigen revision humana antes de subir ----------
if [ -n "$HUMAN_SURFACES" ] && [ -n "$SURFACE" ] && printf ',%s,' "$HUMAN_SURFACES" | grep -q ",${SURFACE},"; then
  if [ ! -f "${JOB_DIR}/review.ok" ] || ! [ "${JOB_DIR}/review.ok" -nt "$HUM" ]; then
    stop HUMAN_REVIEW "la superficie '${SURFACE}' exige que un humano revise antes de subir (factory/project.json: human_review_surfaces).
Revisa la worktree ${WT} y factory/jobs/${JOB_ID}/human.md; si esta bien, confirma con el CMD." "touch factory/jobs/${JOB_ID}/review.ok"
  fi
fi

# ---------- 12. push ----------
STATE=12
git --no-optional-locks -C "$ROOT" remote get-url origin >/dev/null 2>&1 || stop NO_REMOTE "el repositorio no tiene remoto 'origin': no puedo subir ${BRANCH}."
REMOTE_SHA="$(git --no-optional-locks -C "$ROOT" rev-parse -q --verify "refs/remotes/origin/${BRANCH}" 2>/dev/null || true)"
[ "$REMOTE_SHA" = "$HEAD_SHA" ] || run_ "git push -u origin ${BRANCH}" "origin/${BRANCH} no está al día con HEAD (${HEAD_SHA:0:7})"

# ---------- 13. PR en borrador ----------
STATE=13
if [ -s "${JOB_DIR}/pr.url" ]; then done_ "PR registrado por el humano: $(head -1 "${JOB_DIR}/pr.url")"; fi
TITLE="$(sed -n 's/^#[[:space:]]*//p' "$SPEC" | head -1 | tr -cd 'A-Za-z0-9 ._:-' | cut -c1-70 | trim)"; [ -n "$TITLE" ] || TITLE="${JOB_ID}"
BODY="Job ${JOB_ID}. Evidencia en factory/jobs/${JOB_ID}/ (decision.md, human.md, trace.md). PR en borrador: lo revisa y fusiona un humano."
PRCMD="gh pr create --draft --base ${BASE_NAME} --head ${BRANCH} --title '${TITLE}' --body '${BODY}'"
GH="${GH_BIN:-gh}"
if ! command -v "$GH" >/dev/null 2>&1; then
  URL="$(git --no-optional-locks -C "$ROOT" remote get-url origin | sed -E 's#^(git@|https://)github\.com[:/]##; s#\.git$##')"
  stop HUMAN_CREATE_PR "gh no esta instalado: crea tu el PR en borrador. Cuando exista, guarda su URL en pr.url para que el job cierre." \
    "${PRCMD}" "o abre: https://github.com/${URL}/compare/${BASE_NAME}...${BRANCH}?expand=1" "echo <URL-del-PR> > factory/jobs/${JOB_ID}/pr.url"
fi
PR_URL="$("$GH" pr view "$BRANCH" --json url -q .url 2>/dev/null | head -1 | trim)"
if [ -n "$PR_URL" ]; then done_ "PR: ${PR_URL}"; fi
run_ "$PRCMD" "no hay PR para ${BRANCH}"
