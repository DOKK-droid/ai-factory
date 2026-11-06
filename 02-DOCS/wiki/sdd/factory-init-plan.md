# Plan de ramas: `/factory-init` y base documental del proyecto

Estado: borrador · Fecha: 2026-11-06 · Especificación: [`factory-init-spec.md`](factory-init-spec.md)

Cómo se construye, en qué orden y con qué comprobaciones. Una rama = un tema = un PR en borrador; todas salen de `main` actualizado y se fusionan en el orden de la tabla. Los archivos que solo edita el humano (`factory/config.json`, `01-TOOLS/next-step.sh`, `factory/scripts/command-guard.mjs`, `factory/project.json`, `AGENTS.md`) no se tocan en ninguna rama: cada rama entrega su cambio como parche (`docs/propuestas/<rama>.patch`) y se comprueba aplicándolo en una worktree temporal.

Las ramas no usan el prefijo `factory/`: el hook `pre-commit` solo deja commitear `factory/*` dentro de su worktree de job.

## Resumen

| # | Rama | Tema | Depende de | Parche para el humano |
|---|---|---|---|---|
| 0 | `docs/factory-init-plan` | este plan y la especificación | — | — |
| 1 | `feat/project-docs-base` | plantillas, `project-lint.mjs`, `gen-index.mjs` | — | — |
| 2 | `feat/brain-requests` | `brain-request.md`, `brain.ok`, `project_docs` y `HUMAN_CONFIRM_*` | 1 | `next-step.sh`, `command-guard.mjs`, `lib.sh`/`scope-check.mjs` (rutas), prompts |
| 3 | `feat/rsc-pinned` | `rsc-pin.sh` y RSC fijado en el instalador | — | — |
| 4 | `feat/factory-init` | 6 agentes, `/factory-init`, `init-project.sh` | 1, 2, 3 | `factory/config.json` |
| 5 | `feat/project-traceability` | `Implementa:` en spec y página del job, `project-status` | 1, 2 | `next-step.sh` (`brain_problem`) |
| 6 | `feat/docs-job` | job de documentación (`kind: docs`) | 2, 4, 5 | `next-step.sh` |
| 7 | `docs/adr-brain-en-main` | ADR-012 y ADR-013, guías, propuesta para `AGENTS.md` | todas | `AGENTS.md` |

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

Entrega: `.opencode/agent/{discovery,system-analyst,domain-modeler,architect,deployment-planner,consistency-auditor}.md`, `.opencode/command/factory-init.md`, `factory/scripts/init-project.sh`, entradas del manifiesto del instalador y tests de `init-project.sh` con las cuatro fixtures.
Parche para el humano: seis líneas nuevas en `roles` de `factory/config.json` (modelos de la especificación §10).
Comprobación: `tests/pipeline-consistency.test.mjs` ampliado (patrones `edit` que empiezan por `*`, cada especialista solo escribe sus archivos, nadie salvo discovery tiene `task`).

## Rama 5 — integración con el spec y el estado (RF-I15)

Entrega: `spec-lint.mjs` exige `Implementa:` en cada RF cuando hay documentos de proyecto aprobados; plantillas de spec y de página de job con `Implementa:`; `factory/scripts/project-status.mjs` (solo lectura).
Parche para el humano: validación de `Implementa:` en `brain_problem` de `next-step.sh`.

## Rama 6 — job de documentación (RF-I9)

Entrega: `new-job.sh` acepta `--kind docs`; `job.json` lleva `kind`; en `next-step.sh` un job `docs` sustituye spec y builder por los agentes de documentación y el gate por `project-lint gate`; el resto del pipeline (reviewers, approver, human-gate, PR) no cambia. `init-project.sh` crea su job como `kind: docs`.
Parche para el humano: bifurcación por `kind` en `next-step.sh`.
Riesgo alto: es la rama que más toca el plano de control; va después de comprobar las anteriores.

## Rama 7 — ADR y guías

Entrega: ADR-012 (Brain en la línea de `main`, alternativa descartada «rama paralela» con sus costes medidos con `grep` en ese momento), ADR-013 (base documental: formato, aprobación por hash, trazabilidad derivada), secciones nuevas en `docs/ONBOARDING.md`, `docs/PRUEBAS-FABRICA.md` y `methodology.md`, y la propuesta de cambio de `AGENTS.md`.

## Entregas al humano por rama

Cada rama termina con: lista de commits, resultado de `node --test tests/*.test.mjs` con `FORCE_COLOR=0` y `=1`, tabla de mutaciones (regla, mutación, test que falla), el parche (si lo hay) con el comando para aplicarlo, y los comandos de `git push` y `gh pr create --draft` para que los ejecutes tú. No hay push ni PR sin pedirlo.

## Registro de avance

- [x] Rama 0 — plan y especificación
- [x] Rama 1 — `feat/project-docs-base` (plantillas, `project-lint`, `gen-index`; 553 tests en verde; 39 mutaciones detectadas)
- [ ] Rama 2
- [ ] Rama 3
- [ ] Rama 4
- [ ] Rama 5
- [ ] Rama 6
- [ ] Rama 7
