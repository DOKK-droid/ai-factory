# Utilidad `clamp` — job de prueba del pipeline (`prueba-sencillo-completo-261105-a332`)

## Resumen

Job de prueba (smoke test) del pipeline de la AI Factory: recorrer de punta a punta intake → spec → build → reviews → decisión → entrega con un trabajo real pero mínimo. El entregable funcional es una utilidad `clamp(value, min, max)` que acota un número al rango `[min, max]`, con su test TDD. El valor del job era probar la máquina, no la utilidad. El humano confirmó el alcance con `spec.ok` (el input original no concretaba qué construir y el spec se propuso fail-closed). Entrada: tarea manual ("hace un job de prueba pequenio completo, algo sencillo"). PR: aún no creado (pendiente de push y PR en borrador).

## Actores

- **Humano**: dueño del producto; propuso el job de prueba, confirmó el alcance con `spec.ok`, aprueba reviews y fusionará el PR.
- **Orchestrator**: ejecutó el bucle `next-step.sh` para recorrer las fases del pipeline.
- **`@builder`**: implementó `clamp` con TDD en la worktree del job.
- **Reviewers (security, ux, ui, code)**: revisaron el diff real; con `Surface: none`, ux y ui devolvieron `PASS (n/a)` pero se lanzaron los 4.
- **`@approver`**: consolidó los 4 reviews y decidió APPROVE.
- **Scripts de la factory** (`checks.sh`, `launch-reviewers.sh`, `risk.sh`): verificación determinista y evidencia.

## Requisitos funcionales

- **RF-1**: exportar `clamp(value, min, max)` que devuelva `value` acotado al rango `[min, max]`. Cubierto por los criterios 1-2 y los tests `RF-1: ...` de `tests/clamp.test.mjs` (3 casos: dentro del rango, acota por debajo de `min`, acota por encima de `max`).
- **RF-2**: si `min > max`, `clamp` lanza `RangeError` con mensaje descriptivo. Cubierto por el criterio 3 y el test `RF-2: clamp lanza RangeError cuando min > max` (`assert.throws` con `RangeError` y mensaje).
- **RF-3**: verificar el comportamiento con un test automatizado que falle antes de la implementación (TDD) y pase después. Cubierto por el criterio 4: el test existió en rojo (commit `2f633aa`, `ERR_MODULE_NOT_FOUND` para `src/clamp.js`) antes del código (commit `6f44ee0`), y el gate ejecutó la suite en verde. Salvedad del approver: la cobertura de RF-3 se apoya en el gate y no en un test cuyo título cite `RF-3` (ver Pruebas y Lecciones).

## Diseño

- **Componente único**: módulo ES `src/clamp.js` que exporta la función `clamp`.
- **Firma**: `clamp(value: number, min: number, max: number) -> number`; `value < min` → `min`; `value > max` → `max`; dentro del rango → `value`; `min > max` → `RangeError` (decisión del spec: fallar alto en vez de devolver un valor silenciosamente confuso).
- **Test**: `tests/clamp.test.mjs` con el runner nativo de Node (`node:test`), mismo patrón que el resto del repo.
- **Alternativas descartadas en el spec**: `suma(a, b)` (sin caso borde interesante) y utilidades con I/O (agrandarían el diff de un job de prueba).
- **Sin ADR**: el spec declara `ADR: none`; no se tomó ninguna decisión de arquitectura ni de política.

## Implementación

Commits de la rama `factory/prueba-sencillo-completo-261105-a332` (desde la base `52f479b`, `fix(factory): ajustes de las pruebas en vivo (#18)`):

- `2f633aa` — `test: añade casos TDD para clamp` → `tests/clamp.test.mjs` (T1, test en rojo).
- `6f44ee0` — `feat: implementa clamp` → `src/clamp.js` (T2/T3, implementación con `Math.min`/`Math.max` y `RangeError` si `min > max`).
- `fec7a42` — `test: limita paralelismo del vigilante de reviewers` → `tests/launch-reviewers.test.mjs` (1 línea).
- `62b3e15` — `revert: restore reviewer test` → `tests/launch-reviewers.test.mjs` (revierte la línea anterior; el diff neto vs la base queda en los 2 archivos del alcance).

Diff neto vs `52f479b`: `src/clamp.js` (+7) y `tests/clamp.test.mjs` (+22), exactamente el `Alcance:` del spec.

## Pruebas

Gate (`gate.md`): `GATE: PASS` sobre el commit `62b3e15` (`COMMIT: 62b3e1516b342ca0b82a6632986eb49b11ecc7ae`), `GATE_FAIL_STREAK: 0`.

- Comando: `npm test --silent`. Resultado: `tests 481`, `pass 481`, `fail 0` (`OK (tests)`).
- Tests cambiados (`node:test`): `tests/clamp.test.mjs` — `OK: 4 casos ejecutados de los archivos cambiados`.
- Alcance: OK (2 archivos vs `52f479b`); sintaxis: OK; lint y typecheck: omitidos (sin configuración de eslint ni `tsconfig.json`).

Reviews (ronda 1), veredicto y score copiados de `round-1/review-*.md`:

| Revisor | Veredicto | Score |
|---|---|---|
| security | PASS | 1 |
| ux | PASS (n/a) | 1.0 |
| ui | PASS (n/a) | 1.0 |
| code | PASS | 0.92 |

- `decision.md`: `APPROVE` (score medio 0.98, mínimo 0.92, sin desacuerdos; 4 hallazgos informativos no bloqueantes).
- `human.md`: `NEEDS_HUMAN` (fast_path desactivado, ADR-003; 0 riesgos detectados por risk.sh). Requiere revisión humana antes del merge.
- No verificado: la existencia de un test cuyo título cite `RF-3` (el approver no pudo confirmarlo; los tests con RF citado son RF-1 y RF-2).

## Lecciones

- El pipeline funcionó de punta a punta con fail-closed en la ambigüedad: el input no concretaba qué construir, el spec lo propuso y el humano lo confirmó con `spec.ok` antes de escribir código (RF-F3).
- El orden de commits del TDD (rojo `2f633aa` antes que verde `6f44ee0`) quedó registrado en `build.md`, pero ni el gate ni el diff acumulado aportan evidencia directa del orden (hallazgo informativo de review-code). Sugerencia recogida por el approver: que `checks.sh` registre el hash del commit del test y el del código cuando esa regla entre en el alcance del gate.
- Casos no especificados que conviene decidir en specs futuros: comportamiento de `clamp(NaN, min, max)` (devuelve `NaN`, `src/clamp.js:5`) y idioma de los mensajes de error (inglés, `src/clamp.js:2`, coherente con el regex del test).
- Los commits intermedios `fec7a42`/`62b3e15` tocaron un archivo fuera del alcance y se revertieron; el gate mide el diff neto vs la base, que quedó dentro del `Alcance:`.
