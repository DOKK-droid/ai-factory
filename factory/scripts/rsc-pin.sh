#!/usr/bin/env bash
# rsc-pin.sh — deja RSC fijado a la version de factory/rsc-pin.json, con knowledge-sync y auto-update apagados.
# Por defecto NO hace nada (dry-run): imprime lo que ejecutaria. Siempre usa `npx @ericrisco/rsc@<version fijada>`, nunca @latest.
#
# Uso:  bash factory/scripts/rsc-pin.sh [--dir <proyecto>]            # dry-run
#       bash factory/scripts/rsc-pin.sh [--dir <proyecto>] --apply    # aplica (idempotente: si ya esta en orden, no ejecuta nada)
#       bash factory/scripts/rsc-pin.sh [--dir <proyecto>] --check    # solo comprueba, sin red (0 = en orden, 1 = no)
# RSC sin instalar: --apply necesita las respuestas del humano (RSC nunca las inventa):
#       --technical-level non-technical|mixed|technical   --goal "<texto>"   [--workflow branches|main]  [--software-scope small|complex]
#       1a pasada: RSC imprime el plan y su id, no escribe nada y esto sale con 3. 2a pasada: la misma orden con --accept-plan <id>.
# Que apaga y por que viaja con el repo: `.rsc.json` (optOuts knowledge-sync y auto-update, gitPermissions=false) es lo que se commitea;
#   los marcadores `.rsc/.no-*` son locales (.rsc/ esta ignorado) y RSC los reconstruye al clonar. Aqui se escriben los dos.
# Ademas: `rsc sync` y la instalacion de RSC reescriben `opencode.json` (con gitPermissions activo cambian `git push: deny` por `allow`).
#   Los permisos de la fabrica mandan: se guarda `opencode.json` antes y se restaura despues. `--check` falla si, en el `opencode.json` de la fabrica, falta `git push: deny`.
# No toca /etc/opencode ni instala nada global. La fabrica funciona sin RSC: sin `.rsc.json`, --check sale 0 ("no instalado").
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PIN="${HERE}/../rsc-pin.json"
usage() { sed -n '2,13p' "$0"; exit "${1:-2}"; }

APPLY=0; CHECK=0; DIR="."; LEVEL=""; GOAL=""; WORKFLOW="branches"; SCOPE="complex"; ACCEPT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --check) CHECK=1; shift ;;
    --dir) DIR="${2:?falta valor}"; shift 2 ;;
    --technical-level) LEVEL="${2:?falta valor}"; shift 2 ;;
    --goal) GOAL="${2:?falta valor}"; shift 2 ;;
    --workflow) WORKFLOW="${2:?falta valor}"; shift 2 ;;
    --software-scope) SCOPE="${2:?falta valor}"; shift 2 ;;
    --accept-plan) ACCEPT="${2:?falta valor}"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) echo "opcion desconocida: $1" >&2; usage ;;
  esac
done
[ "$CHECK" -eq 0 ] || [ "$APPLY" -eq 0 ] || { echo "ERROR: --check y --apply no se combinan" >&2; exit 2; }
[ -d "$DIR" ] || { echo "ERROR: el destino no existe o no es una carpeta: ${DIR}" >&2; exit 1; }
DIR="$(cd "$DIR" && pwd -P)"

# ---- el pin: version exacta (x.y.z, nunca una etiqueta como latest) e integridad sha512 ----
VERSION="$(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(String(p.version||""))' "$PIN" 2>/dev/null || true)"
INTEGRITY="$(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(String(p.integrity||""))' "$PIN" 2>/dev/null || true)"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERROR: ${PIN} no tiene una version exacta x.y.z (valor: '${VERSION}')" >&2; exit 1; }
[[ "$INTEGRITY" =~ ^sha512-[A-Za-z0-9+/]+=*$ ]] || { echo "ERROR: ${PIN} no tiene una integridad sha512-..." >&2; exit 1; }
RSC="@ericrisco/rsc@${VERSION}"

MANIFEST="${DIR}/.rsc.json"
manifest_has() { # manifest_has <expresion JS sobre j> -> exit 0 si es verdadera
  node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.exit(eval(process.argv[2])?0:1)' "$MANIFEST" "$1" 2>/dev/null
}

# ---- comprobacion offline del estado (sin red): imprime cada problema y devuelve su numero ----
BAD=0; WARN=0
bad()  { echo "FALTA/DIFIERE: $*"; BAD=$((BAD + 1)); }
warn() { echo "AVISO: $*"; WARN=$((WARN + 1)); }
inspect() {
  BAD=0; WARN=0
  manifest_has 'typeof j==="object"&&j!==null' || { bad ".rsc.json no es JSON valido"; return; }
  manifest_has "j.catalogVersion===\"${VERSION}\"" || bad ".rsc.json: catalogVersion no es la fijada ${VERSION} (la cambia el humano editando factory/rsc-pin.json)"
  manifest_has '(j.optOuts||[]).includes("knowledge-sync")' || bad ".rsc.json: falta el optOut knowledge-sync"
  manifest_has '(j.optOuts||[]).includes("auto-update")' || bad ".rsc.json: falta el optOut auto-update"
  manifest_has 'j.gitPermissions===false' || bad ".rsc.json: gitPermissions no es false (RSC reescribiria los permisos de git de opencode.json)"
  [ -f "${DIR}/.rsc/.no-knowledge-sync" ] || warn ".rsc/.no-knowledge-sync no existe en esta maquina (lo crea --apply; RSC lo reconstruye al clonar)"
  [ -f "${DIR}/.rsc/.no-auto-update" ] || warn ".rsc/.no-auto-update no existe en esta maquina (lo crea --apply; RSC lo reconstruye al clonar)"
  # solo si opencode.json es el de la fabrica (lo delata su regla de push a factory/*): el de RSC solo no lleva el deny
  if [ -f "${DIR}/opencode.json" ]; then
    node -e 'const b=((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).permission||{}).bash||{}); process.exit(!("git push -u origin factory/*" in b)||b["git push"]==="deny"?0:1)' "${DIR}/opencode.json" 2>/dev/null \
      || bad "opencode.json: falta la regla \"git push\": \"deny\" (¿lo reescribio rsc sync?)"
  fi
}

if [ ! -f "$MANIFEST" ]; then INSTALLED=0; else INSTALLED=1; fi

if [ "$CHECK" -eq 1 ]; then
  if [ "$INSTALLED" -eq 0 ]; then echo "RSC no instalado en ${DIR} (es opcional: la fabrica funciona sin el)"; exit 0; fi
  inspect
  if [ "$BAD" -eq 0 ]; then echo "OK: RSC ${VERSION} fijado, knowledge-sync y auto-update apagados (${WARN} avisos)"; exit 0; fi
  echo "${BAD} problemas; repara con: bash ${HERE}/rsc-pin.sh --dir ${DIR} --apply"; exit 1
fi

# ---- dry-run / --apply ----
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
run() { # run <orden...>: en dry-run solo la imprime
  if [ "$APPLY" -eq 0 ]; then echo "[dry-run] $*"; else echo "+ $*"; "$@"; fi
}
rsc() { npx --yes "$RSC" "$@"; }
rsc_line() { # forma imprimible de una llamada a rsc
  printf 'npx --yes %s' "$RSC"; printf ' %s' "$@"; echo
}
step() { # step <argumentos de rsc...>
  if [ "$APPLY" -eq 0 ]; then echo "[dry-run] $(rsc_line "$@")"; else echo "+ $(rsc_line "$@")"; rsc "$@"; fi
}

echo "RSC fijado: ${VERSION}   (integridad ${INTEGRITY:0:24}...)   destino: ${DIR}"

if [ "$INSTALLED" -eq 1 ]; then
  inspect
  if [ "$BAD" -eq 0 ] && [ "$WARN" -eq 0 ]; then echo "DONE: ya esta en orden; no se ejecuta nada"; exit 0; fi
  # una version distinta de la fijada no se arregla aqui: sync con otra version cambiaria el catalogo del proyecto
  if ! manifest_has "j.catalogVersion===\"${VERSION}\""; then
    echo "ERROR: el proyecto tiene otra version de RSC que la fijada (${VERSION}). Cambiarla es decision del humano: edita factory/rsc-pin.json (con su integridad) o reinstala." >&2; exit 1
  fi
else
  if [ -z "$LEVEL" ] || [ -z "$GOAL" ]; then
    echo "RSC no esta instalado en ${DIR}. Para instalarlo hacen falta las respuestas del humano (no se inventan):" >&2
    echo "  --technical-level non-technical|mixed|technical   --goal \"<para que es el proyecto>\"" >&2
    echo "  (opcional: --workflow branches|main [por defecto branches], --software-scope small|complex [por defecto complex])" >&2
    if [ "$APPLY" -eq 1 ]; then exit 2; fi
  fi
fi

if [ "$APPLY" -eq 1 ]; then
  # la integridad se compara con el registro ANTES de ejecutar nada del paquete
  GOT="$(npm view "$RSC" dist.integrity 2>/dev/null || true)"
  [ "$GOT" = "$INTEGRITY" ] || { echo "ERROR: la integridad de ${RSC} en el registro (${GOT:-sin respuesta}) no coincide con el pin; no se ejecuta nada." >&2; exit 1; }
  echo "OK: integridad de ${RSC} coincide con el pin"
else
  echo "[dry-run] npm view ${RSC} dist.integrity   # debe ser igual a la integridad del pin"
fi

# lo que RSC no debe pisar: se guarda antes
[ ! -f "${DIR}/opencode.json" ] || cp -p -- "${DIR}/opencode.json" "${TMP}/opencode.json"
[ ! -f "${DIR}/AGENTS.md" ] || cp -p -- "${DIR}/AGENTS.md" "${TMP}/AGENTS.md"

if [ "$INSTALLED" -eq 0 ]; then
  ONBOARD=(onboard --technical-level "${LEVEL:-<nivel>}" --project-kind software --goal "${GOAL:-<objetivo>}" --software-scope "$SCOPE" --workflow "$WORKFLOW" --target opencode)
  if [ -z "$ACCEPT" ]; then
    # 1a pasada: RSC solo muestra el plan (no escribe). El humano lo acepta repitiendo con --accept-plan.
    if [ "$APPLY" -eq 0 ]; then echo "[dry-run] (cd ${DIR} && $(rsc_line "${ONBOARD[@]}"))   # imprime el plan y su id; no escribe"
    else
      echo "+ (cd ${DIR} && $(rsc_line "${ONBOARD[@]}"))"
      OUT="$(cd "$DIR" && rsc "${ONBOARD[@]}")" || { echo "$OUT"; exit 1; }
      echo "$OUT"
      PLAN="$(printf '%s\n' "$OUT" | sed -n 's/.*--accept-plan \([0-9a-f]\{64\}\).*/\1/p' | tail -1)"
      [ -n "$PLAN" ] || { echo "ERROR: RSC no imprimio el id del plan" >&2; exit 1; }
      echo "PENDIENTE: revisa el plan y, si lo aceptas, repite la misma orden anadiendo: --accept-plan ${PLAN}"; exit 3
    fi
  else
    [[ "$ACCEPT" =~ ^[0-9a-f]{64}$ ]] || { echo "ERROR: --accept-plan espera el id sha256 que imprimio el plan" >&2; exit 2; }
    ONBOARD+=(--accept-plan "$ACCEPT")
    if [ "$APPLY" -eq 0 ]; then echo "[dry-run] (cd ${DIR} && $(rsc_line "${ONBOARD[@]}"))"
    else echo "+ (cd ${DIR} && $(rsc_line "${ONBOARD[@]}"))"; (cd "$DIR" && rsc "${ONBOARD[@]}"); fi
  fi
fi

# ---- apagado de sync y auto-update (cada orden es idempotente) ----
if [ "$APPLY" -eq 1 ]; then cd "$DIR"; fi
step knowledge-sync off
if [ "$APPLY" -eq 0 ]; then echo "[dry-run] touch .rsc/.no-auto-update"; else echo "+ touch .rsc/.no-auto-update"; mkdir -p .rsc; : > .rsc/.no-auto-update; fi
step git-permissions off
step sync

if [ "$APPLY" -eq 0 ]; then
  echo "[dry-run] restaurar opencode.json si RSC lo cambio, y comprobar .rsc.json (knowledge-sync y auto-update en optOuts)"
  echo; echo "(dry-run: no se cambio nada; repite con --apply)"; exit 0
fi

# ---- RSC no pisa los permisos ni el AGENTS.md de la fabrica ----
if [ -f "${TMP}/opencode.json" ] && ! cmp -s "${TMP}/opencode.json" "${DIR}/opencode.json"; then
  cp -p -- "${TMP}/opencode.json" "${DIR}/opencode.json"; echo "AVISO: RSC reescribio opencode.json; se restauro el de la fabrica"
fi
if [ -f "${TMP}/AGENTS.md" ]; then
  node -e 'const fs=require("fs"); const old=fs.readFileSync(process.argv[1],"utf8").trimEnd(); process.exit(fs.readFileSync(process.argv[2],"utf8").includes(old)?0:1)' "${TMP}/AGENTS.md" "${DIR}/AGENTS.md" \
    || { echo "ERROR: AGENTS.md ya no contiene el texto que tenia antes de RSC. Revisalo con git diff AGENTS.md." >&2; exit 1; }
fi

inspect
if [ "$BAD" -gt 0 ]; then echo "ERROR: tras aplicar, el estado de RSC no es el esperado (${BAD} problemas)" >&2; exit 1; fi
echo "OK: RSC ${VERSION} fijado; knowledge-sync y auto-update apagados. Commitea .rsc.json para que el apagado viaje con el repo."
