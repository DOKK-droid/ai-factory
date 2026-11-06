# Propuesta de la rama 2: parche a archivos protegidos

Los cuatro archivos que toca este parche los edita solo el humano (`01-TOOLS/next-step.sh`, `factory/scripts/command-guard.mjs`) o son plomería del plano de control (`01-TOOLS/lib.sh`, `factory/scripts/scope-check.mjs`). La rama no los modifica: se entregan en [`rama2-brain-requests.patch`](rama2-brain-requests.patch) (192 líneas, 4 archivos, solo añade o cambia lo indicado aquí).

## Cómo aplicarlo y comprobarlo

```
git switch feat/brain-requests
git apply --check docs/propuestas/rama2-brain-requests.patch   # no escribe nada; debe salir 0
git apply docs/propuestas/rama2-brain-requests.patch
FORCE_COLOR=0 node --test tests/*.test.mjs
FORCE_COLOR=1 node --test tests/*.test.mjs
git add -- 01-TOOLS/lib.sh 01-TOOLS/next-step.sh factory/scripts/command-guard.mjs factory/scripts/scope-check.mjs
git commit -m "feat(factory): next-step, guard, scope y lib reconocen las peticiones al Brain y project_docs"
```

Hasta que lo apliques, 12 tests de `tests/brain-request.test.mjs` salen como «saltados: falta aplicar el parche» (no como verdes) y otro test falla si el parche está aplicado a medias. Para deshacerlo: `git apply --reverse docs/propuestas/rama2-brain-requests.patch`.

## Qué cambia en `next-step.sh` (y qué garantiza que no rompe lo existente)

| Hunk | Cambio | Por qué es seguro |
|---|---|---|
| comentarios | documenta `project_docs` y la marca `brain.ok` | solo comentarios |
| variables | `BRAIN_REQ`, `PROJECT_LINT` y `PROJECT_DOCS=off` por defecto | no se usan hasta los bloques 1b y 1c |
| política (node) | valida `project_docs` (`off` o `required`) y emite `PROJECT_DOCS=`; el bucle de lectura lo guarda | un valor ausente da `off`; uno inválido da `PROJECT_INVALID`, como las demás claves |
| **1b** (nuevo, antes del estado 2) | llama a `brain-request.mjs state` y traduce la primera palabra de su respuesta | sin `brain-request.md` el script responde `NONE` y el bloque no hace nada |
| **1c** (nuevo, antes del estado 2) | si `project_docs=required`, ejecuta `project-lint gate` y, si falla, `STOP: HUMAN_CONFIRM_PROJECT` | con `off` o sin la clave no se ejecuta |
| estado 4 | el conteo de commits excluye `02-DOCS/wiki/project` y `decisions.md` | un commit solo de documentación (petición aplicada antes de que el builder escriba código) no debe hacer creer que el builder ya trabajó |

Lo que hace el bloque 1b, línea a línea de significado:
- `NONE` o `DONE`: sigue el flujo normal.
- `CONFIRM`: `STOP: HUMAN_CONFIRM_BRAIN` con las peticiones y `CMD: touch factory/jobs/<id>/brain.ok`.
- `APPLY BR-n` o `ALIGN`: `DELEGATE` al agente dueño del documento, con 3 campos. Si falta agente, archivo o tarea, `STOP: BRAIN_REQUEST_INVALID`.
- `COMMIT`: `RUN` de `commit-brain.sh <id> --project [BR-n]`.
- `REAPPROVE`: `STOP: HUMAN_CONFIRM_PROJECT` con el `CMD` de `project-lint approve`.
- `INVALID` o **cualquier otra respuesta, vacía o con error de node**: `STOP: BRAIN_REQUEST_INVALID`. Nunca avanza con una respuesta que no entiende.

El bloque 1b no escribe nada y no usa el estado para decidir: las peticiones aplicadas se leen de los commits (`Brain-Request: BR-n` entre la base y `HEAD`), y la confirmación es `brain.ok` más nuevo que `brain-request.md`, como `spec.ok` frente a `spec.md`.

## Qué cambia en los otros tres

- `command-guard.mjs`: `brain.ok` se protege igual que `spec.ok` (en `JOB_EVIDENCE_RE`); `02-DOCS/wiki/project/project.ok` entra en `PROTECTED_PATHS`; y un agente no puede ejecutar `project-lint ... approve` (`APPROVE_RE`; con `allowProtected`, el humano sí).
- `scope-check.mjs`: `PROJECT_DOC_PATHS = ['02-DOCS/wiki/project']` se trata como el Brain del curator: no tiene que figurar en `Alcance:`. El builder no puede escribir ahí (lo deniega su frontmatter, ya incluido en la rama).
- `lib.sh`: `FACTORY_PROJECT_DOC_PATHS` entra en `factory_curator_excludes`, así un commit solo de base documental no invalida el gate ni los reviews. Motivo: sin esto, cada petición aplicada consumiría una ronda de `max_rounds` (por defecto 3) repitiendo los 4 reviewers sobre código que no cambió. La base documental la aprueba el humano con `project.ok`.

`FACTORY_CURATOR_PATHS` y `CURATOR_PATHS` no cambian (siguen coincidiendo, hay un test), y `CURATOR_RE` de `next-step.sh` tampoco.

## Riesgos que conozco

| Riesgo | Estado |
|---|---|
| un agente con permiso de edición sobre `brain-request.md` (builder, spec-writer, approver) podría borrarlo y así ocultar una petición | residual. Mitigación: solo esos tres lo escriben, el prompt les prohíbe borrar, y las peticiones aplicadas quedan en el historial de git. No hay un «solo añadir» en los permisos de OpenCode |
| los commits de base documental no pasan por los reviewers | decisión explícita (arriba). La revisión es humana: `brain.ok` antes de aplicar y `project.ok` después, más el PR |
| el `DELEGATE` de `APPLY`/`ALIGN` nombra a `system-analyst`, `domain-modeler`, `architect` o `deployment-planner`, que se crean en la rama 4 | hasta entonces, si se produjera una petición, el humano resuelve ese paso a mano. Con el flujo actual no hay `brain-request.md` y no ocurre |
| `project_docs=required` bloquea en cada llamada ejecutando `project-lint gate` | un `node` por llamada, como ya hace con `spec-lint` |

## Cambio opcional en `factory/project.json` (tampoco lo toco)

Para que `next-step.sh` imprima la línea `READ:` con la base documental a los agentes que deciden con ella, en `brain.agents`:

```json
"builder": ["02-DOCS/wiki/project/01-requisitos.md", "02-DOCS/wiki/project/02-casos-de-uso.md", "02-DOCS/wiki/project/03-dominio.md", "02-DOCS/wiki/project/04-arquitectura.md"],
"spec-writer": ["02-DOCS/wiki/sdd/methodology.md", "02-DOCS/wiki/sdd/spec-template.md", "02-DOCS/wiki/sdd/decisions.md", "02-DOCS/wiki/project/00-vision.md", "02-DOCS/wiki/project/01-requisitos.md", "02-DOCS/wiki/project/02-casos-de-uso.md", "02-DOCS/wiki/project/03-dominio.md", "02-DOCS/wiki/project/04-arquitectura.md"],
"approver": ["02-DOCS/wiki/sdd/methodology.md", "02-DOCS/wiki/project/01-requisitos.md", "02-DOCS/wiki/project/02-casos-de-uso.md"]
```

`brain_read` ignora las páginas que no existen, así que es inocuo en proyectos sin base documental. Y `"project_docs": "required"` solo se pone cuando el proyecto ya tiene su base aprobada (o va a crearla con `/factory-init`).
