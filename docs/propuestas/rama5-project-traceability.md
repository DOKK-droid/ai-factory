# Propuesta de la rama 5: parche a archivos protegidos

`01-TOOLS/next-step.sh` y `factory/scripts/command-guard.mjs` los edita solo el humano. La rama no los modifica: el cambio se entrega en [`rama5-project-traceability.patch`](rama5-project-traceability.patch) (100 líneas, 2 archivos).

## Cómo aplicarlo y comprobarlo

```
git switch feat/project-traceability
git apply --check docs/propuestas/rama5-project-traceability.patch   # no escribe nada; debe salir 0
git apply docs/propuestas/rama5-project-traceability.patch
FORCE_COLOR=0 node --test tests/*.test.mjs
FORCE_COLOR=1 node --test tests/*.test.mjs
git add -- 01-TOOLS/next-step.sh factory/scripts/command-guard.mjs
git commit -m "feat(factory): next-step realinea el spec con la base documental e implementa.lock queda protegido"
```

Hasta que lo apliques, los tests de `tests/traceability-patch.test.mjs` salen como «saltados: falta aplicar el parche» (no como verdes) y otro test falla si el parche está a medias. Para deshacerlo: `git apply --reverse docs/propuestas/rama5-project-traceability.patch`.

## Qué cambia

| Archivo | Cambio | Por qué es seguro |
|---|---|---|
| `next-step.sh`, comentarios | documenta que `implementa.lock` no es una marca del humano | solo comentarios |
| `next-step.sh`, `phase()` | el estado nuevo `align` es de la fase «Análisis y diseño» | un estado que `phase()` no conoce daba fase vacía |
| `next-step.sh`, **bloque 3b** (entre el 3 y el 4) | llama a `project-lint.mjs realign` y traduce la primera palabra de su respuesta | solo se ejecuta con `require_spec_ok`; sin IDs en el spec responde `NONE` y no hace nada |
| `next-step.sh`, **estado 5** (gate) | si `implementa.lock` es más nuevo que `gate.md`, se repite `checks.sh` | el primer lock nace antes que el primer gate, así que no cambia nada en el flujo normal |
| `next-step.sh`, **estado 7** (reviews) | si `implementa.lock` es más nuevo que `round-N/.commit`, se lanza la ronda N+1 | acotado por `max_rounds`: si no quedan rondas, `STOP: MAX_ROUNDS` y decide el humano |
| `next-step.sh`, `brain_problem` | en el perfil `full`, `spec-lint.mjs page` exige que la página del job lleve `Implementa:` con la unión exacta de los IDs del spec | si el spec no cita IDs de la base, no exige nada; una caída de node es un problema, no un OK |
| `command-guard.mjs` | `implementa.lock` entra en `JOB_EVIDENCE_RE`, como `gate.md` y `spec.ok` | un agente no puede escribirlo ni borrarlo; `stamp` y `realign` siguen siendo ejecutables |

El bloque 3b, línea a línea de significado (toda la lógica vive en `project-lint.mjs` y se prueba allí):

| Respuesta de `realign` | Qué hace `next-step.sh` |
|---|---|
| `NONE` u `OK` | sigue el flujo |
| `STAMP` | `RUN: node factory/scripts/project-lint.mjs stamp <job>` (el humano acaba de confirmar el spec y aún no está ligado) |
| `DRIFT` | `DELEGATE: @spec-writer` con los IDs afectados; el spec-writer modifica `spec.md`, eso lo deja más nuevo que `spec.ok`, y el estado 3 vuelve a pedir `HUMAN_CONFIRM_SPEC` |
| `INVALID` o **cualquier otra cosa, vacía o con error de node** | `STOP: IMPLEMENTA_INVALID` |

## Un spec realineado repite el flujo (decisión B)

Tras un `DRIFT`, cuando el humano reconfirma el spec y `stamp` escribe un lock nuevo, el gate, los reviews y la decisión anteriores son de un spec que ya no existe. Como `next-step.sh` es de solo lectura, no se borra nada: el lock más nuevo que `gate.md` y que `round-N/.commit` los deja obsoletos, y la cadena de fechas ya existente (`decision.md` más nueva que los reviews, `human.md` más nuevo que la decisión, `trace.md` más nuevo que `human.md`) repite el resto. El flujo es: `checks.sh` → los 4 reviewers (ronda N+1) → approver → decisión, que sigue siendo del approver: `CHANGES` devuelve el job al builder (que reformula tests y código), `ESCALATE` lo para para el humano, `APPROVE` sigue a push y PR. Cada pasada consume una ronda de `max_rounds`.

Efecto lateral que conviene saber: cualquier reconfirmación del spec con IDs de la base (no solo las causadas por un cambio de la base) invalida lo anterior, porque vuelve a escribir el lock.

## Por qué no hay una orden de «borrar spec.ok»

La especificación (§12) decía que `next-step.sh` «borra la confirmación pendiente». Pero `next-step.sh` es de solo lectura por diseño. La invalidación sale de las marcas de tiempo que ya usa el estado 3: el spec-writer modifica `spec.md`, que queda más nuevo que `spec.ok`, y el humano tiene que confirmar de nuevo. Y `stamp` solo escribe `implementa.lock` si `spec.ok` es más nuevo que el lock anterior, así que ningún agente puede «ponerse al día» sin esa confirmación.

## Riesgos que conozco

| Riesgo | Estado |
|---|---|
| si el spec-writer decide que no hay nada que cambiar y **no toca** `spec.md`, el bloque 3b vuelve a delegarle en cada llamada | el prompt le obliga a modificar `spec.md` aunque sea con una nota; el humano que ve el bucle puede hacer `touch spec.ok` y `stamp` re-liga el lock (decisión humana) |
| tras un `DRIFT` el código ya escrito puede no cumplir el requisito nuevo | cerrado con la decisión B: se repiten gate, reviews y approver, y el approver decide si vuelve al builder. No se fuerza un paso del builder antes: los tests no cambian hasta que el approver pida `CHANGES` |
| `APPROVE_RE` del guard (`project-lint … approve`) también calza un id de job que contenga la palabra `approve` (p. ej. `stamp approve-flow-261105-ab12`) | falso positivo, hacia el lado seguro: el comando se bloquea y habría que ejecutarlo a mano |
| la realineación va atada a `spec.ok`: con `require_spec_ok: false` no hay confirmación a la que ligar y el bloque 3b no hace nada | por diseño (RF-I18); el control queda en el PR |
| el lock liga el spec a los bloques de la **worktree** del job, no a `main` (punto abierto (b) de la especificación) | lo cierra la rama 6 |
