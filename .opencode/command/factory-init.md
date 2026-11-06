---
description: Prepara el proyecto para la AI Software Factory y conduce el descubrimiento hasta una base documental lista para que la apruebes
agent: discovery
---

# Comando /factory-init

Inicializa un proyecto, nuevo o existente, y deja su base documental de análisis y diseño (`02-DOCS/wiki/project/`) lista para que **el humano la apruebe** antes del primer job. No genera código.

## Uso

```
/factory-init                 # el proyecto del directorio actual
/factory-init <ruta>          # otro proyecto (la raíz de un repo git)
```

Argumentos recibidos: $ARGUMENTS

## Lo que debes hacer

1. Ejecuta `bash factory/scripts/init-project.sh` (con `--dir <ruta>` si te dieron una). Es un dry-run: solo informa. Lee `CONTENT`, `FACTORY`, `PROJECT`, `MODE`, los `CHECK:`, los `STEP:` y los `MANUAL:`.
2. Los pasos pendientes se aplican **de uno en uno** y cada uno lo aprueba el humano en OpenCode: `bash factory/scripts/init-project.sh --apply <install|deps|hooks|rsc|workspace>`. Pídele solo los que hagan falta. `rsc` es opcional y necesita sus respuestas (`-- --technical-level … --goal …`); pregúntaselas, no las inventes. Con `FACTORY=missing` el primer paso es `install`.
3. Lo que el script imprime como `MANUAL:` (`sudo`, `install-managed.sh --apply`, `onboard-project.sh --apply`) **no lo ejecutas ni lo rodeas**: se lo muestras al humano.
4. La última línea es `HANDOFF=discovery MODE=<A|B|C|D> JOB=<id> NEXT=<documento>`. Si `JOB=-`, aplica antes el paso `workspace`. Si es `HANDOFF=blocked`, informa el motivo y espera. Si no, sigue tu proceso de descubrimiento según el modo, escribiendo en la worktree `factory/worktrees/<JOB>/`.
5. Si algo bloquea una acción (guard, permiso, hook), detente: explica qué intentabas, qué bloqueó y qué cambio hace falta, y espera al humano.

El comando es idempotente: puede repetirse y retoma desde el estado en que quedó el proyecto (los pasos hechos salen como `DONE:`).
