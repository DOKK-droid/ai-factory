# Rama 6 — job de documentación (`kind: docs`, RF-I9): parche para `next-step.sh` y `lib.sh`

Rama: `feat/docs-job` · Parche: [`rama6-docs-job.patch`](rama6-docs-job.patch) (2 archivos protegidos: `01-TOOLS/next-step.sh` y `01-TOOLS/lib.sh`) · Lo aplica el humano.

## Qué hace la rama (y qué es parche)

| Pieza | Archivo | Cómo llega |
|---|---|---|
| `new-job.sh <id> [--kind docs\|code]`; `job.json` lleva `kind` (ausente = `code`) | `01-TOOLS/new-job.sh` | directo (en la rama) |
| Lógica del job docs: `docs-job.mjs state --phase work\|fix\|changes\|approve` y `gate` | `factory/scripts/docs-job.mjs` | directo |
| Gate propio de documentación, mismo formato de `gate.md` | `01-TOOLS/checks.sh` | directo |
| Perfil `docs` de `spec-lint` y plantilla `spec-docs-template.md` (viaja en el manifiesto del instalador) | `spec-lint.mjs`, `02-DOCS/wiki/sdd/` | directo |
| `project-lint approve` solo desde una rama `factory/*` (o `--bootstrap`) | `project-lint.mjs` | directo |
| `/factory-init` crea su job con `--kind docs` | `init-project.sh` | directo |
| Prompts (system-analyst, dueños, architect, discovery, orchestrator, `/factory`, `/factory-init`) y paso opcional de CI | `.opencode/`, `project-ci.yml` | directo |
| **Lectura de `kind`, 1c inicial saltado en docs, estados 2/4/6/9 con los agentes dueños, STOP de aprobación (10b), `BASE_DOCS_BEHIND`, corrección del `CMD` del 1c, título del PR, frescura para docs** | `next-step.sh`, `lib.sh` | **parche** |

`factory/config.json` no cambia: no se crea ningún agente.

## Cómo aplicarlo

Las ramas 2, 4 y 5 ya están fusionadas y sus parches aplicados en `main` (se comprobó `IMPLEMENTA_INVALID` en `next-step.sh`), así que **no va apilado**: se aplica sobre `main` tal cual.

```
git switch main && git pull
git switch feat/docs-job            # o tras fusionar la rama, desde main
git apply --check docs/propuestas/rama6-docs-job.patch      # no escribe nada
git apply docs/propuestas/rama6-docs-job.patch
git add 01-TOOLS/next-step.sh 01-TOOLS/lib.sh && git commit -m "Parche de la rama 6: job de documentacion"
FORCE_COLOR=0 node --test tests/*.test.mjs                  # los tests que lo necesitaban dejan de saltarse
```

`docs-job-nextstep.test.mjs` exige que se aplique **entero o nada** (`next-step.sh` y `lib.sh` a la vez) y se salta con el motivo escrito en el propio test (`falta aplicar docs/propuestas/rama6-docs-job.patch`) mientras no esté aplicado.

## Qué cambia en `next-step.sh`

| Estado | Job de código | Job `docs` |
|---|---|---|
| 0 | igual (además lee `kind`: otro valor → `STOP: JOB_INCONSISTENT`) | igual |
| 0b (**nuevo, todos los jobs**) | `STOP: BASE_DOCS_BEHIND` si la base documental de la rama base cambió y la worktree no la tiene (`CMD: git -C factory/worktrees/<id> rebase <base>`); falla cerrado si no puede calcular el merge-base | ídem |
| 1c | igual, pero el `CMD` de aprobación ahora lleva `cd factory/worktrees/<id> &&` | **no aplica** (la base es lo que cambia) |
| 2 | `spec-writer` | `system-analyst`, perfil `docs` de `spec-lint` |
| 4 | `builder` | `docs-job.mjs state --phase work`: `COMMIT`/`TRACE` (RUN), `WORK`/`ALIGN` (DELEGATE al dueño del documento), `READY`; `HUMAN` → `DOCS_NEED_HUMAN`; cualquier otra → `DOCS_JOB_INVALID` |
| 5 | `checks.sh` | `checks.sh` (elige el gate docs solo, mismo `gate.md`) |
| 6 | `builder` | `--phase fix`: dueño del documento que falla, o `DOCS_NEED_HUMAN` (marcadores abiertos / fuera de alcance) |
| 9 (CHANGES) | `builder` | `--phase changes`: dueño del documento que nombra `decision.md` |
| 10b (**nuevo, docs**) | — | `--phase approve`: `OK`, o `STOP: HUMAN_CONFIRM_PROJECT` con `cd factory/worktrees/<id> && node factory/scripts/project-lint.mjs approve <docs>` |
| 11 | curator (según perfil) | curator; la página del job es obligatoria y cita el commit del gate |
| 13 | título del PR del spec | `docs: <título>` |

Códigos `STOP` nuevos (documentados en `orchestrator.md`, que `pipeline-consistency` comprueba): `BASE_DOCS_BEHIND`, `DOCS_NEED_HUMAN`, `DOCS_JOB_INVALID`.

## Qué cambia en `lib.sh` (frescura)

`factory_commit_fresh` ignoraba **todo** commit que solo toca `02-DOCS/wiki/project/`; en un job docs esos commits son el trabajo, así que gate y reviews habrían quedado «vigentes» tras editar un documento. Para `kind: docs` (variable `FACTORY_JOB_KIND`, que exporta `next-step.sh`, o `job.json` de la rama `factory/<id>` para `risk.sh` y `launch-reviewers.sh`):

- **no invalidan**: `project.ok`, `trazabilidad.md`, la página del job y `index.md` del curator, y un commit que solo cambie la línea `estado:` de la cabecera de un documento (lo que escribe `project-lint approve`);
- **sí invalidan**: cualquier cambio del cuerpo de un documento, de `version`/`fecha`, de `decisions.md`, de otro documento o de código.

El detalle que el plan no recogía: `approve` también reescribe `estado:` en la cabecera de cada documento, no solo `project.ok`. Sin la excepción de `estado:` el commit de aprobación invalidaría los reviews y habría bucle (aprobar → reviews obsoletos → aprobar…). Un job de código no cambia: sigue ignorando la base documental.

## Tabla de riesgos

| # | Riesgo | Probabilidad / impacto | Mitigación | Cómo se comprobó |
|---|---|---|---|---|
| 1 | Es la rama que más toca el plano de control | — | Un job de código recorre los mismos estados que antes; todo lo nuevo cuelga de `JOB_KIND = docs` o es un STOP más; todos los tests anteriores siguen en verde | suite completa sin y con parche; mutaciones sobre `next-step.sh`/`lib.sh` |
| 2 | `docs-job.mjs` contesta algo inesperado | baja / se detendría | `next-step.sh` solo reconoce las palabras de cada fase; vacío, texto raro, palabra de otra fase o un crash de node → `STOP: DOCS_JOB_INVALID` | tests con un `docs-job.mjs` sustituido por un stub (copia de la fábrica) |
| 3 | `BASE_DOCS_BEHIND` compara con el ref **local** `origin/main` (next-step es de solo lectura y no hace `fetch`) | media / avisa tarde | tras fusionar un PR de documentación y hacer `git fetch`, todo job abierto para en `BASE_DOCS_BEHIND` hasta rebasar; si el humano no hace fetch, no se entera hasta `git push` | tests con `origin` real y un segundo clon; falla cerrado si no hay merge-base |
| 4 | Un agente que no cambia nada deja el job delegando al mismo dueño en bucle | media / la misma debilidad que ya tiene el builder | los prompts le dicen que no invente un cambio y que se detenga; el orchestrator informa. Un `ALIGN`/`WORK` repetido sin cambios es visible en `STATE:` | **no resuelto**: igual que `builder` en el estado 4 |
| 5 | Los 4 reviewers y el `risk.sh` están pensados para código («sin tests», «diff vacío») | alta / ruido | `Surface: none` ⇒ ux/ui `PASS (n/a)`; el spec dice «Cambio documental»; `risk.sh` añade `diff_vacio` (excluye la base documental) y por eso un job docs **nunca** sale como `FAST_PATH` (resultado seguro, aunque por casualidad; medido ejecutando `risk.sh` con `fast_path.enabled=true`: `NEEDS_HUMAN` con `diff_vacio`) | el E2E pasa con los reviewers simulados; **supuesto**: que reviewer-code no pida tests a un job docs; no se ha medido con un modelo |
| 6 | `job.json` no está en la evidencia protegida del guard (`command-guard.mjs`), y ahora lleva `kind` | baja / medio | el `edit` de todos los agentes lo deniega (el builder lo nombra); cambiar `kind` no sirve para saltarse el gate: el gate docs falla con cualquier archivo fuera de la base, y pasar un job docs a `code` no quita la aprobación humana del PR | **recomendación**: añadir `job.json` a `JOB_EVIDENCE_RE` en una rama futura (archivo solo-humano) |
| 7 | La excepción de `estado:` deja pasar un cambio solo de cabecera después del gate | baja / bajo | solo la línea `estado:` de las 8 primeras; `version`, `fecha` y el cuerpo siguen invalidando; el `project-lint gate` del 10b rechaza un `estado: aprobado` sin registro en `project.ok` (PL053) | test con estado+cuerpo, versión y una línea `estado:` en el cuerpo |
| 8 | Cambia el `CMD` del 1c de los jobs de código | cierta / mejora | antes aprobaba el checkout principal y el STOP no se resolvía nunca (medido ejecutando); ahora `cd factory/worktrees/<id> &&` | test que ejecuta el `CMD` desde el checkout y comprueba `project.ok` en la worktree y no en `main` |
| 9 | Jobs creados antes de aplicar el parche | — | sin `kind` en `job.json` = `code`; nada cambia para ellos salvo `BASE_DOCS_BEHIND` | test de job.json sin `kind` |
| 10 | El job `init-*` ya existente (creado sin `--kind docs`) sigue siendo de código | media / confusión | `init-project.sh` solo crea los nuevos con `kind: docs`; para uno viejo, borrar y recrear la worktree o editar `job.json` a mano (humano) | — |

## Qué no se ha probado

- La primera ejecución real de `/factory-init` y de un job docs con un modelo: los agentes se simulan escribiendo en la worktree lo que harían.
- El comportamiento de los reviewers ante un diff solo de documentación.
- El paso opcional de CI en GitHub Actions: se ejecuta su script en un repo temporal, no en un runner.
