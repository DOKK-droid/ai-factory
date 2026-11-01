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
3. **Builder** — antes: `bash .hooks/spec-first-gate.sh <job-id>`. TDD por tarea (test rojo → código → verde), worktree desde main en la rama `factory/<job-id>`
4. **Gate determinista** — `bash 01-TOOLS/checks.sh <job-id>` (escribe `gate.md` con `GATE: PASS|FAIL` y sale con código != 0 si falla); si falla, vuelve al builder SIN lanzar reviewers
5. **4 Revisores en paralelo** — security, ux, ui, code (cada uno deja `review-<x>.md`)
6. **Aprobador** — `decision.md` (APPROVE / CHANGES / ESCALATE); bucle al builder si CHANGES
7. **Decisor Humano** — `bash 01-TOOLS/risk.sh <job-id>` (determinista, usa `git diff` real; línea 1 de `human.md` = FAST_PATH | NEEDS_HUMAN). El agente human-gate solo redacta el resumen
8. **Output** — `git push -u origin factory/<job-id>` y luego `gh pr create --draft`. Un agente solo puede subir ramas `factory/*` (nunca main) y jamás hace merge: el plugin factory-guard, los permisos y los git hooks lo impiden; el merge lo hace un humano
9. **Memory Curator** — actualiza `02-DOCS/wiki/` y `trace.md`

## Archivos por job (`factory/jobs/<id>/`)

| Archivo | Propósito |
|---------|-----------|
| `job.json` | Estado del job (solo orchestrator) |
| `input.md` | Entrada normalizada |
| `spec.md` | Spec SDD (línea 2: `Surface: page \| none`) |
| `tasks.md` | Desglose de tareas |
| `build.md` | TDD rojo/verde por tarea |
| `gate.md` | Resultado del gate determinista |
| `round-N/review-<x>.md` | Informe de cada revisor (VERDICT + SCORE) |
| `decision.md` | APPROVE / CHANGES / ESCALATE |
| `human.md` | FAST_PATH / NEEDS_HUMAN |
| `trace.md` | Issue → Spec → Branch → PR → Reviews → Decisión |

## Reglas

- Los 4 revisores se lanzan en paralelo
- Cualquier valor ambiguo → CHANGES / ESCALATE / NEEDS_HUMAN (lado seguro)
- Si `Surface: none`, reviewer-ux y reviewer-ui devuelven `PASS (n/a)` pero siempre se lanzan
- Los agentes nunca hacen push ni merge; solo abren PR en borrador. `fast_path` está desactivado por defecto
- Cada job deja traza completa y auditable
