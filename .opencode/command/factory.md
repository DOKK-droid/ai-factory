---
description: Ejecuta el pipeline completo de la AI Software Factory: input -> spec -> builder -> gate -> 4 reviewers -> approver -> human-gate -> output
---

# Comando /factory

Ejecuta la AI Software Factory completa siguiendo la arquitectura del video de Eric Risco.

## Uso

```
/factory "<tarea o descripción>"
/factory next          # toma el siguiente item de factory/backlog.md
/factory status        # estado de jobs activos
/factory approve <id>  # aprueba un job manualmente (human override)
```

## Fases del pipeline

1. **Intake** — normaliza Sentry / GitHub Issue / tarea manual a `factory/jobs/<id>/input.md`
2. **Spec Writer** — genera `spec.md` + `tasks.md` (SDD), consulta `02-DOCS/`
3. **Builder** — `bash 01-TOOLS/new-job.sh <job-id>` crea la **worktree aislada** `factory/worktrees/<job-id>` (rama `factory/<job-id>`, siempre desde la rama base, nunca desde tu directorio de trabajo). Antes de construir: `bash .hooks/spec-first-gate.sh <job-id>` (el spec debe declarar `Alcance:`). TDD por tarea; se commitea **solo dentro de la worktree** (el hook lo exige)
4. **Gate determinista** — `bash 01-TOOLS/checks.sh <job-id>` desde la worktree. Comprueba: alcance (los cambios reales caben en `Alcance:`), sintaxis de cada archivo cambiado, lint/typecheck/suite y **ejecuta explícitamente los tests que el job cambió**. Escribe `gate.md` (`GATE: PASS|FAIL`, y `UNVERIFIED_TESTS:` si algún test no pudo ejecutarse). Si falla, vuelve al builder SIN lanzar reviewers
5. **4 Revisores** — `bash 01-TOOLS/launch-reviewers.sh <job-id>` desde la worktree. Reciben spec + `gate.md` + el **diff real** (nunca la narración del builder). No tienen herramientas de escritura ni bash: el script guarda `round-N/review-<x>.md`, valida el formato, reintenta una vez y, si sigue mal, escribe `VERDICT: CHANGES / SCORE: 0` (falla cerrado). Antes valida los IDs de modelo contra `opencode models`
6. **Aprobador** — `decision.md` (APPROVE / CHANGES / ESCALATE); bucle al builder si CHANGES
7. **Decisor Humano** — `bash 01-TOOLS/risk.sh <job-id>` (determinista, usa `git diff` real; línea 1 de `human.md` = FAST_PATH | NEEDS_HUMAN). El agente human-gate solo redacta el resumen
8. **Output** — `git push -u origin factory/<job-id>` y luego `gh pr create --draft`. Un agente solo puede subir ramas `factory/*` (nunca main) y jamás hace merge: el plugin factory-guard, los permisos y los git hooks lo impiden; el merge lo hace un humano
9. **Memory Curator** — actualiza `02-DOCS/wiki/` y `trace.md`

## Archivos por job (`factory/jobs/<id>/`)

| Archivo | Propósito |
|---------|-----------|
| `job.json` | Estado del job (solo orchestrator) |
| `input.md` | Entrada normalizada |
| `spec.md` | Spec SDD: `Surface: page \| none`, criterios numerados y sección `Alcance:` (rutas que el job puede tocar) |
| `tasks.md` | Desglose de tareas |
| `build.md` | TDD rojo/verde por tarea |
| `gate.md` | Resultado del gate determinista |
| `round-N/review-<x>.md` | Informe de cada revisor (VERDICT + SCORE) |
| `decision.md` | APPROVE / CHANGES / ESCALATE |
| `human.md` | FAST_PATH / NEEDS_HUMAN |
| `trace.md` | Issue → Spec → Branch → PR → Reviews → Decisión |

## Reglas

- Los 4 revisores se lanzan desde el script (paralelismo limitado, `REVIEW_MAX_PARALLEL`), con límite total y por inactividad
- Si el agente choca con un bloqueo del guard: **se detiene** y pide el cambio al humano; tras 3 bloqueos la sesión entra en modo parada (`factory/logs/BLOCKED.md`)
- Nada de lo que está sin commitear en el checkout principal entra en un job
- Cualquier valor ambiguo → CHANGES / ESCALATE / NEEDS_HUMAN (lado seguro)
- Si `Surface: none`, reviewer-ux y reviewer-ui devuelven `PASS (n/a)` pero siempre se lanzan
- Los agentes nunca hacen push ni merge; solo abren PR en borrador. `fast_path` está desactivado por defecto
- Cada job deja traza completa y auditable
