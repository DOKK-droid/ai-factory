# Rama 6b, guard de `job.json` y prueba real previa a la rama 7

Estado: propuesto (nada de esto está implementado ni medido) · Fecha: 2026-11-07 · Plan: [`factory-init-plan.md`](factory-init-plan.md) · Especificación: [`factory-init-spec.md`](factory-init-spec.md) §8.1 y §14

La rama 6 (`kind: docs`, PR #36) quedó fusionada con riesgos abiertos que se anotaron en `docs/propuestas/rama6-docs-job.md`. Esta página dice **qué se hará con cada uno, en qué orden y cómo se sabrá que está bien**, y define la prueba real que decide qué entra y qué no antes de la rama 7 (ADR y guías). Todo lo de abajo es un diseño: si algo no se ha comprobado, está dicho.

## 1. Orden

1. **Prueba real** (§4). Es lo único que convierte en medidos los supuestos de la rama 6: los agentes se simularon en los tests y los 4 reviewers nunca vieron un diff solo de documentación.
2. **Rama 6b** (§2), con lo que la prueba enseñe. Los ítems marcados «independiente» pueden hacerse antes; los marcados «depende» no deben escribirse a ciegas.
3. **Rama 6c** (§3): parche del guard. No depende de la prueba.
4. **Rama 7** (§5), que documenta lo medido, no lo supuesto.

## 2. Rama 6b — `feat/docs-job-robustez`

Un solo tema: que un job (de documentación o de código) falle cerrado y a tiempo, no tarde ni en bucle. Sin parches: todo son archivos directos. Ningún archivo solo-humano se toca.

| # | Riesgo de la rama 6 | Cambio propuesto | Archivos | ¿Depende de la prueba? |
|---|---|---|---|---|
| R1 | `BASE_DOCS_BEHIND` compara con el ref **local** `origin/<base>` y `next-step.sh` es de solo lectura: sin `git fetch` no se entera | Script nuevo `01-TOOLS/sync-base.sh`: hace `git fetch --quiet origin <base>`; si falla (sin red, sin remoto) imprime un aviso y sale 0, porque no puede empeorar lo que ya hay. El orchestrator lo ejecuta **una vez al empezar cada `/factory`**, antes de `next-step.sh`. No va dentro de `next-step.sh` (rompería su contrato) ni usa `git fetch` suelto: `orchestrator.md` solo permite `bash 01-TOOLS/*`; `git fetch` caería en `"*": ask` | `01-TOOLS/sync-base.sh`, `.opencode/agent/orchestrator.md`, `new-job.sh` (opcional) | Independiente |
| R2 | Un agente que no cambia nada deja el job delegando en bucle, igual que el builder | Script nuevo `01-TOOLS/progress-check.sh <id> before\|after <agente>`: guarda el `HEAD` de la worktree antes de delegar en `factory/jobs/<id>/progress.log` y lo compara después. Mismo agente, mismo estado y mismo `HEAD` dos veces seguidas → `STOP: AGENT_NO_PROGRESS` con el motivo. Lo invoca el orchestrator (permitido por `bash 01-TOOLS/*`). La comprobación es determinista, pero **que se invoque depende del prompt**: si la prueba real muestra que se salta, el siguiente paso es un parche de `next-step.sh` | `01-TOOLS/progress-check.sh`, `orchestrator.md` (documentar el STOP) | Depende: medir cuántas veces ocurre de verdad antes de decidir si basta con el script |
| R3a | El `risk.sh` de un job docs sale `NEEDS_HUMAN` por el accidente de `diff_vacio` (el diff excluye la base documental). Medido en la rama 6, no a propósito | Si `factory_job_kind` es `docs`: razón explícita `docs_requiere_humano` (y sin `diff_vacio`). Un job docs **nunca** es `FAST_PATH`, ni con `fast_path.enabled=true` | `01-TOOLS/risk.sh` (ya carga `lib.sh`) | Independiente |
| R3b | Los 4 reviewers están pensados para código («sin tests», «diff vacío») | Sección «si el job es `kind: docs`» en los cuatro prompts: qué revisar (coherencia entre documentos, trazabilidad, marcadores abiertos, ADR) y qué **no** pedir (tests, cobertura). Hasta ver sus veredictos reales no se sabe qué ruido hay que quitar | `.opencode/agent/reviewer-*.md` | Depende: se escribe con los informes de la prueba delante |
| R10 | Un job `init-*` creado antes de la rama 6 sigue siendo de código | Una línea en `docs/ONBOARDING.md`: borrar y recrear la worktree, o editar `kind` en `job.json` (acción del humano). No justifica código | `docs/ONBOARDING.md` | Independiente |

**Criterios de aceptación de la rama (cada uno con test y mutación, como todas):**
- R1: con un `origin` local y un segundo clon que fusiona un cambio en la base, un job abierto pasa de «sin aviso» a `STOP: BASE_DOCS_BEHIND` tras `sync-base.sh`. Sin remoto, el script avisa y no rompe nada.
- R2: dos delegaciones iguales sin cambio de `HEAD` paran el job; con un commit entre medias no. Un `HEAD` ilegible falla cerrado.
- R3a: con `fast_path.enabled=true`, un job docs da `NEEDS_HUMAN` con `docs_requiere_humano`; uno de código no cambia.
- La suite completa sigue en verde, con `FORCE_COLOR=0` y `=1`. Todos los STOP nuevos quedan en `orchestrator.md` (lo comprueba `pipeline-consistency`).

**Fuera de la rama 6b** (observado, no es de este tema): el test `launch-reviewers.test.mjs` («vigilante por inactividad», límite de 300 s) falló una vez bajo carga y aislado pasa. Si vuelve a salir se trata aparte.

## 3. Rama 6c — `job.json` en la evidencia protegida del guard (R6)

`job.json` ahora lleva `kind` y no está en `JOB_EVIDENCE_RE` de `factory/scripts/command-guard.mjs`. Cambiar `kind` **no** permite saltarse el gate (el gate docs falla con cualquier archivo fuera de la base y un job `code` sigue necesitando la aprobación humana del PR), así que el riesgo es bajo; aun así conviene cerrarlo.

- `command-guard.mjs` es solo-humano: la rama entrega `docs/propuestas/<rama>.patch` y su `.md` con la tabla de riesgos, y se verifica con `git apply --check` y aplicándolo en una worktree temporal. Los tests que dependan del parche se saltan con el motivo escrito, más un test «todo o nada».
- Cambio: añadir `job\.json` (y `progress\.log` si R2 lo guarda en el job) a `JOB_EVIDENCE_RE` y a su mensaje.
- **A comprobar con tests antes de proponerlo**: que `new-job.sh` y `init-project.sh` siguen creando `job.json` (el guard mira lo que escribe un agente, no lo que hace un script), y que **leer** `job.json` sigue permitido para `checks.sh`, `next-step.sh` y el orchestrator.

## 4. Prueba real previa a la rama 7

**Estado:** pendiente. La ejecuta el humano; ningún agente la ha hecho. Es la «prueba futura» de `docs/PRUEBAS-FABRICA.md` §10 llevada hasta `kind: docs`. Los pasos con `sudo`, `install-managed.sh --apply`, `onboard-project.sh --apply` o `/etc/opencode` son del humano.

**Objetivo:** medir lo que hasta ahora se supuso: (a) que un modelo real completa `/factory-init`, (b) que un job `docs` llega al STOP de aprobación, (c) cómo se portan los 4 reviewers con un diff solo de documentación, (d) si algún agente se queda sin cambiar nada, (e) que un job de código sigue igual tras la rama 6.

**Preparación (P0):**
1. Repo git **desechable** (no esta fábrica), con un commit en `main` y árbol limpio. Instalar con `install-into.sh` (`docs/PRUEBAS-FABRICA.md` §10 y `docs/ONBOARDING.md` §3). `fast_path` apagado y `FACTORY_LOW_RESOURCES=1`.
2. Anotar el modelo de cada tier (`factory/config.json`), para saber qué rol falló.
3. Antes de cada escenario, copiar `factory/jobs/<id>/`; al terminar, guardar también `factory/logs/blocked.log` y `git -C factory/worktrees/<id> log --oneline`.

| Esc. | Qué se hace | Señal de éxito | Si falla, es del ítem |
|---|---|---|---|
| P1 | `/factory-init` en modo arranque (proyecto nuevo), `discovery` con rondas de hasta 10 preguntas | Siete documentos creados, `project-lint check --strict` sin errores, y `next-step.sh` termina en `STOP: HUMAN_CONFIRM_PROJECT` con un `CMD` que empieza por `cd factory/worktrees/<id> &&` | Rama 4/6 (prompts, `init-project.sh`) |
| P2 | Aprobar la base con el `CMD` de ese STOP | `project.ok` en la **worktree** y no en `main`; los documentos pasan a `estado: aprobado`; el job continúa sin quedarse esperando | Corrección del `CMD` del 1c (rama 6) |
| P3 | Cambio de requisito por prompt (`/factory "<cambio>"`): D13 | El orchestrator crea un job con `kind: docs` (anotar qué `kind` elige: si crea uno de código, es un fallo del prompt de `/factory`); `system-analyst` escribe el spec y `spec-lint` lo acepta | Rama 6 (prompts) |
| P4 | Seguir ese job hasta el final: `HUMAN_CONFIRM_SPEC` (tú haces el `touch spec.ok`), dueños de los documentos, gate, reviewers, approver | `gate.md` `GATE: PASS` con la línea de alcance; reviews con `VERDICT:`/`SCORE:` válidos; STOP de aprobación (10b) con `approve <docs>` y, tras ejecutarlo, `DONE` o `STOP: HUMAN_CREATE_PR`; título del PR `docs: …` | R2, R3b, R3a |
| P5 | Un job de código normal con la base aprobada (regresión) | Mismos estados que antes de la rama 6; el spec lleva `Implementa:` y los IDs existen; `DONE` | Cualquier regresión: urgente, anterior a la 6b |
| P6 | `BASE_DOCS_BEHIND`: abrir un job de código, fusionar en la base un cambio de documentación, `git fetch` y relanzar | `STOP: BASE_DOCS_BEHIND` con `CMD: git -C factory/worktrees/<id> rebase <base>`; sin el `fetch` **no** aparece (confirma R1) | R1 |

**Qué anotar en cada escenario** (lo que decide la 6b):
- Número de delegaciones por agente y, entre dos iguales, si el `HEAD` de la worktree cambió (R2).
- Texto de las observaciones de cada `review-*.md` sobre el diff de documentación: qué piden, cuáles son ruido (R3b).
- Si `next-step.sh` dijo cada paso o el orchestrator hizo algo que no pidió (la «cuenta de acciones» de `docs/PRUEBAS-FABRICA.md` §9).
- El primer `STOP` inesperado, con el comando exacto. Un STOP sin motivo reconocible (`DOCS_JOB_INVALID`, `DOCS_NEED_HUMAN`) se guarda tal cual.
- Señales de falso verde: `round-1/` con la hora del orchestrator y no la de `launch-reviewers.sh`, `gate.md` sin `COMMIT:`, `job.json` con `created` redondo. Si aparecen, esa ejecución no cuenta.

**Qué se hace con lo observado:** cada hallazgo se convierte en un ítem de la tabla de §2 (o en un fallo de prompt a corregir), con la evidencia pegada. Un fallo de P5 (regresión de código) se arregla antes que cualquier otro.

## 5. Entrada a la rama 7 (ADR y guías)

La rama 7 se abre cuando: (1) P1–P6 se han ejecutado y sus resultados están anotados aquí, incluso los fallidos; (2) la 6b y la 6c están fusionadas o descartadas con su motivo; (3) los riesgos de la rama 6 tienen un estado (resuelto, aceptado o abierto) en el registro del plan.

Lo que debe recoger, para que no se escriba de memoria:
- **ADR-012** (Brain en la línea de `main`, alternativa descartada «rama paralela» con sus costes medidos con `grep` en ese momento): D1 de la especificación.
- **ADR-013** (base documental: formato, aprobación por hash, trazabilidad derivada). Debe añadir como consecuencias lo decidido después: D9 («la documentación manda»), el job `kind: docs` (D10), `approve` restringido a `factory/*` con `--bootstrap` (D11) y D13. Lo que la prueba real mida va como «consecuencias verificadas»; lo no medido, como «no verificado».
- **`docs/PRUEBAS-FABRICA.md`**: esta §4 se integra ahí como sección nueva, ya con los resultados.
- **`docs/ONBOARDING.md`** y `methodology.md`: el ciclo con el job de documentación y la línea de R10.
- **Propuesta para `AGENTS.md`** (solo-humano, va como parche): tres reglas candidatas: la base documental manda, `approve` solo desde la worktree de su job (con `--bootstrap` como excepción registrada) y «un cambio de requisito empieza en un job docs».

## 6. Lo que sigue sin resolverse

- Que un humano con acceso al repo use `--bootstrap` o edite `project.ok` a mano: la protección final es el PR y su revisión (§1.1 de la especificación).
- Que el paso opcional de CI (`docs-solo-desde-jobs`) funcione en un runner real de GitHub: se probó como script en repos temporales.
- Que un modelo real escriba un spec `docs` que pase `spec-lint` a la primera: la prueba P3 lo mide.
