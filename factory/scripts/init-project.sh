#!/usr/bin/env bash
# init-project.sh — prepara un proyecto para /factory-init: deriva el modo, comprueba requisitos y aplica, de uno en uno, los pasos locales.
# Por defecto NO escribe nada (dry-run): informa. Salida CLAVE=valor y lineas CHECK:/STEP:/MANUAL: legibles; la ultima es HANDOFF=.
#
# Uso:  bash factory/scripts/init-project.sh [--dir <proyecto>]                              # dry-run
#       bash factory/scripts/init-project.sh [--dir <proyecto>] --apply <paso> [-- <extra>]  # aplica UN paso
# Pasos:  install (la fabrica no esta en el destino: install-into.sh --apply) · deps · hooks · rsc · workspace
#   rsc:       rsc-pin.sh --apply; lo que va tras `--` se le pasa (--technical-level, --goal, --accept-plan <id>); RSC es opcional.
#   workspace: crea (o reutiliza) el job de documentacion init-<aammdd>-<4 hex> con new-job.sh --kind docs: rama factory/<id> y su worktree.
# Modo: A proyecto vacio · B con .md y sin codigo · C con codigo · D base documental empezada (fabrica instalada y PROJECT partial|stale).
# Nunca ejecuta sudo, install-managed.sh --apply ni onboard-project.sh --apply, ni toca /etc/opencode: los imprime como MANUAL:.
# El script no pregunta nada: la aprobacion de cada --apply la da el humano en OpenCode (el agente discovery tiene `ask` sobre --apply).
# Variables: FACTORY_TEST_CMD (runner de tests), FACTORY_BASE (rama base), OPENCODE_BIN y FACTORY_MODELS_FILE (ver validate-models.mjs).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SRC="$(cd "${HERE}/../.." && pwd -P)"
usage() { sed -n '2,13p' "$0"; exit "${1:-2}"; }

DIR="."; APPLY=""; EXTRA=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="${2:?falta valor}"; shift 2 ;;
    --apply) APPLY="${2:?falta el paso}"; shift 2 ;;
    --) shift; EXTRA=("$@"); break ;;
    -h|--help) usage 0 ;;
    *) echo "opcion desconocida: $1" >&2; usage ;;
  esac
done
case "$APPLY" in ""|install|deps|hooks|rsc|workspace) ;; *) echo "ERROR: paso desconocido '${APPLY}' (install|deps|hooks|rsc|workspace)" >&2; exit 2 ;; esac
[ ${#EXTRA[@]} -eq 0 ] || [ "$APPLY" = rsc ] || { echo "ERROR: los argumentos tras -- solo valen para --apply rsc" >&2; exit 2; }
[ -d "$DIR" ] || { echo "ERROR: el destino no existe o no es una carpeta: ${DIR}" >&2; exit 1; }
DIR="$(cd "$DIR" && pwd -P)"
TOP="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null)" || { echo "ERROR: ${DIR} no es un repositorio git" >&2; exit 1; }
[ "$(cd "$TOP" && pwd -P)" = "$DIR" ] || { echo "ERROR: ${DIR} esta dentro del repo ${TOP}; indica la raiz del repo" >&2; exit 1; }

# ---- requisitos (RF-I10): un ERROR corta; un AVISO informa ----
ERRORS=0
chk() { echo "CHECK:$1 $2 ${3:-}"; if [ "$2" = ERROR ]; then ERRORS=$((ERRORS + 1)); fi; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -ge 20 ]; then chk node OK "v${NODE_MAJOR}"; else chk node ERROR "hace falta node >= 20"; fi
if command -v git >/dev/null 2>&1; then chk git OK; else chk git ERROR "hace falta git"; fi
if command -v "${OPENCODE_BIN:-opencode}" >/dev/null 2>&1; then chk opencode OK; else chk opencode ERROR "no esta opencode en el PATH"; fi
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then chk gh OK; else chk gh WARN "gh o gh auth status no responden: hacen falta para abrir el PR"; fi
if [ "$ERRORS" -gt 0 ]; then echo "ERROR: faltan requisitos (${ERRORS}); no sigo" >&2; echo "HANDOFF=blocked REASON=requirements"; exit 1; fi

# ---- fabrica instalada, herramientas y modo (derivados, no guardados); se recalculan tras aplicar un paso ----
derive() {
  if [ -f "${DIR}/factory/project.json" ] && [ -f "${DIR}/01-TOOLS/next-step.sh" ]; then FACTORY=installed; T="$DIR"; else FACTORY=missing; T="$SRC"; fi
  LINT="${T}/factory/scripts/project-lint.mjs"
  RSCPIN="${T}/factory/scripts/rsc-pin.sh"
  CONTENT="$(content_kind)"
  PROJECT="none"
  if [ -f "$LINT" ]; then
    PROJECT="$(node "$LINT" state --root "$DIR" 2>/dev/null | sed -n 's/^PROJECT=//p' | head -1)"
    [ -n "$PROJECT" ] || { echo "ERROR: project-lint state no respondio; no adivino el modo" >&2; echo "HANDOFF=blocked REASON=project-lint"; exit 1; }
  fi
  NEXT="$( [ -f "$LINT" ] && node "$LINT" state --root "$DIR" 2>/dev/null | sed -n 's/^NEXT=\([^ ]*\).*/\1/p' | head -1 || true)"; NEXT="${NEXT:--}"
  if [ "$FACTORY" = installed ] && { [ "$PROJECT" = partial ] || [ "$PROJECT" = stale ]; }; then MODE=D; else MODE="$CONTENT"; fi
}
content_kind() {
  node -e '
  const fs=require("fs"), path=require("path"); const root=process.argv[1];
  const ANYWHERE=new Set([".git","node_modules"]);   // en cualquier nivel
  const TOP=new Set([".worktrees","factory",".rsc",".opencode",".hooks",".agents","01-TOOLS","03-SKILLS"]);   // solo en la raiz: son de la fabrica o de RSC
  const SKIP_PATH=["02-DOCS/wiki/sdd","02-DOCS/wiki/harness","02-DOCS/wiki/project","02-DOCS/wiki/jobs","02-DOCS/wiki/index.md","02-DOCS/wiki/context.md","AGENTS.md","AGENTS.factory.md"];
  const EXT=new Set("js mjs cjs ts tsx jsx py go rs java kt rb php cs cpp cc c h hpp swift scala sh ex exs dart lua sql vue svelte".split(" "));
  const MANIFEST=new Set(["pyproject.toml","go.mod","Cargo.toml","pom.xml","build.gradle","build.gradle.kts","Gemfile","composer.json","requirements.txt","setup.py","mix.exs","deno.json"]);
  // el package.json minimo que crea install-into.sh (solo scripts factory:*, hooks:install y el test de relleno) no es codigo del proyecto
  const realPkg=(f)=>{ try { const p=JSON.parse(fs.readFileSync(f,"utf8")); if (p.dependencies||p.devDependencies||p.peerDependencies||p.main||p.bin||p.workspaces) return true;
    return Object.entries(p.scripts||{}).some(([k,v])=>!/^(factory:|hooks:install$)/.test(k) && !(k==="test"&&/define aqui/.test(v))); } catch { return true; } };
  let md=false, code=false;
  (function walk(d, rel){ for (const e of fs.readdirSync(d,{withFileTypes:true})) {
    if (e.isSymbolicLink()) continue; const r=rel?rel+"/"+e.name:e.name;
    if (e.isDirectory()) { if (ANYWHERE.has(e.name) || (!rel && TOP.has(e.name)) || SKIP_PATH.includes(r)) continue; walk(path.join(d,e.name), r); continue; }
    if (SKIP_PATH.includes(r)) continue;
    if (e.name==="package.json") { if (realPkg(path.join(d,e.name))) code=true; continue; }
    if (MANIFEST.has(e.name) || EXT.has(e.name.split(".").pop())) code=true; else if (/\.md$/i.test(e.name)) md=true; } })(root,"");
  console.log(code?"C":md?"B":"A")' "$DIR"
}

derive
if [ "$FACTORY" = installed ]; then
  mm="$(cd "$DIR" && node "${T}/factory/scripts/validate-models.mjs" --config 2>&1)" && chk models OK || chk models WARN "$(printf '%s' "$mm" | tail -3 | tr '\n' ' ')"
  # runner de tests: scripts.test real, FACTORY_TEST_CMD o gate.test_cmd (el gate falla sin uno)
  if [ -n "${FACTORY_TEST_CMD:-}" ] || (cd "$DIR" && node -e '
      const fs=require("fs"); let ok=false;
      try { const s=(JSON.parse(fs.readFileSync("package.json","utf8")).scripts||{}).test; ok=!!s && !/no test specified|define aqui/.test(s); } catch {}
      try { if ((JSON.parse(fs.readFileSync("factory/config.json","utf8")).gate||{}).test_cmd) ok=true; } catch {}
      process.exit(ok?0:1)') 2>/dev/null; then chk tests OK; else chk tests WARN "no hay runner de tests (scripts.test, FACTORY_TEST_CMD o gate.test_cmd): el gate fallara"; fi
fi

# ---- estado de cada paso ----
open_job() { # id del job de documentacion abierto (init-*, con worktree y sin PR), el mas reciente
  local d id
  for d in $(ls -d "${DIR}"/factory/jobs/init-*/ 2>/dev/null | sort -r); do
    id="$(basename "$d")"
    if [ -f "${d}job.json" ] && [ -d "${DIR}/factory/worktrees/${id}" ] && [ ! -f "${d}pr.url" ]; then echo "$id"; return 0; fi
  done
  return 0
}
pkg_has_script() { node -e 'try{process.exit((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).scripts||{})[process.argv[2]]?0:1)}catch{process.exit(1)}' "${DIR}/package.json" "$1"; }
state_install() { [ "$FACTORY" = installed ] && echo DONE || echo PENDING; }
state_deps() {
  if [ -f "${DIR}/package-lock.json" ]; then [ -d "${DIR}/node_modules" ] && echo DONE || echo PENDING
  elif [ -f "${DIR}/pnpm-lock.yaml" ] || [ -f "${DIR}/yarn.lock" ] || [ -f "${DIR}/bun.lockb" ]; then echo MANUAL
  else echo SKIP; fi
}
state_hooks() {
  [ "$FACTORY" = installed ] || { echo BLOCKED; return; }
  [ "$(git -C "$DIR" config --get core.hooksPath || true)" = ".hooks/git" ] && echo DONE || echo PENDING
}
state_rsc() {
  [ "$FACTORY" = installed ] || { echo BLOCKED; return; }
  [ -f "${DIR}/.rsc.json" ] || { echo OPTIONAL; return; }
  bash "$RSCPIN" --dir "$DIR" --check >/dev/null 2>&1 && echo DONE || echo PENDING
}
state_workspace() {
  [ "$FACTORY" = installed ] || { echo BLOCKED; return; }
  [ -n "$(open_job)" ] && echo DONE || echo PENDING
}

# ---- aplicar UN paso (cada uno comprueba antes si ya esta hecho) ----
if [ -n "$APPLY" ]; then
  st="$(state_"$APPLY")"
  case "$st" in
    DONE) echo "DONE:${APPLY}" ;;
    BLOCKED) echo "ERROR: el paso ${APPLY} necesita la fabrica instalada en ${DIR} (paso install)" >&2; echo "HANDOFF=blocked REASON=factory-missing"; exit 1 ;;
    SKIP) echo "SKIP:${APPLY} (nada que hacer)" ;;
    MANUAL) echo "ERROR: ${APPLY}: este gestor de paquetes no se automatiza; ejecuta tu el comando que indica MANUAL:" >&2; exit 1 ;;
    *)
      echo "APPLY:${APPLY}"
      case "$APPLY" in
        install) bash "${SRC}/factory/scripts/install-into.sh" "$DIR" --apply ;;
        deps) (cd "$DIR" && npm ci) ;;
        hooks) if pkg_has_script hooks:install; then (cd "$DIR" && npm run hooks:install); else (cd "$DIR" && bash .hooks/install-git-hooks.sh); fi ;;
        rsc) rc=0; bash "$RSCPIN" --dir "$DIR" --apply "${EXTRA[@]}" || rc=$?; if [ "$rc" -ne 0 ]; then echo "STEP:rsc exit=${rc} (3 = falta aceptar el plan; ver arriba)"; exit "$rc"; fi ;;
        workspace) ID="init-$(date +%y%m%d)-$(od -An -N2 -tx1 /dev/urandom | tr -d ' \n')"; (cd "$DIR" && bash 01-TOOLS/new-job.sh "$ID" --kind docs) ;;
      esac ;;
  esac
fi

# ---- informe (con el estado recalculado: un paso aplicado puede haber instalado la fabrica o creado el job) ----
derive
echo "DIR=${DIR}"
echo "CONTENT=${CONTENT}"
echo "FACTORY=${FACTORY}"
echo "PROJECT=${PROJECT}"
echo "MODE=${MODE}"
for s in install deps hooks rsc workspace; do
  st="$(state_"$s")"
  case "$s:$st" in
    install:PENDING) echo "STEP:install PENDING instala la fabrica en el destino (--apply install); dry-run: bash ${SRC}/factory/scripts/install-into.sh ${DIR}" ;;
    install:DONE) echo "DONE:install" ;;
    deps:PENDING) echo "STEP:deps PENDING npm ci" ;;
    deps:MANUAL) echo "MANUAL: instala las dependencias con tu gestor de paquetes (pnpm install | yarn install | bun install)" ;;
    hooks:PENDING) echo "STEP:hooks PENDING activa los hooks de git (core.hooksPath = .hooks/git)" ;;
    rsc:OPTIONAL) echo "STEP:rsc OPTIONAL RSC no esta instalado (es opcional): --apply rsc -- --technical-level <non-technical|mixed|technical> --goal \"<para que es el proyecto>\"" ;;
    rsc:PENDING) echo "STEP:rsc PENDING RSC instalado pero no esta fijado/apagado (rsc-pin.sh --check)" ;;
    workspace:PENDING) echo "STEP:workspace PENDING crea el job de documentacion init-<aammdd>-<4 hex> (rama factory/<id>, worktree)" ;;
    *:BLOCKED) echo "STEP:${s} BLOCKED necesita la fabrica instalada" ;;
    *:SKIP) echo "SKIP:${s}" ;;
    *) echo "${st}:${s}" ;;
  esac
done
# pasos que son del humano: se imprimen, nunca se ejecutan
if [ -f "${T}/factory/scripts/install-managed.sh" ] && ! bash "${T}/factory/scripts/install-managed.sh" --check >/dev/null 2>&1; then
  echo "MANUAL: sudo bash ${T}/factory/scripts/install-managed.sh --apply   # config managed de OpenCode (lo ejecutas tu)"
fi
echo "MANUAL: bash ${T}/factory/scripts/onboard-project.sh OWNER/REPO --check-name ci   # dry-run del ruleset de main; el --apply lo ejecutas tu"
if [ "$FACTORY" = installed ] && [ -n "$(git -C "$DIR" status --porcelain -- factory 01-TOOLS .opencode opencode.json 2>/dev/null | head -1)" ]; then
  echo "WARN: la instalacion de la fabrica no esta commiteada: la worktree del job saldra de la rama base sin ella"
fi

JOB="$(open_job)"; JOB="${JOB:--}"
if [ "$FACTORY" = missing ]; then echo "HANDOFF=blocked REASON=factory-missing MODE=${MODE}"; exit 0; fi
[ "$JOB" = - ] || echo "JOB_WORKTREE=${DIR}/factory/worktrees/${JOB}"
echo "HANDOFF=discovery MODE=${MODE} JOB=${JOB} NEXT=${NEXT}"
