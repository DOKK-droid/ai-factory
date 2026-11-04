#!/usr/bin/env bash
# install-managed.sh — instala la config "managed" de OpenCode (la de MAXIMA prioridad, solo escribible por root).
# Por que: el `opencode.json` del proyecto lo puede reescribir un agente (ya paso: movio una regla y rompio el push).
# La config managed gana a la del proyecto y no se puede cambiar sin root. Aqui van los `deny` criticos.
#
# Uso:  bash factory/scripts/install-managed.sh               # dry-run (no cambia nada)
#       bash factory/scripts/install-managed.sh --apply       # instala con sudo
#       bash factory/scripts/install-managed.sh --check       # compara lo instalado con la plantilla (0 = igual)
#       bash factory/scripts/install-managed.sh --uninstall   # retira (deja copia de seguridad)
# Variables: FACTORY_MANAGED_DIR (/etc/opencode), FACTORY_MANAGED_OWNER (root:root; vacio = no cambiar), SUDO (sudo; vacio = sin sudo)
# Limites: las sesiones de mantenimiento (factory-maint) tambien quedan sujetas a estos deny: los push los haces desde tu terminal.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${HERE}/../templates/managed-opencode.json"
DIR="${FACTORY_MANAGED_DIR:-/etc/opencode}"; TARGET="${DIR}/opencode.json"
OWNER="${FACTORY_MANAGED_OWNER-root:root}"
SUDO="${SUDO-sudo}"; [ "$(id -u)" -eq 0 ] && SUDO=""
ACTION=install; APPLY=0
for a in "$@"; do case "$a" in --apply) APPLY=1 ;; --check) ACTION=check ;; --uninstall) ACTION=uninstall ;; -h|--help) sed -n '2,13p' "$0"; exit 0 ;; *) echo "opcion desconocida: $a" >&2; exit 2 ;; esac; done

node -e "const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); if(!c.permission||!c.permission.bash) process.exit(1)" "$TEMPLATE" \
  || { echo "ERROR: la plantilla no es JSON valido o no tiene permission.bash" >&2; exit 1; }
run() { if [ "$APPLY" -eq 0 ]; then echo "[dry-run] $*"; else echo "+ $*"; "$@"; fi; }
backup() { [ -e "$TARGET" ] && run $SUDO cp "$TARGET" "${TARGET}.bak-$(date +%Y%m%d-%H%M%S)" || true; }

case "$ACTION" in
  check) [ -f "$TARGET" ] || { echo "NO INSTALADA: ${TARGET}"; exit 1; }
         if cmp -s "$TEMPLATE" "$TARGET"; then echo "OK: ${TARGET} coincide con la plantilla"; else echo "DIFIERE: ${TARGET} no coincide con la plantilla"; diff -u "$TARGET" "$TEMPLATE" | head -30; exit 1; fi ;;
  uninstall) [ -e "$TARGET" ] || { echo "No hay nada que retirar"; exit 0; }
             backup; run $SUDO rm -f "$TARGET"; if [ "$APPLY" -eq 1 ]; then echo "Retirada. Reinicia OpenCode."; else echo "(dry-run: no se cambio nada; repite con --apply)"; fi ;;
  *) echo "Instalando config managed en ${TARGET}"
     run $SUDO mkdir -p "$DIR"; backup
     run $SUDO cp "$TEMPLATE" "$TARGET"
     [ -n "$OWNER" ] && run $SUDO chown "$OWNER" "$TARGET"
     run $SUDO chmod 644 "$TARGET"
     cat <<MSG

Siguiente (reinicia OpenCode y verifica; no lo he podido probar contra tu OpenCode):
  1. opencode debug config | grep -n "git push"     # deben aparecer los deny y el allow de factory/* al final
  2. Prueba en vivo: FOO=1 git push origin main   (debe bloquearse)  y  git push -u origin factory/prueba  (debe permitirse)
  3. Si OpenCode no lee ${TARGET}, mira en su documentacion la ruta "managed" de tu sistema y usa FACTORY_MANAGED_DIR.
Retirar: bash factory/scripts/install-managed.sh --uninstall --apply
MSG
     if [ "$APPLY" -eq 0 ]; then echo "(dry-run: no se cambio nada; repite con --apply)"; fi ;;
esac
