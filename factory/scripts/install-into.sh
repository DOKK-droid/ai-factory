#!/usr/bin/env bash
# install-into.sh — monta la fabrica en OTRO proyecto (repo git existente) con un Brain limpio.
# Por defecto NO escribe nada (dry-run): lista que copiaria, que crearia y que choca. Solo con --apply escribe.
#
# Uso:  bash factory/scripts/install-into.sh <ruta-destino> [--name <nombre>]             # dry-run
#       bash factory/scripts/install-into.sh <ruta-destino> [--name <nombre>] --apply     # instala
#       bash factory/scripts/install-into.sh <ruta-destino> --check                       # compara lo instalado con la fuente
#       bash factory/scripts/install-into.sh --list                                       # manifiesto (tipo<TAB>ruta)
# Opciones: --engine <motor>  motor de IA del destino; decide donde van las skills de terceros. Hoy solo `opencode` (por defecto).
#           --force  instala aunque el arbol del destino tenga cambios y sobrescribe maquinaria que difiere
#                    (nunca sobrescribe el Brain, project.json, package.json ni AGENTS.md del destino).
# Requisitos del destino: existe, es la raiz de un repo git, arbol limpio (o --force); no es esta fabrica.
# No toca /etc/opencode, no instala hooks de git, no crea reglas de GitHub y no instala el harness RSC (eso lo hace `npx @ericrisco/rsc`).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SRC="$(cd "${HERE}/../.." && pwd -P)"

# ---------------------------------------------------------------------------------------------------------
# MANIFIESTO — unico sitio donde se decide que se copia. Rutas relativas a la raiz de la fabrica; solo se
# copian archivos SEGUIDOS por git (el ruido sin seguir, p. ej. .opencode/rsc o .worktrees, nunca viaja).
# `tests/`, los ADR y la constitucion de la fabrica, los jobs, docs/PATCH* y .rsc* no estan aqui a proposito.
# Las skills de terceros (.agents/skills en OpenCode) dependen del motor: ver engine_skills_dir.
# ---------------------------------------------------------------------------------------------------------
COPY_ENTRIES=(
  opencode.json
  .opencode/agent
  .opencode/command/factory.md
  .opencode/plugins/factory-guard.js
  .hooks
  01-TOOLS
  factory/scripts
  factory/templates
  factory/config.json
  factory/jobs/.gitkeep
  03-SKILLS
  factory-agent
  factory-maint
)
# Carpeta donde cada motor de IA carga las skills de terceros. Solo se anade un motor cuando su ruta esta VERIFICADA
# en su documentacion o con su CLI (OpenCode: `opencode debug skill` las lista desde .agents/skills, ver ADR-011).
ENGINE_DEFAULT=opencode
ENGINES_OK="opencode"
engine_skills_dir() { case "$1" in opencode) echo ".agents/skills" ;; *) return 1 ;; esac; }
ENGINE="$ENGINE_DEFAULT"; SKILLS_DIR="$(engine_skills_dir "$ENGINE")"
# Dentro de las entradas anteriores: no se copia (regex sobre la ruta relativa).
COPY_EXCLUDE='^(01-TOOLS/_TEMPLATE/|01-TOOLS/\.gitignore$)'
MERGE_ENTRIES=(package.json .gitignore AGENTS.md skills-lock.json)   # se mezclan o adaptan, nunca se sobrescriben
CI_ENTRY=.github/workflows/ci.yml                   # sale de factory/templates/project-ci.yml
# Se crean si faltan y NO se sobrescriben jamas (son del proyecto destino).
CREATE_ENTRIES=(
  factory/project.json
  factory/backlog.md
  02-DOCS/wiki/index.md
  02-DOCS/wiki/context.md
  02-DOCS/wiki/sdd/constitution.md
  02-DOCS/wiki/sdd/decisions.md
  02-DOCS/wiki/sdd/methodology.md
  02-DOCS/wiki/sdd/spec-template.md
  02-DOCS/wiki/sdd/job-page-template.md
)
GITIGNORE_MARK='# --- AI Factory (install-into.sh) ---'
PKG_SCRIPTS_RE='^(factory:|hooks:install$)'

if [ "${1:-}" = "--list" ]; then
  for e in "${COPY_ENTRIES[@]}" "$SKILLS_DIR"; do printf 'copy\t%s\n' "$e"; done
  for e in "${MERGE_ENTRIES[@]}"; do printf 'merge\t%s\n' "$e"; done
  printf 'create\t%s\n' "$CI_ENTRY"
  for e in "${CREATE_ENTRIES[@]}"; do printf 'create\t%s\n' "$e"; done
  exit 0
fi

usage() { sed -n '2,12p' "$0"; exit "${1:-2}"; }
[ $# -ge 1 ] || usage
case "$1" in -h|--help) usage 0 ;; esac
DEST_ARG="$1"; shift
APPLY=0; CHECK=0; FORCE=0; NAME=""; ENGINE_GIVEN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --check) CHECK=1; shift ;;
    --force) FORCE=1; shift ;;
    --name) NAME="${2:?falta valor}"; shift 2 ;;
    --engine) ENGINE="${2:?falta valor}"; ENGINE_GIVEN=1; shift 2 ;;
    -h|--help) usage 0 ;;
    *) echo "opcion desconocida: $1" >&2; usage ;;
  esac
done
SKILLS_DIR="$(engine_skills_dir "$ENGINE")" || { echo "ERROR: --engine '${ENGINE}' no esta soportado (motores verificados: ${ENGINES_OK}). La ruta de skills de otro motor se anade a engine_skills_dir cuando se compruebe en su documentacion." >&2; exit 2; }
[ "$CHECK" -eq 0 ] || [ "$APPLY" -eq 0 ] || { echo "ERROR: --check y --apply no se combinan" >&2; exit 2; }

[ -d "$DEST_ARG" ] || { echo "ERROR: el destino no existe o no es una carpeta: ${DEST_ARG}" >&2; exit 1; }
DEST="$(cd "$DEST_ARG" && pwd -P)"
[ -n "$NAME" ] || NAME="$(basename "$DEST")"
[[ "$NAME" =~ ^[A-Za-z0-9._\ -]{1,60}$ ]] || { echo "ERROR: --name admite letras, numeros, espacios, . _ - (maximo 60)" >&2; exit 2; }

# ---- el destino debe ser la raiz de un repo git y NO esta fabrica ----
TOP="$(git -C "$DEST" rev-parse --show-toplevel 2>/dev/null)" || { echo "ERROR: ${DEST} no es un repositorio git" >&2; exit 1; }
[ "$(cd "$TOP" && pwd -P)" = "$DEST" ] || { echo "ERROR: ${DEST} esta dentro del repo ${TOP}; indica la raiz del repo" >&2; exit 1; }
SRC_COMMON="$(git -C "$SRC" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
DEST_COMMON="$(git -C "$DEST" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [ "$DEST" = "$SRC" ] || { [ -n "$SRC_COMMON" ] && [ "$SRC_COMMON" = "$DEST_COMMON" ]; }; then
  echo "ERROR: el destino es el propio repo de la fabrica (o una worktree suya). Elige otro proyecto." >&2
  echo "       Si lanzaste la copia instalada en un proyecto, usa la de la fabrica: bash <ruta-de-la-fabrica>/factory/scripts/install-into.sh <proyecto> --check" >&2; exit 1
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ---- lista de archivos a copiar (seguidos por git, sin exclusiones) ----
copy_files() {
  local e
  for e in "${COPY_ENTRIES[@]}" "$SKILLS_DIR"; do git -C "$SRC" ls-files -- "$e"; done | grep -Ev "$COPY_EXCLUDE" | sort -u
}

# ---- generadores (stdout) ----
gen_agents() { # AGENTS.md de la fabrica sin el bloque del harness RSC y sin la frase que habla de "este repositorio"
  awk -v n="$NAME" '
    /<!-- rsc-suggest:start -->/ { skip=1; next }
    /<!-- rsc-suggest:end -->/   { skip=0; next }
    skip { next }
    /^Este repositorio es una AI Software Factory/ { print "Este repositorio (" n ") usa la AI Software Factory sobre OpenCode; los modelos estan en `factory/config.json`."; next }
    { print }' "${SRC}/AGENTS.md"
}
gen_ci() { cat "${SRC}/factory/templates/project-ci.yml"; }
gen_project_json() {
  node -e '
    const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const sw = p.brain.agents["spec-writer"];
    const out = {
      require_spec_ok: true, max_rounds: 3, spec_profile: "full", human_review_surfaces: [],
      brain: { default: p.brain.default, agents: { ...p.brain.agents, "spec-writer": [...new Set([...sw, "02-DOCS/wiki/context.md"])] } },
    };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");' "${SRC}/factory/project.json"
}
gen_backlog() {
  cat <<'MD'
# Backlog de la AI Factory

Tareas pendientes. Cada item se procesa con `/factory "<tarea>"`.

## Tareas pendientes

- [ ] Primer job de prueba: una tarea trivial para comprobar el pipeline de punta a punta
MD
}
gen_index() {
  cat <<MD
# 02-DOCS/wiki/index.md

## Knowledge map

| Topic | Where | What |
|-------|-------|------|
| contexto | \`02-DOCS/wiki/context.md\` | Que es ${NAME}, para quien, stack, como se prueba y restricciones |
| constitution | \`02-DOCS/wiki/sdd/constitution.md\` | Principios no negociables del proyecto |
| ADRs | \`02-DOCS/wiki/sdd/decisions.md\` | Decisiones de arquitectura de este proyecto (el estado de un ADR nuevo lo fija el flujo: \`Aprobado\` si el humano confirmo el spec con \`spec.ok\`) |
| metodologia | \`02-DOCS/wiki/sdd/methodology.md\` | Actores, fases, buenas practicas y definicion de hecho |
| plantilla de spec | \`02-DOCS/wiki/sdd/spec-template.md\` | Estructura del spec (perfil \`full\`) |
| plantilla de job | \`02-DOCS/wiki/sdd/job-page-template.md\` | Estructura de la pagina que documenta cada job |
| documentacion por job | \`02-DOCS/wiki/jobs/<id>.md\` | Que se construyo en cada job; viaja en el PR del job |

## Regla de lectura

**Lee el indice primero y solo las 2-3 paginas relevantes.** No cargues todo el Brain de una vez. Cada agente consulta \`02-DOCS/\` antes de actuar y actualiza al terminar.
MD
}
gen_context() {
  cat <<MD
# Contexto de ${NAME}

> Rellena cada seccion antes del primer job (borra el marcador \`RELLENAR\` al completarla). El spec-writer lee esta pagina antes de escribir cada spec.
> \`install-into.sh <este-proyecto> --check\`, lanzado desde el repo de la fabrica (la copia instalada aqui no puede comprobarse a si misma), avisa mientras queden marcadores sin rellenar.

## Que es y para quien
<!-- RELLENAR: que hace el proyecto y quien lo usa, en 2-3 frases -->

## Actores y usuarios
<!-- RELLENAR: quien interactua con el sistema (personas, otros sistemas) -->

## Stack y versiones
<!-- RELLENAR: lenguaje, framework, base de datos, versiones -->

## Como se ejecuta y se prueba
<!-- RELLENAR: comando para arrancar y comando de tests (el gate lo usa; si no es \`npm test\`, define FACTORY_TEST_CMD) -->

## Restricciones
<!-- RELLENAR: seguridad, datos personales, plazos, compatibilidad -->

## Glosario inicial
<!-- RELLENAR: terminos del dominio que un agente nuevo no conoceria -->

## Fuera de alcance
<!-- RELLENAR: lo que NO debe tocarse ni construirse -->
MD
}
gen_constitution() {
  cat <<MD
---
type: constitution
title: ${NAME} — Constitution
description: Principios no negociables de ${NAME}
tags: [sdd, constitution]
topic: sdd
status: draft
version: 0.1.0
---

# ${NAME} — Constitution

> Plantilla: completa cada seccion con los principios del proyecto. Rige a todos los agentes.

## 1. Stack canon
<!-- RELLENAR: lenguaje, gestor de paquetes, versiones, convenciones -->

## 2. Quality bar
<!-- RELLENAR: TDD, cobertura minima, gate deterministico, lint -->

## 3. Seguridad
<!-- RELLENAR: secretos, datos personales, dependencias, rutas sensibles -->

## 4. Branching y entrega
<!-- RELLENAR: rama por job (factory/<id>), PR en borrador, quien fusiona -->
MD
}
gen_decisions() {
  cat <<'MD'
# Decisiones del proyecto

Registro de decisiones de arquitectura (ADR) de este proyecto. Empieza vacio.

Formato de cada decision: un encabezado de nivel 2 con `ADR-NNN: <titulo>`, las lineas `Fecha:` y `Estado:` y las secciones Contexto, Decision y Alternativas consideradas. El estado de un ADR nuevo lo fija el flujo (`Aprobado` si el humano confirmo el spec con `spec.ok`); no lo escribe el builder.
MD
}

generate() { # generate <ruta relativa> -> stdout
  case "$1" in
    "$CI_ENTRY") gen_ci ;;
    factory/project.json) gen_project_json ;;
    factory/backlog.md) gen_backlog ;;
    02-DOCS/wiki/index.md) gen_index ;;
    02-DOCS/wiki/context.md) gen_context ;;
    02-DOCS/wiki/sdd/constitution.md) gen_constitution ;;
    02-DOCS/wiki/sdd/decisions.md) gen_decisions ;;
    02-DOCS/wiki/sdd/methodology.md|02-DOCS/wiki/sdd/spec-template.md|02-DOCS/wiki/sdd/job-page-template.md) cat "${SRC}/$1" ;;
    *) echo "ERROR interno: sin generador para $1" >&2; return 1 ;;
  esac
}

# ---- package.json: scripts a anadir (nombre<TAB>comando), segun lo que ya tenga el destino ----
pkg_missing() {
  node -e '
    const fs = require("fs"); const re = new RegExp(process.argv[3]);
    const src = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).scripts || {};
    let have = {}; try { have = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).scripts || {}; } catch {}
    for (const [k, v] of Object.entries(src)) if (re.test(k) && !(k in have)) console.log(k + "\t" + v);' "${SRC}/package.json" "${DEST}/package.json" "$PKG_SCRIPTS_RE"
}
pkg_apply() {
  node -e '
    const fs = require("fs"); const re = new RegExp(process.argv[3]); const file = process.argv[2];
    const src = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).scripts || {};
    let pkg; try { pkg = JSON.parse(fs.readFileSync(file, "utf8")); } catch { pkg = null; }
    if (pkg === null && fs.existsSync(file)) { console.error("ERROR: package.json del destino no es JSON valido; no lo toco"); process.exit(1); }
    if (pkg === null) pkg = { name: process.argv[4].toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "") || "proyecto", version: "0.0.0", private: true, scripts: { test: "echo \"define aqui el comando de tests del proyecto\" && exit 1" }, engines: { node: ">=20.0.0" } };
    pkg.scripts = pkg.scripts || {};
    for (const [k, v] of Object.entries(src)) if (re.test(k) && !(k in pkg.scripts)) pkg.scripts[k] = v;
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");' "${SRC}/package.json" "${DEST}/package.json" "$PKG_SCRIPTS_RE" "$NAME"
}

# ---- skills-lock.json: entradas de la fuente que faltan o difieren en el destino (nombre<TAB>missing|differs) ----
lock_missing() {
  node -e '
    const fs = require("fs");
    const src = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).skills || {};
    let have = {}; try { have = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).skills || {}; } catch {}
    for (const [k, v] of Object.entries(src)) {
      if (!(k in have)) console.log(k + "\tmissing");
      else if (have[k].computedHash !== v.computedHash) console.log(k + "\tdiffers");
    }' "${SRC}/skills-lock.json" "${DEST}/skills-lock.json"
}
lock_apply() { # anade las entradas que faltan; nunca pisa una que el destino ya tenga
  node -e '
    const fs = require("fs"); const file = process.argv[2];
    const src = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    let lock = null, raw = null;
    if (fs.existsSync(file)) { raw = fs.readFileSync(file, "utf8"); try { lock = JSON.parse(raw); } catch { console.error("ERROR: skills-lock.json del destino no es JSON valido; no lo toco"); process.exit(1); } }
    if (lock === null) lock = { version: src.version, skills: {} };
    lock.skills = lock.skills || {};
    let changed = raw === null;
    for (const [k, v] of Object.entries(src.skills || {})) if (!(k in lock.skills)) { lock.skills[k] = v; changed = true; }
    if (changed) fs.writeFileSync(file, JSON.stringify(lock, null, 2) + "\n");' "${SRC}/skills-lock.json" "${DEST}/skills-lock.json"
}

# =========================================================================================================
#  --check
# =========================================================================================================
if [ "$CHECK" -eq 1 ]; then
  BAD=0; WARN=0
  bad()  { echo "FALTA/DIFIERE: $*"; BAD=$((BAD + 1)); }
  warn() { echo "AVISO: $*"; WARN=$((WARN + 1)); }
  N=0
  while IFS= read -r f; do
    N=$((N + 1))
    if [ ! -f "${DEST}/${f}" ]; then bad "${f} (no esta instalado)"
    elif ! cmp -s "${SRC}/${f}" "${DEST}/${f}"; then bad "${f} (no coincide con la fuente)"
    elif [ -x "${SRC}/${f}" ] && [ ! -x "${DEST}/${f}" ]; then bad "${f} (perdio el permiso de ejecucion)"; fi
  done < <(copy_files)
  # AGENTS.md: el instalado o AGENTS.factory.md, comparado con la version adaptada
  gen_agents > "${TMP}/agents"
  if cmp -s "${TMP}/agents" "${DEST}/AGENTS.md" 2>/dev/null || cmp -s "${TMP}/agents" "${DEST}/AGENTS.factory.md" 2>/dev/null; then :; else bad "AGENTS.md o AGENTS.factory.md (no coincide con la version adaptada)"; fi
  [ -f "${DEST}/${CI_ENTRY}" ] || bad "${CI_ENTRY}"
  # package.json: los scripts factory:* y hooks:install
  if [ -f "${DEST}/package.json" ]; then
    miss="$(pkg_missing | cut -f1 | tr '\n' ' ')"; [ -z "$miss" ] || bad "package.json sin los scripts: ${miss}"
  else bad "package.json"; fi
  # skills-lock.json: las skills de terceros instaladas deben estar fijadas con el mismo hash que la fuente
  if [ -f "${DEST}/skills-lock.json" ]; then
    while IFS=$'\t' read -r k st; do
      case "$st" in missing) bad "skills-lock.json: falta la skill ${k}" ;; differs) bad "skills-lock.json: la skill ${k} tiene otro hash que la fuente" ;; esac
    done < <(lock_missing)
  else bad "skills-lock.json"; fi
  grep -qF "$GITIGNORE_MARK" "${DEST}/.gitignore" 2>/dev/null || bad ".gitignore sin el bloque de la fabrica (jobs, worktrees, logs)"
  for f in "${CREATE_ENTRIES[@]}"; do [ -f "${DEST}/${f}" ] || bad "${f}"; done
  # project.json valido
  if [ -f "${DEST}/factory/project.json" ]; then
    node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(typeof p!=="object"||p===null||Array.isArray(p)) process.exit(1)' "${DEST}/factory/project.json" 2>/dev/null || bad "factory/project.json no es JSON valido"
  fi
  # nada de la fabrica en el Brain del proyecto
  DEC="${DEST}/02-DOCS/wiki/sdd/decisions.md"
  if [ -f "$DEC" ]; then
    while IFS= read -r h; do
      if grep -qxF -- "$h" "$DEC"; then bad "decisions.md contiene un ADR de la fabrica: ${h}"; fi
    done < <(grep -E '^## ADR-[0-9]+:' "${SRC}/02-DOCS/wiki/sdd/decisions.md")
  fi
  # los requisitos de la propia fabrica (RF-F*) no viajan: ni la pagina ni sus identificadores
  [ ! -e "${DEST}/02-DOCS/wiki/sdd/factory-requirements.md" ] || bad "02-DOCS/wiki/sdd/factory-requirements.md es de la fabrica; no debe estar en el proyecto"
  LEAK="$(grep -rIlE 'RF-F[0-9]' "${DEST}/02-DOCS" "${DEST}/AGENTS.md" "${DEST}/AGENTS.factory.md" 2>/dev/null | sed "s#^${DEST}/##" | tr '\n' ' ' || true)"
  [ -z "$LEAK" ] || bad "hay requisitos RF-F de la fabrica en: ${LEAK}"
  if grep -q 'ai-factory — Constitution' "${DEST}/02-DOCS/wiki/sdd/constitution.md" 2>/dev/null; then bad "constitution.md es la de la fabrica"; fi
  # contexto sin rellenar: aviso (no cambia el codigo de salida)
  if grep -q 'RELLENAR' "${DEST}/02-DOCS/wiki/context.md" 2>/dev/null; then warn "02-DOCS/wiki/context.md aun tiene marcadores RELLENAR: el primer spec nacera sin contexto"; fi
  if grep -q 'RELLENAR' "${DEST}/02-DOCS/wiki/sdd/constitution.md" 2>/dev/null; then warn "02-DOCS/wiki/sdd/constitution.md aun tiene marcadores RELLENAR"; fi
  if [ "$BAD" -eq 0 ]; then echo "OK: ${N} archivos de maquinaria coinciden con la fuente (${WARN} avisos)"; exit 0; fi
  echo "${BAD} problemas"; exit 1
fi

# =========================================================================================================
#  dry-run / --apply
# =========================================================================================================
if [ "$FORCE" -eq 0 ] && [ -n "$(git -C "$DEST" status --porcelain)" ]; then
  echo "ERROR: el arbol de ${DEST} tiene cambios sin commitear. Commitea o descarta antes de instalar (o usa --force)." >&2
  git -C "$DEST" status --short | head -10 >&2
  exit 1
fi

if [ -f "${DEST}/skills-lock.json" ] && ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "${DEST}/skills-lock.json" 2>/dev/null; then
  echo "ERROR: skills-lock.json del destino no es JSON valido; no instalo nada (arreglalo o borralo)." >&2; exit 1
fi

NEW=(); SAME=0; CONFLICT=()
while IFS= read -r f; do
  if [ -L "${DEST}/${f}" ]; then CONFLICT+=("$f (es un enlace simbolico)")
  elif [ ! -e "${DEST}/${f}" ]; then NEW+=("$f")
  elif cmp -s "${SRC}/${f}" "${DEST}/${f}"; then SAME=$((SAME + 1))
  else CONFLICT+=("$f"); fi
done < <(copy_files)

KEEP=(); CREATE=()
for f in "${CREATE_ENTRIES[@]}" "$CI_ENTRY" ; do
  if [ -e "${DEST}/${f}" ] || [ -L "${DEST}/${f}" ]; then KEEP+=("$f"); else CREATE+=("$f"); fi
done

gen_agents > "${TMP}/agents"
if [ ! -e "${DEST}/AGENTS.md" ]; then AGENTS_TARGET=AGENTS.md; AGENTS_NOTE="se crea"
elif cmp -s "${TMP}/agents" "${DEST}/AGENTS.md"; then AGENTS_TARGET=""; AGENTS_NOTE="AGENTS.md ya es igual"
else AGENTS_TARGET=AGENTS.factory.md; AGENTS_NOTE="el destino ya tiene AGENTS.md: no se toca; las reglas de la fabrica van en AGENTS.factory.md (fusionalas a mano)"; fi

LOCK_ADD="$(lock_missing | awk -F'\t' '$2=="missing"{print $1}' | tr '\n' ' ')"
LOCK_DIFF="$(lock_missing | awk -F'\t' '$2=="differs"{print $1}' | tr '\n' ' ')"
if [ ! -f "${DEST}/skills-lock.json" ]; then LOCK_NOTE="no existe: se crea con las skills de terceros (${LOCK_ADD})"
else LOCK_NOTE="se anaden las skills que faltan: ${LOCK_ADD:-ninguna (ya estan)}"; fi
[ -z "$LOCK_DIFF" ] || LOCK_NOTE="${LOCK_NOTE}; se respeta la entrada del destino que difiere: ${LOCK_DIFF}"
MISSING_SCRIPTS="$(pkg_missing | cut -f1 | tr '\n' ' ')"
if [ -f "${DEST}/package.json" ]; then PKG_NOTE="se anaden los scripts: ${MISSING_SCRIPTS:-ninguno (ya estan)}"
else PKG_NOTE="no existe: se crea uno minimo con los scripts factory:* (y un test que falla hasta que definas el tuyo)"; fi
if grep -qF "$GITIGNORE_MARK" "${DEST}/.gitignore" 2>/dev/null; then GI_NOTE="ya tiene el bloque de la fabrica"; else GI_NOTE="se anade un bloque (factory/jobs/*/, factory/worktrees/, factory/logs/)"; fi

echo "Fuente:  ${SRC}"
echo "Destino: ${DEST}   (nombre: ${NAME})"
echo
echo "== Maquinaria =="
echo "  nuevos: ${#NEW[@]}   iguales: ${SAME}   en conflicto: ${#CONFLICT[@]}"
for f in "${NEW[@]}"; do echo "  COPIAR  ${f}"; done
echo "== Mezcla / adaptacion =="
echo "  package.json: ${PKG_NOTE}"
echo "  .gitignore:   ${GI_NOTE}"
echo "  AGENTS.md:    ${AGENTS_NOTE}"
echo "  skills-lock.json: ${LOCK_NOTE}"
echo "  skills de terceros (--engine ${ENGINE}): ${SKILLS_DIR}/"
echo "== Se crea si falta (Brain limpio y config del proyecto; nunca se sobrescribe) =="
for f in "${CREATE[@]}"; do echo "  CREAR   ${f}"; done
for f in "${KEEP[@]}"; do echo "  CONSERVAR ${f} (ya existe)"; done
echo "== No se copia: tests/, ADR y constitucion de la fabrica, jobs, docs de parches, .rsc*, 01-TOOLS/_TEMPLATE, 02-DOCS/wiki/sdd/factory-requirements.md =="

if [ "${#CONFLICT[@]}" -gt 0 ] && [ "$FORCE" -eq 0 ]; then
  echo
  echo "CONFLICTO: estos archivos ya existen en el destino y difieren de la fabrica (no se sobrescribe sin --force):" >&2
  for f in "${CONFLICT[@]}"; do echo "  ${f}" >&2; done
  exit 1
fi
if [ "$APPLY" -eq 0 ]; then echo; echo "(dry-run: no se cambio nada; repite con --apply)"; exit 0; fi

# ---- aplicar ----
put() { # put <rel> <origen>  (copia conservando el modo)
  mkdir -p "$(dirname "${DEST}/$1")"; cp -p -- "$2" "${DEST}/$1"
}
for f in "${NEW[@]}"; do put "$f" "${SRC}/${f}"; done
for c in "${CONFLICT[@]}"; do f="${c%% (*}"; rm -f -- "${DEST}/${f}"; put "$f" "${SRC}/${f}"; done   # solo con --force
for f in "${CREATE[@]}"; do
  mkdir -p "$(dirname "${DEST}/${f}")"; generate "$f" > "${DEST}/${f}"
done
[ -z "$AGENTS_TARGET" ] || cp -- "${TMP}/agents" "${DEST}/${AGENTS_TARGET}"
pkg_apply
lock_apply
if ! grep -qF "$GITIGNORE_MARK" "${DEST}/.gitignore" 2>/dev/null; then
  { [ ! -s "${DEST}/.gitignore" ] || [ -z "$(tail -c1 "${DEST}/.gitignore")" ] || echo
    printf '%s\nfactory/jobs/*/\n!factory/jobs/.gitkeep\nfactory/worktrees/\nfactory/logs/\n' "$GITIGNORE_MARK"; } >> "${DEST}/.gitignore"
fi

echo
echo "Instalado en ${DEST}. Siguientes pasos (los ejecutas tu):"
echo "  1. bash ${SRC}/factory/scripts/install-into.sh ${DEST} --check   # comprueba la instalacion (se lanza desde la fabrica, no desde el proyecto)"
echo "  2. Rellena 02-DOCS/wiki/context.md y 02-DOCS/wiki/sdd/constitution.md (marcadores RELLENAR)"
[ "$AGENTS_TARGET" != "AGENTS.factory.md" ] || echo "     y fusiona AGENTS.factory.md en tu AGENTS.md"
echo "  3. npm run hooks:install                                           # activa los hooks de git"
echo "  4. bash factory/scripts/install-managed.sh                         # dry-run de la config managed (luego --apply con sudo)"
echo "  5. bash factory/scripts/onboard-project.sh OWNER/REPO --check-name ci   # dry-run del ruleset de main"
echo "  6. Commitea la instalacion en main (antes de proteger main) y lanza un job trivial: /factory \"<tarea pequena>\""
echo "El harness RSC no se instala aqui: si lo quieres, usa \`npx @ericrisco/rsc\` aparte."
