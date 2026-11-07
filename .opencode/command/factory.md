---
description: Arranca el bucle de la AI Software Factory: next-step.sh decide el paso, el orchestrator lo ejecuta, hasta DONE o STOP
agent: orchestrator
---

# Comando /factory

Arranca (o reanuda) el pipeline de la AI Software Factory. El orden de los pasos **no vive en un prompt: lo decide el script `01-TOOLS/next-step.sh`** (máquina de estados determinista, de solo lectura). El orchestrator solo hace el bucle.

## Uso

```
/factory <id-de-job>             # reanuda un job existente (cualquier estado)
/factory "<descripcion nueva>"   # tarea nueva: genera un id descriptivo y empieza por el estado 0
/factory status                  # next-step.sh sobre cada job de factory/jobs/ (sin ejecutar nada)
```

Argumentos recibidos: $ARGUMENTS

## Lo que debes hacer

1. Si el argumento es un id de job que existe en `factory/jobs/`, úsalo. Si es una descripción nueva, resúmela en 3-6 palabras clave y genera el id con `bash 01-TOOLS/next-step.sh --new-id 'palabras clave'` (resultado tipo `funcion-clamp-numeros-261104-8acd`); recuerda la descripción completa: se la pasarás a `@intake`. **No saltes a escribir código**: el primer paso siempre lo dice `next-step.sh` (estado 0: crear la worktree).
2. Bucle: `bash 01-TOOLS/next-step.sh <id>` → ejecutar exactamente lo que diga (`RUN:`, `DELEGATE:`) → volver a llamar. Para en `DONE` o en `STOP:` (informa el código, los `WHY:` y los `CMD:`; los `CMD:` los ejecuta el humano).
3. `status`: ejecuta `bash 01-TOOLS/next-step.sh <id>` para cada carpeta de `factory/jobs/` y resume solo la primera línea de cada una. No ejecutes ninguna acción.

## Estados (los resuelve el script; esta tabla es solo referencia)

| # | Condición | Acción |
|---|---|---|
| 0 | no existe el job/worktree | `RUN: new-job.sh` |
| 1 | falta `input.md` | `DELEGATE @intake` |
| 2 | spec o tasks ausentes/inválidos | `DELEGATE @spec-writer` |
| 3 | spec sin `spec.ok` (lo crea el humano) | `STOP: HUMAN_CONFIRM_SPEC` |
| 4 | worktree sin commits | `DELEGATE @builder` |
| 5 | gate ausente u obsoleto (otro commit) | `RUN: checks.sh` |
| 6 | `GATE: FAIL` | `DELEGATE @builder` o `STOP: MAX_ROUNDS` |
| 7 | reviews ausentes/inválidas/obsoletas | `RUN: launch-reviewers.sh` |
| 8 | falta `decision.md` (o es anterior a los reviews) | `DELEGATE @approver` |
| 9 | `CHANGES` / `ESCALATE` | `DELEGATE @builder` · `STOP: MAX_ROUNDS` · `STOP: ESCALATED` |
| 10 | falta `human.md` | `RUN: risk.sh` y, si `NEEDS_HUMAN`, `DELEGATE @human-gate` |
| 11 | falta la documentación del job en el Brain (`trace.md` con `Brain:`, página del job, ADR) | `DELEGATE @memory-curator`; después `RUN: commit-brain.sh` (antes del push) |
| 12 | rama sin subir | `RUN: git push -u origin factory/<id>` |
| 13 | sin PR | `RUN: gh pr create --draft …` o `STOP: HUMAN_CREATE_PR` |
| 14 | todo cumplido | `DONE` |

## Job de documentación (`kind: docs`)

Si `factory/jobs/<id>/job.json` dice `kind: docs` (lo crea `new-job.sh <id> --kind docs`, p. ej. `/factory-init`), el bucle es el mismo pero sin builder: el estado 2 delega en `system-analyst` (spec de documentación), el 4, el 6 y el 9 delegan en el agente dueño de cada documento, el 5 usa el gate de documentación (`checks.sh` lo elige solo), y entre el 10 y el 11 hay un `STOP: HUMAN_CONFIRM_PROJECT` para que el humano apruebe la base. Aparecen `DOCS_NEED_HUMAN`, `DOCS_JOB_INVALID` y, en cualquier job, `BASE_DOCS_BEHIND`: informa y espera.

## Reglas

- Política por proyecto en `factory/project.json` (`require_spec_ok`, `max_rounds`, `spec_profile`, `human_review_surfaces`, páginas del Brain por agente). Solo la edita el humano.
- El Brain aconseja (las líneas `READ:`), `next-step.sh` decide y los permisos/guard hacen cumplir.
- Si el guard bloquea una acción: **se detiene** y pide el cambio al humano; tras 3 bloqueos graves la sesión entra en modo parada (`touch factory/logs/RESET` la reanuda).
- Los agentes nunca hacen push a main ni merge; solo abren PR en borrador. `fast_path` está desactivado por defecto.
- Nada de lo que está sin commitear en el checkout principal entra en un job.
- Cualquier valor ambiguo → CHANGES / ESCALATE / NEEDS_HUMAN / STOP (lado seguro).
- Máquina con poca RAM: `FACTORY_LOW_RESOURCES=1` lanza los reviewers de uno en uno (ver `docs/PARCHE-8.md`).
