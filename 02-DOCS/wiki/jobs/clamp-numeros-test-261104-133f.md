# Función clamp(n, min, max) con test node:test (`clamp-numeros-test-261104-133f`)

## Resumen

Se creó la utilidad numérica `clamp(n, min, max)` en `src/clamp.js`, que limita un número dentro del rango `[min, max]`, junto con su test unitario en `tests/clamp.test.mjs` usando el runner nativo `node:test`. Trabajo acotado y sin superficie de usuario (`Surface: none`), pensado como función reutilizable para futuras necesidades de acotar valores (por ejemplo, límites de paginación o de tasa). Entrada manual del humano (ver `factory/jobs/clamp-numeros-test-261104-133f/input.md`).

## Actores

Copiados del spec:

- **Humano** (dueño del producto): pidió la tarea manualmente; aprueba el spec (`spec.ok`) y revisa el PR.
- **Builder** (`@builder`): implementa con TDD en la worktree `src/clamp.js` y `tests/clamp.test.mjs`.
- **Reviewers** (security, ux, ui, code): revisan el diff real; con `Surface: none`, ux y ui devuelven `PASS (n/a)` (ADR-002).
- **Sistema de tests (node:test)**: runner nativo de Node.js que ejecuta `tests/clamp.test.mjs` y determina PASS/FAIL en el gate.
- **Código consumidor futuro**: cualquier módulo del proyecto que importe `clamp` de `src/clamp.js`.

## Requisitos funcionales

Copiados del spec, con su cobertura según la evidencia del gate y los reviews:

- **RF-1**: exportar `clamp(n, min, max)` desde `src/clamp.js` que devuelva `n` cuando `min ≤ n ≤ max`. Cubierto por los criterios 1 y 4 del spec y los tests `RF-1: devuelve n cuando está dentro del rango`, `RF-1: exporta una función invocable` (en verde en el gate).
- **RF-2**: devolver `min` cuando `n < min`. Cubierto por el criterio 2 y el test `RF-2: acota por debajo de min` (en verde en el gate).
- **RF-3**: devolver `max` cuando `n > max`. Cubierto por el criterio 3 y el test `RF-3: acota por encima de max` (en verde en el gate).
- **RF-4**: test automatizado en `tests/clamp.test.mjs` con `node:test` (import ESM), ejecutable sin dependencias externas. Cubierto por los criterios 5 y 6; el gate ejecuta `node --test tests/clamp.test.mjs` con 6/6 tests en verde y títulos que citan los RF.

Casos ambiguos (`min > max`, `NaN`, `Infinity`, argumentos no numéricos): fuera de alcance por diseño del spec (fail-closed); los tests no los cubren y no se inventó política.

## Diseño

- Solo se crean dos archivos: `src/clamp.js` (exporta `clamp(n, min, max)`) y `tests/clamp.test.mjs` (`node:test` + `node:assert`).
- Firma `clamp(n, min, max) → number`; comportamiento definido solo para el caso bien definido: `n` si `min ≤ n ≤ max`, `min` si `n < min`, `max` si `n > max`.
- Alternativas descartadas en el spec: librería externa (lodash `clamp`) — añade dependencia para una función trivial; validación de argumentos con errores — el humano no definió esa política y ampliaría el alcance.
- TDD obligatorio: test en rojo primero, luego implementación mínima en verde (RF-F4 de la metodología).
- Sin ADR: el spec declara `ADR: none` (no hay decisión de arquitectura que registrar en `02-DOCS/wiki/sdd/decisions.md`).

## Implementación

Commits tomados del `git log` de la worktree (base `4213ead`, según `gate.md`):

| Commit | Mensaje | Contenido |
|---|---|---|
| `905fc5c` | `test: cover clamp behavior` | `tests/clamp.test.mjs` (test primero, TDD) |
| `4c50d00` | `feat: add clamp utility` | `src/clamp.js` (implementación mínima) |

Archivos creados: `src/clamp.js` (implementación ESM de `clamp`) y `tests/clamp.test.mjs` (6 tests con `node:test`/`node:assert`, títulos citando RF-1/RF-2/RF-3). El diff toca solo esos dos archivos, que coinciden con el `Alcance:` del spec (confirmado por `gate.md`: "alcance: OK" y por los reviews de security, ui y code).

Nota sobre el orden TDD (criterio 6): el approver lo dejó como pendiente no bloqueante porque la consulta de historial git le fue bloqueada por permisos (`decision.md`, hallazgo 2 de code). El `git log` de la worktree muestra el commit del test (`905fc5c`) antes que el commit del código (`4c50d00`), lo que es consistente con rojo→verde; la confirmación final queda en el checklist del humano en `human.md`.

## Pruebas

Gate (`gate.md`): `GATE: PASS` sobre el commit `4c50d00` (`COMMIT: 4c50d0082ad452cb53b88a52f7080bd1fb454b9e`). Comando: `bash -c node --test tests/clamp.test.mjs`. Resultado literal: `ℹ tests 6`, `ℹ pass 6`, `ℹ fail 0`; `OK (tests)`; `OK: 6 casos ejecutados de los archivos cambiados`. Sin `UNVERIFIED_TESTS`. Alcance y sintaxis: OK; lint y typecheck omitidos (sin configuración de eslint ni tsconfig.json).

Reviews (ronda 1), veredicto y score literales de `round-1/review-*.md`:

- security: `VERDICT: PASS` / `SCORE: 1` — sin hallazgos de seguridad; sin secretos, sinks, dependencias ni superficie de ataque.
- ux: `VERDICT: PASS (n/a)` / `SCORE: 1.0` — n/a por `Surface: none` (ADR-002); trazabilidad RF completa.
- ui: `VERDICT: PASS (n/a)` / `SCORE: 1` — n/a por `Surface: none` (ADR-002); sin hallazgos bloqueantes.
- code: `VERDICT: PASS` / `SCORE: 0.9` — hallazgos no bloqueantes: (1) baja, `export` ESM en `.js` requiere `"type": "module"` en el `package.json` más cercano (el gate en verde lo confirma empíricamente para este repo); (2) baja, criterio 6 (orden TDD) no verificable desde la evidencia del review; (3) informativa, `clamp(5, 10, 0)` devuelve `0` con `min > max`, caso fuera de alcance y fail-closed según el spec.

Decisión del approver (`decision.md`): `APPROVE` (scores 1, 1.0, 1, 0.9; media 0.98; sin desacuerdos). Decisión del human-gate (`human.md`): `NEEDS_HUMAN` — por la regla "ante la duda, NEEDS_HUMAN", por el pendiente del orden TDD; `risk.sh` no detectó riesgos. El merge requiere revisión humana (ADR-003: fast_path desactivado).

## Lecciones

- **El gate atado al commit funciona**: `gate.md` registra `COMMIT` y 6/6 tests, y los 4 reviews citan ese mismo commit; la trazabilidad RF → criterio → test → título del test se verificó sin ambigüedad.
- **Pendiente de proceso visible para el humano**: el approver no pudo consultar el historial git (permisos) y dejó el criterio 6 (orden TDD) como pendiente explícito en lugar de afirmarlo sin evidencia — correcto según la regla de evidencia no fabricada. El `git log` de la worktree (accesible para el curator) muestra el test antes que el código; conviene dar al approver acceso de lectura a `git log` o registrar el orden en `build.md` para que no quede pendiente en futuros jobs.
- **Casos ambiguos fuera de alcance, sin política inventada**: `min > max`, `NaN` e `Infinity` no tienen comportamiento definido ni tests; el review de code documentó el comportamiento real (`clamp(5, 10, 0)` → `0`) como informativa. Si el uso real los necesita, abrir un job nuevo con política explícita del humano (queda como decisión opcional en `decision.md`).
- **ESM en `.js`**: `src/clamp.js` usa `export` ESM, válido porque el `package.json` del repo declara `"type": "module"` (confirmado empíricamente por el gate en verde, hallazgo de code). Si la función se reutiliza fuera de este proyecto, revisar el sistema de módulos (riesgo ya anticipado en el spec).
