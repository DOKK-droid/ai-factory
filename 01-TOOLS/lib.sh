#!/usr/bin/env bash
# lib.sh — funciones compartidas de la fabrica. Se usa con: source "$(dirname "$0")/lib.sh"
# Sin colores ANSI: node -p pinta numeros/booleanos si FORCE_COLOR esta activo en el entorno.
unset FORCE_COLOR NODE_TEST_CONTEXT; export NO_COLOR=1 NODE_DISABLE_COLORS=1
# NODE_TEST_CONTEXT lo hereda cualquier proceso lanzado desde `node --test` y hace que un `node --test` anidado
# no emita TAP (el gate vería "0 tests"). Se elimina para que el gate se comporte igual en cualquier entorno.

# Raiz del checkout PRINCIPAL aunque estemos dentro de una worktree (los jobs viven alli).
factory_main_root() {
  local common
  common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  dirname "$common"
}

# Carpeta de jobs: FACTORY_JOBS_DIR, o <checkout principal>/factory/jobs, o ./factory/jobs fuera de git.
factory_jobs_dir() {
  if [ -n "${FACTORY_JOBS_DIR:-}" ]; then printf '%s' "$FACTORY_JOBS_DIR"; return; fi
  local root; root="$(factory_main_root 2>/dev/null)" || root="."
  printf '%s/factory/jobs' "$root"
}

# Lee una clave de la config: factory_cfg '<expresion JS sobre c>' <defecto>
factory_cfg() {
  local cfg="${FACTORY_CONFIG:-factory/config.json}"
  node -p "try{const c=JSON.parse(require('fs').readFileSync('$cfg','utf8'));const v=($1);String(v===undefined||v===null?'$2':v)}catch(e){String('$2')}" 2>/dev/null \
    | sed 's/\x1b\[[0-9;]*m//g' | grep -m1 . || echo "$2"
}

# Commit base del job (merge-base entre la rama base y HEAD). Vacio si no se puede calcular.
factory_merge_base() {
  local base cand
  base="${FACTORY_BASE:-$(factory_cfg 'c.base_branch' main)}"
  for cand in "$base" "origin/${base}"; do
    if git rev-parse --verify -q "${cand}^{commit}" >/dev/null 2>&1; then
      git merge-base "$cand" "${FACTORY_HEAD:-HEAD}" 2>/dev/null && return 0
    fi
  done
  return 1
}
