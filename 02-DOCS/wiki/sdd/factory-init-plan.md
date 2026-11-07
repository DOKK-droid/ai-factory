# Plan de ramas: `/factory-init` y base documental del proyecto

Estado: borrador · Fecha: 2026-11-06 · Especificación: [`factory-init-spec.md`](factory-init-spec.md)

Cómo se construye, en qué orden y con qué comprobaciones. Una rama = un tema = un PR en borrador; todas salen de `main` actualizado y se fusionan en el orden de la tabla. Los archivos que solo edita el humano (`factory/config.json`, `01-TOOLS/next-step.sh`, `factory/scripts/command-guard.mjs`, `factory/project.json`, `AGENTS.md`) no se tocan en ninguna rama: cada rama entrega su cambio como parche (`docs/propuestas/<rama>.patch`) y se comprueba aplicándolo en una worktree temporal.

Las ramas no usan el prefijo `factory/`: el hook `pre-commit` solo deja commitear `factory/*` dentro de su worktree de job.

## Resumen

| # | Rama | Tema | Depende de | Parche para el humano |
|---|---|---|---|---|
| 0 | `docs/factory-init-plan` | este plan y la especificación | — | — |
| 1 | `feat/project-docs-base` | plantillas, `project-lint.mjs`, `gen-index.mjs` | — | — |
| 2 | `feat/brain-requests` | `brain-request.md`, `brain.ok`, `project_docs` y `HUMAN_CONFIRM_*` | 1 (apilada) | `next-step.sh`, `command-guard.mjs`, `lib.sh`/`scope-check.mjs` (rutas), prompts |
| 3 | `feat/rsc-pinned` | `rsc-pin.sh` y RSC fijado en el instalador | — | — |
| 4 | `feat/factory-init` | 6 agentes, `/factory-init`, `init-project.sh` | 1, 2, 3 | `factory/config.json` |
| 5 | `feat/project-traceability` | `Implementa:` en spec y página del job, `project-status`, `implementa.lock` | 1, 2 | `next-step.sh` (bloque 3b, estados 5 y 7, `brain_problem`) y `command-guard.mjs` |
| 6 | `feat/docs-job` | job de documentación (`kind: docs`) | 2, 4, 5 | `next-step.sh` y `lib.sh` |
| 6b | `feat/docs-job-robustez` | `sync-base.sh`, `progress-check.sh`, `risk.sh` explícito para docs, prompts de reviewers, nota en `ONBOARDING.md` | 6 y la prueba real | — |
| 6c | `feat/guard-job-json` | `job.json` en la evidencia protegida del guard | 6 | `command-guard.mjs` |
| — | (sin rama: la ejecuta el humano) | prueba real P1–P6 con un modelo en un repo desechable | 6 | — |
| 7 | `docs/adr-brain-en-main` | ADR-012 y ADR-013, guías, propuesta para `AGENTS.md` | todas, y la prueba real | `AGENTS.md` |

Cambio respecto a la propuesta inicial: RSC (3) va antes que los agentes (4) porque `init-project.sh` llama a `rsc-pin.sh`; y se añade la rama 6 porque el protocolo exige el «job de documentación» y la rama 5 no lo cubre.

## Rama 0 — plan y especificación

- Entrega: esta página, `factory-init-spec.md` y sus dos filas en `index.md`.
- Comprobación: la suite completa sigue en verde (508 tests al iniciar) con `FORCE_COLOR=0` y `=1`.

## Rama 1 — plantillas, `project-lint` e índice generado (RF-I1 a RF-I6)

Entrega:
- `factory/templates/project/{00-vision,01-requisitos,02-casos-de-uso,03-dominio,04-arquitectura,05-datos,06-despliegue,discovery}.md`: plantillas cortas con cabecera, marcadores `RELLENAR` y un ejemplo Mermaid comentado.
- `factory/scripts/project-lint.mjs`: `check`, `state`, `impact`, `trace`, `approve`, `gate` (sin dependencias, estilo `spec-lint.mjs`).
- `factory/scripts/gen-index.mjs`: `--check` y `--write`.
- Tests: `tests/project-lint.test.mjs`, `tests/gen-index.test.mjs`, fixtures en `tests/project-fixture.mjs`.

Fuera: no se cambia el `index.md` de la fábrica ni `install-into.sh` (las plantillas y scripts viajan solos porque `factory/templates` y `factory/scripts` ya están en el manifiesto; hay un test que lo prueba).

Comprobación: un test por cada código `PLxxx` y una mutación por regla que lo hace fallar (tabla en la especificación, §13).

## Rama 2 — peticiones de cambio al Brain y política de proyecto (RF-I7, RF-I8)

Entrega sin tocar protegidos: formato y validador de `brain-request.md` (`factory/scripts/brain-request.mjs`), `commit-brain.sh --project`, prompts de los agentes de la fábrica (lectura del Brain normativo, escritura de peticiones), tests.
Parche para el humano: estados `HUMAN_CONFIRM_BRAIN`, `HUMAN_CONFIRM_PROJECT`, `BRAIN_REQUEST_INVALID` en `next-step.sh`; `brain.ok` y `project.ok` en `PROTECTED_PATHS`; ruta `02-DOCS/wiki/project` en `FACTORY_CURATOR_PATHS` y en `scope-check.mjs`.
Comprobación: se aplica el parche en una worktree temporal y se corre la suite completa; los tests que dependen del parche llevan `skip` explícito mientras `next-step.sh` no contenga el estado nuevo (condición escrita en el propio test, nunca silenciosa).

## Rama 3 — RSC fijado (RF-I13, RF-I14)

Entrega: `factory/rsc-pin.json` (versión `3.6.0` e integridad `sha512-o4rEaT24…`), `factory/scripts/rsc-pin.sh` (dry-run por defecto, `--apply`, `--check`), integración en `install-into.sh` (dry-run lo lista, `--check` lo compara), tests con un `npx` simulado y una prueba en vivo opcional (`FACTORY_LIVE_RSC=1`).
Comprobación: el caso «RSC instalado, sync apagado, `AGENTS.md` respetado» en los dos órdenes (RSC primero y fábrica primero).

## Rama 4 — agentes, comando e inicializador (RF-I10 a RF-I12)

Entrega (D5/D9: los proyectos instalados nacen con `project_docs: required` y sus agentes leen la base): `.opencode/agent/{discovery,system-analyst,domain-modeler,architect,deployment-planner,consistency-auditor}.md`, `.opencode/command/factory-init.md`, `factory/scripts/init-project.sh`, entradas del manifiesto del instalador y tests de `init-project.sh` con las cuatro fixtures.
Parche para el humano: seis líneas nuevas en `roles` de `factory/config.json` (modelos de la especificación §10).
Comprobación: `tests/pipeline-consistency.test.mjs` ampliado (patrones `edit` que empiezan por `*`, cada especialista solo escribe sus archivos, nadie salvo discovery tiene `task`).

## Rama 5 — integración con el spec y el estado (RF-I15)

Entrega: `spec-lint.mjs` exige `Implementa:` en cada RF cuando hay documentos de proyecto aprobados; plantillas de spec y de página de job con `Implementa:`; `factory/scripts/project-status.mjs` (solo lectura); **`project-lint stamp` y la realineación del spec (RF-I18, especificación §12)**: el `spec.ok` queda ligado a los IDs que el spec cita y un cambio aprobado en la base devuelve el job a `spec-writer`.
Parche para el humano: validación de `Implementa:` en `brain_problem` de `next-step.sh`; comprobación de `implementa.lock` y estado de realineación en `next-step.sh`; `implementa.lock` en la evidencia protegida de `command-guard.mjs`.
Comprobación añadida: cambiar `REQ-F-n` después de `spec.ok` devuelve el job a `spec-writer`; cambiar otro ID no.

## Rama 6 — job de documentación (RF-I9)

Entrega (decisiones D10 a D13 de la especificación): `new-job.sh <id> --kind docs|code` y `kind` en `job.json` (ausente = `code`); `factory/scripts/docs-job.mjs` (`state --phase work|fix|changes|approve` y `gate`); gate de documentación en `checks.sh` (mismo `gate.md`, sin tests del proyecto); perfil `docs` de `spec-lint` y plantilla `spec-docs-template.md` (viaja en el instalador); `project-lint approve` solo desde una rama `factory/*` o con `--bootstrap`; `init-project.sh` crea su job con `--kind docs`; prompts (system-analyst escribe el spec docs, los dueños y el architect actúan en un job docs, discovery, `/factory-init`, `/factory`, orchestrator); paso opcional de CI comentado.
Parche para el humano (`docs/propuestas/rama6-docs-job.patch`, `next-step.sh` y `lib.sh`): lectura de `kind` (otro valor = `JOB_INCONSISTENT`), 1c inicial saltado en docs, estados 2/4/6/9 con los dueños, `STOP: HUMAN_CONFIRM_PROJECT` al final (10b), `BASE_DOCS_BEHIND` (cualquier job), frescura de `lib.sh` para docs, corrección del `CMD` del 1c y título del PR. Tres `STOP` nuevos: `BASE_DOCS_BEHIND`, `DOCS_NEED_HUMAN`, `DOCS_JOB_INVALID`.
Puntos abiertos que cerró: (b) base desactualizada en la worktree → `BASE_DOCS_BEHIND`; (c) aprobar sin job → `approve` restringido + CI opcional; y un fallo no previsto, medido ejecutando: el `CMD` del 1c aprobaba el checkout principal y el STOP no se resolvía nunca.
Detalle no previsto en el plan: `project-lint approve` también reescribe `estado:` en la cabecera de cada documento, no solo `project.ok`; sin una excepción para ese cambio en la frescura el commit de aprobación invalidaría los reviews y habría bucle.

## Ramas 6b y 6c y la prueba real previa a la rama 7

Detalle, criterios de aceptación y guion en [`rama6b-y-prueba-real.md`](rama6b-y-prueba-real.md). Resumen:
- **Orden:** prueba real, luego 6b con lo que enseñe (R1, R3a y R10 son independientes; R2 y R3b dependen de ella), luego 6c (parche del guard), luego la rama 7.
- **6b** cierra los riesgos 3, 4, 5 y 10 de la rama 6 con archivos directos: `sync-base.sh` (un `git fetch` fuera de `next-step.sh`), `progress-check.sh` (`STOP: AGENT_NO_PROGRESS` si un agente repite sin cambiar el `HEAD`), `risk.sh` con una razón explícita `docs_requiere_humano` y los prompts de los reviewers.
- **6c** añade `job.json` a `JOB_EVIDENCE_RE`; al ser solo-humano, va como parche.
- **Prueba real:** seis escenarios (`/factory-init`, aprobar la base, cambio de requisito por prompt, job docs completo, job de código como regresión, `BASE_DOCS_BEHIND`) y qué anotar de cada uno. Hoy no hay ninguna medición con un modelo real.

## Rama 7 — ADR y guías

Entrega: ADR-012 (Brain en la línea de `main`, alternativa descartada «rama paralela» con sus costes medidos con `grep` en ese momento), ADR-013 (base documental: formato, aprobación por hash, trazabilidad derivada), secciones nuevas en `docs/ONBOARDING.md`, `docs/PRUEBAS-FABRICA.md` y `methodology.md`, y la propuesta de cambio de `AGENTS.md`.

## Entregas al humano por rama

Cada rama termina con: lista de commits, resultado de `node --test tests/*.test.mjs` con `FORCE_COLOR=0` y `=1`, tabla de mutaciones (regla, mutación, test que falla), el parche (si lo hay) con el comando para aplicarlo, y los comandos de `git push` y `gh pr create --draft` para que los ejecutes tú. No hay push ni PR sin pedirlo.

## Registro de avance

- [x] Rama 0 — plan y especificación
- [x] Rama 1 — `feat/project-docs-base` (plantillas, `project-lint`, `gen-index`; 553 tests en verde; 39 mutaciones detectadas)
- [x] Rama 2 — `feat/brain-requests` (apilada sobre la rama 1 hasta que se fusione; parche en `docs/propuestas/rama2-brain-requests.patch`, aplicado en el PR #30; 586 tests con el parche, 12 saltados sin él)
- [x] Rama 3 — `feat/rsc-pinned` (`rsc-pin.json`, `rsc-pin.sh` e integración en `install-into.sh`; sin parche para el humano; 608 tests en verde con `FORCE_COLOR=0` y `=1`, 1 saltado (prueba en vivo con `FACTORY_LIVE_RSC=1`, pasa); 27 mutaciones detectadas, 0 sobrevivieron). Medido en vivo con RSC 3.6.0: `sync` sí registra `auto-update`, pero RSC reescribe `opencode.json` (cambia `git push: deny`); `rsc-pin.sh` lo restaura y fija `gitPermissions=false`. Detalle en el §11 de la especificación
- [x] Rama 4 — `feat/factory-init` (seis agentes, `/factory-init`, `init-project.sh`, instalador con `project_docs: required` y lectura de la base por los agentes; roles de los seis agentes **aplicados** en `factory/config.json` por indicación del humano y gobernados por `apply-models`; la propia fábrica con `project_docs: required`; `discovery` con rondas de hasta 10 preguntas; 637 tests en verde con `FORCE_COLOR=0` y `=1`, 1 saltado (prueba en vivo de RSC); 43 mutaciones detectadas, 0 sobrevivieron). Verificado con `opencode debug agent` (1.18.35): `task` por agente, `webfetch: ask` y `websearch: deny` se leen como se escriben; **no probado**: el comportamiento en ejecución con un modelo. Consecuencia: en este repo, `/factory` se detiene en `HUMAN_CONFIRM_PROJECT` antes del spec hasta que `/factory-init` deje la base aprobada
- [x] Rama 5 — `feat/project-traceability` (`spec-lint` exige `Implementa:` en cada RF cuando `project_docs=required` o hay documentos aprobados, y comprueba que los IDs existan en la base de la worktree del job; `project-lint stamp` y `realign` guardan y comparan en `implementa.lock` el hash de cada bloque citado (el mismo que `refs` de `project.ok`); `project-status.mjs` (solo lectura); plantillas y prompts; el builder ya no puede escribir el lock. **Decisión B (humano, 2026-11-06): un spec realineado invalida gate, reviews y decisión** y el flujo se repite hasta el approver, que decide; `max_rounds` acota las pasadas. Parche para el humano en `docs/propuestas/rama5-project-traceability.patch` (100 líneas, `next-step.sh` y `command-guard.mjs`), **aplicado en el PR #34**. Medido ejecutando (antes de aplicarlo): con el parche aplicado en una worktree temporal, 686 tests, 685 en verde y 1 saltado (prueba en vivo de RSC) con `FORCE_COLOR=0` y `=1`; sin parche, 671 en verde y 15 saltados (la prueba en vivo y 14 tests que dependen del parche, con su motivo escrito en el test) con ambos colores; 52 mutaciones, 48 detectadas a la primera y 4 sobrevivientes que eran tests flojos (se endurecieron y mueren), 0 sobreviven. Dos tests de la rama 2 se tocaron porque el spec ahora cita la base y porque un parche posterior invalida su `--reverse`. **No probado**: la realineación con un modelo real en ejecución, y `project-status` fuera del equipo local con jobs reales. Punto abierto (b) sin cerrar: el lock liga el spec a la base de la worktree, no a `main`; lo cierra la rama 6)
- [x] Rama 6 — `feat/docs-job` (job de documentación `kind: docs`, RF-I9; CA-I9.1: un job docs llega a PR sin builder, test E2E con `drive`). Parche para el humano en `docs/propuestas/rama6-docs-job.patch` (`next-step.sh` y `lib.sh`, 239 líneas), **aplicado en el PR #36** (squash `9a2dcf4`; tras él, un commit corrige cuatro alertas de CodeQL: tabuladores y comentarios HTML en `docs-job.mjs` y `spec-lint.mjs`, con tests y mutaciones; suite final 781 tests, 780 en verde y 1 saltado, en los dos modos de color); no iba apilado: las ramas 2, 4 y 5 ya estaban en `main`. Medido ejecutando: 780 tests; **sin parche** 754 en verde y 26 saltados (la prueba en vivo de RSC y 25 que dependen del parche, con su motivo escrito en el test) con `FORCE_COLOR=0` y `=1`; **con parche** 779 en verde y 1 saltado (la de RSC) en las dos pasadas, salvo un fallo puntual de tiempo en `launch-reviewers.test.mjs` (vigilante por inactividad, límite de 300 s) bajo carga en una pasada, que aislado pasa con y sin parche y no toca esta rama. 86 mutaciones, 6 sobrevivieron a la primera (cinco tests flojos y un respaldo sin ejercitar) y se endurecieron: 0 sobreviven; el test extra del gate destapó además un fallo real (un documento borrado hacía caer el gate en vez de dar PL005), corregido. Tests existentes tocados: las dos semillas que aprueban sobre `main` (`trace-fixture.mjs` y `seedProject` de `brain-request.test.mjs`) pasan `--bootstrap`; la aserción del `CMD` del 1c en `brain-request.test.mjs` admite el `cd` cuando el parche está aplicado; `ns-fixture.mjs` (`kind` en `fx`, el agente simulado de `drive` recibe la acción); `pipeline-consistency.test.mjs` admite `spec.md`/`tasks.md` solo para `system-analyst`; `install-into.test.mjs` suma la plantilla. **No probado**: la primera ejecución real de `/factory-init` y de un job docs con un modelo (los agentes se simulan), el comportamiento de los reviewers ante un diff solo de documentación, y el paso opcional de CI en un runner real. Riesgos abiertos: un agente que no cambia nada deja el job delegando en bucle (igual que el builder), `BASE_DOCS_BEHIND` compara con el ref local `origin/main` (hace falta `git fetch`) y `job.json` no está en la evidencia protegida del guard (recomendación: añadirlo a `JOB_EVIDENCE_RE` en una rama aparte)
- [ ] Rama 6b — `feat/docs-job-robustez`: diseñada, sin implementar (ver `rama6b-y-prueba-real.md` §2)
- [ ] Rama 6c — `feat/guard-job-json`: diseñada, parche del guard sin escribir (§3)
- [ ] Prueba real P1–P6 con un modelo: pendiente, la ejecuta el humano (§4)
- [ ] Rama 7
