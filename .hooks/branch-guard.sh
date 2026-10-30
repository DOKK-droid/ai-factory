#!/usr/bin/env bash
# branch-guard: protege main/master. Uso: branch-guard.sh [rama]  (sin arg: rama actual)
set -euo pipefail
BRANCH="${1:-$(git symbolic-ref --short -q HEAD || echo '')}"
case "$BRANCH" in
  main|master)
    echo "ERROR: no se permite trabajar directamente sobre ${BRANCH}. Usa una rama o worktree propia." >&2
    exit 1 ;;
  "") echo "ERROR: no pude determinar la rama (HEAD desacoplado)." >&2; exit 1 ;;
esac
echo "OK: rama ${BRANCH} autorizada."
