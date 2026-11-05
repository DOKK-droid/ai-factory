# Decisiones de la AI Factory

Registro de decisiones arquitectónicas (ADR) de la AI Software Factory sobre OpenCode + RSC Harness.

## ADR-001: Mapeo de modelos (tiers → OpenCode gratuitos)

Fecha: 2026-10-29
Estado: Reemplazado por ADR-010 (los tiers y roles de esta tabla ya no coinciden con `factory/config.json`)

### Contexto
La factory usa 4 tiers (opus, sonnet, sol, astra) para decorrelacionar errores entre builder y revisores. Cada tier se mapea a un modelo gratuito de OpenCode.

### Decisión

| Tier | Modelo OpenCode | Roles | Razón |
|------|----------------|-------|-------|
| opus | `opencode/nemotron-3.5-super-vl-free` | spec-writer, builder, orchestrator | Mejor razonamiento/código gratuito para roles críticos |
| sonnet | `opencode/deepseek-v4.1-flash-free` | approver, human-gate, memory-curator, intake, reviewer-code | Otra familia (DeepSeek vs NVIDIA), decorrelaciona errores |
| sol | `opencode/glm-5.3-flash-free` | reviewer-security, reviewer-ux | Tercera familia (Zhipu/GLM) |
| astra | `opencode/mimo-v2.6-flash-free` | reviewer-ui | Cuarta familia (Mimo) |

### Alternativas consideradas
- Usar nemotron para todo: Rechazado. El approver sería del mismo modelo que el builder, tiende a aprobar sus propios errores.
- Usar solo deepseek para todo: Rechazado. No hay decorrelación de familias de modelos.

### Consecuencias
- El approver y human-gate usan deepseek (otra familia que el builder) para detección independiente de errores.
- Los 4 revisores usan 3 familias distintas (deepseek, glm, mimo) para decorrelacionar.
- fallback: todos los tiers caen a deepseek-v4.1-flash-free si el modelo principal falla.

## ADR-002: Protocolo de veredictos por archivos

Fecha: 2026-10-29
Estado: Aprobado

### Contexto
Cada etapa del pipeline debe dejar un veredicto claro y parseable en la primera línea de su archivo de salida.

### Decisión

| Archivo | Primera línea | Valores válidos |
|---------|--------------|-----------------|
| `round-N/review-<x>.md` | `VERDICT:` | `PASS`, `CHANGES`, `PASS (n/a)` |
| `decision.md` | `APPROVE` / `CHANGES` / `ESCALATE` | `APPROVE`, `CHANGES`, `ESCALATE` |
| `human.md` | `FAST_PATH` / `NEEDS_HUMAN` | `FAST_PATH`, `NEEDS_HUMAN` |
| `job.json` | `status` | `intake_done`, `spec_done`, `build_done`, `gate_done`, `review_complete`, `decision_done`, `human_done`, `complete` |

### Reglas
- Cualquier valor ambiguo se trata como `CHANGES` / `ESCALATE` / `NEEDS_HUMAN` (lado seguro).
- Si `Surface: none`, reviewer-ux y reviewer-ui devuelven `PASS (n/a)` pero siempre se lanzan los 4.
- Los 4 reviewers se lanzan en paralelo.
- Cualquier review con `CHANGES` devuelve al builder (bucle, máx. `max_rounds`).

## ADR-003: Fast path desactivado

Fecha: 2026-10-29
Estado: Aprobado

### Contexto
El video muestra un "camino rápido" donde el código va directo a main. En esta implementación está desactivado por defecto.

### Decisión

- `fast_path.enabled = false` en `factory/config.json`
- Por defecto, todo trabajo requiere `human.md` con revisión humana antes de merge.
- El camino rápido solo se habilita después de varias semanas de operación exitosa y solo con branch protection en GitHub.

### Alternativas consideradas
- Habilitar fast path desde el inicio: Rechazado. Riesgo de merge sin revisión humana en una factory nueva.

### Consecuencias
- Todo PR se deja en borrador (`gh pr create --draft`) hasta aprobación humana.
- `ship-guard.sh` bloquea merge si no existe `human.md` con `FAST_PATH`.

## ADR-004: Skills en una sola copia y modelo del approver provisional

Fecha: 2026-10-30
Estado: Reemplazado por ADR-011 (la premisa de que `03-SKILLS/` era la ruta que carga OpenCode era falsa; el modelo del approver ya lo reemplazó ADR-010)

### Contexto
`code-review`, `receiving-code-review` y `test-driven-development` existían dos veces: versión completa en `.agents/skills/` y versión resumida en `03-SKILLS/`. Dos copias con el mismo nombre confunden qué se carga y gastan contexto. Además, la configuración de la factory movió `approver` y `human-gate` a `sonnet` (deepseek) para decorrelacionar, pero `reviewer-code` usa el mismo modelo y el A/B que lo justificaría (paso 7 de PATCH_INSTRUCCIONES) aún no se ha ejecutado.

### Prueba en vivo
Se inspeccionó desde qué ruta carga OpenCode las skills. Todas las referencias del repo (configs de agente, `tests/factory-smoke-test.sh`, README, `03-SKILLS/orient/SKILL.md`) apuntan a `03-SKILLS/`. `.agents/skills/` no está referenciado en ningún lado y `~/.config/opencode/skills/` solo tiene `chord-detection-accuracy` (no relacionado). Conclusión: `03-SKILLS/` es el directorio canónico.

### Decisión
- Se conserva una sola copia de cada skill en `03-SKILLS/` (canónica, con metadatos de factory: `tags`, `recommends`, `profiles`, `origin`).
- Se borran las duplicadas de `.agents/skills/`: `code-review`, `receiving-code-review`, `test-driven-development`.
- Se conserva `.agents/skills/differential-review` (no está duplicado; sí referenciado en `skills-lock.json`, reviewer-security y orient).
- Se borra la carpeta vacía con typo `03-SILLS/`.
- Se borra `patch-refactor/` (idéntica a `PATCH_INSTRUCCIONES.md`).
- Modelo del approver: `approver = sonnet` (deepseek-v4.1), `human-gate = sonnet` (deepseek-v4.1), `reviewer-code = opus` (nemotron). Familias distintas: decorrelación real. `fast_path` permanece desactivado hasta validar con A/B.

### Alternativas consideradas
- Mantener ambas copias: Rechazado. Duplicidad de nombre y contexto.
- Elegir `.agents/skills/` como canónica: Rechazado. Ninguna referencia del repo apunta allí; rompería configs de agente y smoke test.

### Consecuencias
- Un solo origen de verdad para skills: `03-SKILLS/`.
- La elección final del modelo del approver queda pendiente del A/B; si ningún modelo gratuito cumple los criterios, se usa el mejor disponible y `fast_path` se deja apagado.

## ADR-005: Corrección de modelos gratuitos y asignación de roles

Fecha: 2026-10-30
Estado: Reemplazado por ADR-010 (los IDs vigentes se validan con `factory/scripts/validate-models.mjs` y la asignación de roles cambió)

### Contexto
El tier `sonnet` apuntaba a `opencode/deepseek-v4-flash-free`, un modelo que **no existe** en OpenCode (sugiere `deepseek-v4.1-flash-free`). Como consecuencia, reviewer-code, approver, human-gate, memory-curator e intake no podían responder ("Model not found"). Además, reviewer-code y approver compartían el mismo modelo, rompiendo la decorrelación de errores que justifica el A/B del paso 7.

### Prueba de campo
Se invocó a cada modelo gratuito disponible y se le pidió autoevaluarse del 1 al 10 por rol de la fábrica:

| Rol | nemotron (opus) | deepseek-v4.1 (candidato sonnet) | glm (sol) | mimo (astra) |
|-----|----------------|----------------------------------|-----------|--------------|
| spec-writer | 8 | 8 | **10** | 9 |
| builder | **9** | **9** | 7 | 8 |
| reviewer-code | **9** | **9** | 9 | 8 |
| reviewer-security | 7 | 7 | 7 | 7 |
| reviewer-ux | 6 | 5 | **7** | 6 |
| reviewer-ui | 6 | 5 | **7** | 5 |
| approver | 7 | 8 | **9** | 7 |
| intake | 8 | 8 | 8 | **9** |
| memory-curator | 7 | 7 | 8 | 8 |

Datos web corroboran: nemotron = mejor razonamiento/código; deepseek-v4.1 = codificación óptima + cero retención; glm = equilibrio máximo y documentación; mimo = omnimodal/agente.

### Decisión
- Corregir tier `sonnet`: `opencode/deepseek-v4-flash-free` → `opencode/deepseek-v4.1-flash-free` (modelo que existe).
- `reviewer-code` pasa a **opus** (nemotron) y `approver` se queda en **sonnet** (deepseek-v4.1): familias distintas, decorrelación real.
- `spec-writer` pasa a **sol** (glm, 10 en spec-writer).
- `reviewer-ui` pasa a **sol** (glm, 7 vs 5 de mimo).
- `intake` pasa a **astra** (mimo, 9 en intake).
- `memory-curator` pasa a **sol** (glm, 8).

### Nuevos roles por tier
| Tier | Modelo | Roles |
|------|--------|-------|
| opus | `opencode/nemotron-3.5-super-vl-free` | builder, orchestrator, reviewer-code |
| sonnet | `opencode/deepseek-v4.1-flash-free` | approver, human-gate, reviewer-security, intake |
| sol | `opencode/glm-5.3-flash-free` | spec-writer, reviewer-ux, reviewer-ui, memory-curator |
| astra | `opencode/mimo-v2.6-flash-free` | (respaldo intake, memory-curator) |

### Acción requerida (humano)
`factory/config.json` ya actualizado (sonnet → deepseek-v4.1-flash-free, reviewer-code → opus, spec-writer → sol, etc.). Ejecutar `npm run factory:apply-models` y `npm test`, y finalmente el A/B del paso 7 para validar el approver.

### Alternativas consideradas
- Mantener `deepseek-v4-flash-free`: Rechazado. Modelo inexistente, agentes no responden.
- Mantener reviewer-code y approver en el mismo modelo: Rechazado. Rompe la decorrelación de errores.

### Consecuencias
- Todos los agentes de la factory responden (ningún modelo inexistente).
- El approver puede validar independientemente las reviews de reviewer-code (modelo distinto).
- `fast_path` sigue desactivado hasta que el A/B valide al approver.

## ADR-006: Resultado A/B del approver (paso 7)

Fecha: 2026-10-30
Estado: Aprobado (A/B repetido el 2026-11-05 con el fixture corregido; el approver vigente, `opencode-go/claude-haiku-5-5`, cumple el criterio; ver "Repetición")

### Contexto
Se ejecutó `tests/ab/run-ab.mjs --mode approver --runs 5` con 4 modelos gratuitos contra dos ramas: `cand-flawed` (3 fallos intencionados) y `cand-clean` (debería aprobarse).

### Resultados
| Modelo | flawed (no aprueba) | clean (aprueba) | fallos detectados (de 3, media) | formato línea 1 |
|--------|-------------------|-----------------|---------------------------------|-----------------|
| nemotron-3.5-super-vl-free | 5/5 OK | 0/5 (fixture no es limpio) | 2.0 | 100 % |
| deepseek-v4.1-flash-free | 5/5 OK | 0/5 (fixture no es limpio) | 2.0 | 100 % |
| glm-5.3-flash-free | 5/5 OK | 0/5 (fixture no es limpio) | 2.4 | 100 % |
| mimo-v2.6-flash-free | 5/5 OK | 0/5 (fixture no es limpio) | 2.4 | 80 % (2 UNKNOWN) |

### Hallazgo
El fixture `cand-clean` **no implementa el spec** (solo añade `format.js` con tests triviales; no hay rate limit, consultas parametrizadas ni búsqueda por email). Los modelos rechazan correctamente porque el diff no cumple el spec. Los modelos funcionan bien; el problema es el fixture.

### Decisión original (2026-10-30; superada por "Decisión vigente" al final de este ADR)
- Usar `deepseek-v4.1-flash-free` como approver (ya configurado en tier `sonnet`).
- Familia distinta al builder (nemotron/opus): decorrelación real ✅
- `fast_path` permanece desactivado (ningún modelo aprueba clean ≥ 80 % debido al fixture defectuoso).
- No se "arregla" con prompts (regla del paso 7 punto 7).

### Acción original (2026-10-30; histórico)
- `factory/config.json` ya actualizado (sonnet → deepseek-v4.1-flash-free, reviewer-code → opus, spec-writer → sol, etc.).
- `npm test` → 140 tests OK.
- Pendiente: ejecutar `npm run factory:apply-models` y completar el A/B con glm y mimo si se desea mayor confianza.
- **Nota (parche 4):** Los resultados del A/B anteriores se obtuvieron con el guard roto (todos UNKNOWN). Con el parche 4 aplicado, reejecutar tests/ab/run-ab.mjs --mode approver --runs 5 para obtener datos validos.

### Repetición (2026-11-05, fixture corregido)

Ejecutada por el humano: `AB_TIMEOUT_MIN=60 node tests/ab/run-ab.mjs --models opencode-go/claude-haiku-5-5,opencode/glm-5.3-flash-free,opencode/nemotron-3.5-super-vl-free --mode approver --runs 5` (3 modelos × 2 ramas × 5 repeticiones = 30 ejecuciones).

Fixture (`tests/ab/make-fixture.sh`): `cand-clean` implementa `remainingAttempts` y pasa sus 5 tests; `cand-flawed` también implementa lo pedido, pasa sus propios tests y trae 3 fallos plantados: `isBlocked` cambia de `>=` a `>` (regresión), inyección SQL por concatenación y un test tautológico. Los 4 reviews que recibe el approver son simulados (`PASS 0.92`), así que mide si verifica el diff por sí mismo.

| Modelo | rama defectuosa no aprobada | rama limpia aprobada | fallos detectados (de 3) | sin formato |
|---|---|---|---|---|
| `opencode-go/claude-haiku-5-5` (vigente, ADR-010) | 5/5 | 5/5 | 3.0 | 0 |
| `opencode/glm-5.3-flash-free` | 4/5 | 4/5 | 3.0 | 1 |
| `opencode/nemotron-3.5-super-vl-free` (control) | 5/5 | 5/5 | 3.0 | 0 |

- **Puntuador.** La primera salida mostró "2.0 de 3" en los tres: el puntuador no reconocía cómo describen los modelos el cambio de `isBlocked` ("`>=` pasa a `>`"). Revisados los textos crudos, los tres lo señalan en las 5 respuestas defectuosas. Se corrigió `tests/ab/score.mjs` (con tests) y se volvieron a puntuar las 30 respuestas ya obtenidas, sin gastar más cuota: 3.0 en todos.
- **Ninguna aprobación errónea.** En las 15 ejecuciones sobre la rama defectuosa ningún modelo dio `APPROVE`. Los dos fallos de glm son del lado seguro: una respuesta empezó por `CAMBIOS` en vez de `CHANGES` (`validate-artifacts.sh` exige el formato exacto, así que en producción terminaría en `STOP: DECISION_INVALID`) y otra rechazó la rama limpia por "no verificable como auténtica".
- **Tipo de rechazo.** `claude-haiku-5-5` respondió `ESCALATE` en 4 de 5 (y `CHANGES` en 1); glm y nemotron respondieron `CHANGES`. `ESCALATE` detiene el job para un humano (`STOP: ESCALATED`) en vez de devolverlo al builder.
- **Límites.** Solo 5 repeticiones por celda: 5/5 frente a 4/5 no es una diferencia significativa. Esta prueba no distingue a `claude-haiku-5-5` (de pago) de `nemotron` (gratuito): ambos 10/10. Los reviews son simulados y hay un único caso defectuoso.

### Decisión vigente
El approver es `opencode-go/claude-haiku-5-5` (ADR-010): cumple el criterio (rama defectuosa rechazada 5/5, limpia aprobada 5/5, formato sin errores). `glm-5.3-flash-free` queda como reviewer, no como approver: tuvo un fallo de formato. `fast_path` sigue desactivado (ADR-003): este resultado valida al approver, no habilita la vía rápida, que es otra decisión.

## Paso 6: Verificación en vivo — pendiente
## ADR-007: Lanzamiento robusto de los 4 revisores en paralelo
Fecha: 2026-10-30
Estado: Reemplazado por el parche 5 (launch-reviewers.sh reescrito)

### Contexto
El punto 4 del pipeline exige lanzar los 4 revisores (security, ux, ui, code) en paralelo.
Sin embargo, las invocaciones vía opencode run pueden colgarse (timeout, modelo no responde, procesos zombies).
Además, --pure --auto es necesario para evitar prompts interactivos que bloqueen la ejecución sin interfaz.
**Nota (parche 4):** El guard de la factory fue corregido (factory-fixes-4.patch): los heredocs se tratan como datos, las herramientas write/edit/patch se evalúan por ruta de destino (no por contenido), y las variables de entorno solo se bloquean cuando se listan sin argumentos. Esto reduce los bloqueos falsos, pero --pure --auto sigue siendo buena practica en CI sin interfaz.

### Decisión
Se crean dos scripts en 01-TOOLS/:
1. launch-reviewers.sh <job-id> <round>:
   - Limpia procesos opencode zombies previos (pkill -f "opencode run").
   - Lee spec.md y build.md del job para construir el prompt de cada revisor.
   - Extrae el modelo de cada archivo de agente (ya aplicado por factory:apply-models).
   - Lanza los 4 revisores EN PARALELO (background jobs + wait).
   - Cada revisor se ejecuta con timeout --signal=KILL y --pure --auto.
   - Verifica que cada review-<x>.md tenga VERDICT: en línea 1 y SCORE: en línea 2.
   - Limpia zombies al finalizar.
   - Retorna código 0 si los 4 son válidos; código 1 si falló alguno.
2. validate-artifacts.sh <job-id> <round>:
   - Valida que cada review-<x>.md tenga VERDICT: válido en línea 1 y SCORE: en línea 2.
   - Valida que decision.md tenga APPROVE / CHANGES / ESCALATE en línea 1.
   - Cualquier valor ambiguo → lado seguro (CHANGES / ESCALATE / NEEDS_HUMAN).

### Flujo de uso en el paso 4 del pipeline
bash 01-TOOLS/launch-reviewers.sh <job-id> <round>
bash 01-TOOLS/validate-artifacts.sh <job-id> <round>

### Modelos por revisor (según ADR-006)
| Revisor | Modelo | Tier |
|---------|--------|------|
| reviewer-security | opencode/deepseek-v4.1-flash-free | sonnet |
| reviewer-ux | opencode/glm-5.3-flash-free | sol |
| reviewer-ui | opencode/glm-5.3-flash-free | sol |
| reviewer-code | opencode/nemotron-3.5-super-vl-free | opus |

### Alternativas consideradas
- Lanzar revisores secuencialmente: Rechazado. El punto 4 exige paralelismo.
- Sin timeout: Rechazado. Un revisor colgado bloquearía todo el pipeline.
- Sin --pure --auto: Rechazado. En CI sin interfaz, los prompts ask se quedan esperando para siempre. (Con el parche 4, el guard ya no bloquea heredocs ni contenido de herramientas, pero --pure --auto sigue recomendado para evitar prompts interactivos.)

### Consecuencias
- Los 4 revisores se lanzan en paralelo con tiempo acotado.
- Ningún revisor puede bloquear el pipeline indefinidamente.
- El formato de salida se valida automáticamente antes de pasar al approver.
- Los procesos zombies se limpian antes y después de cada lanzamiento.

### Nota sobre timeouts (actualizado)
El timeout por defecto es 600 segundos (10 minutos) por revisor, no 300.
Justificacion:
- Los modelos gratuitos de OpenCode son lentos y su tiempo de respuesta varia.
  Un revisor que analiza un diff complejo puede tardar mas de 5 minutos.
- 300 segundos era insuficiente y provocaba falsos negativos (revisor marcado como fallido por timeout cuando en realidad estaba procesando).
- 600 segundos da margen suficiente sin bloquear el pipeline indefinidamente.
Para ajustar: export REVIEW_TIMEOUT_SECS=900 (15 min) si se sabe que los modelos estan particularmente lentos en un momento dado.

### Actualizacion de timeout (10 horas)
El timeout por defecto se ajusto a 36000 segundos (10 horas) por revisor.
Justificacion:
- Chats individuales de revision pueden tardar 40 minutos o mas por cuestiones tecnicas del equipo y de los modelos gratuitos.
- En la factory, con 4 revisores en paralelo y diffs complejos, el tiempo puede extenderse aun mas.
- 10 horas da margen suficiente para cualquier demora sin bloquear el pipeline indefinidamente.
Para ajustar: export REVIEW_TIMEOUT_SECS=72000 (20 horas) si se requiere mas margen.

## ADR-008: Plano de control determinista (`next-step.sh`) separado del Brain

Fecha: 2026-11-04
Estado: Aprobado (al fusionar el PR que lo introduce)

### Contexto
Un modelo gratuito no sigue de forma fiable un pipeline de 11 pasos escrito en prosa: en una corrida real lanzó los reviewers por Task, escribió `gate.md` a mano y se saltó pasos. El orden de los pasos es una decisión de control, no de contenido.

### Decisión
El flujo lo decide `01-TOOLS/next-step.sh`, una máquina de estados de solo lectura y sin LLM que lee los artefactos del job y devuelve `RUN` / `DELEGATE` / `STOP` / `DONE`. El orchestrator solo ejecuta un bucle. El Brain aconseja (líneas `READ:`), el plano de control decide y los permisos (frontmatter, config managed, guard) hacen cumplir. La política de cada proyecto vive en `factory/project.json`, que solo edita el humano. Gate y reviews quedan atados al commit (`COMMIT:` / `round-N/.commit`).

### Alternativas consideradas
- Mejorar el prompt del orchestrator: rechazado, depende de que el modelo obedezca.
- Que el Brain dicte el flujo: rechazado, un Brain desactualizado o mal leído dejaría pasar un paso sin que nada lo frene.

### Consecuencias
- El flujo es testeable sin LLM (`tests/next-step.test.mjs`).
- Cualquier valor ambiguo termina en `STOP`: el sistema falla cerrado.
- Cambiar el flujo exige cambiar código y tests, no un prompt.

## ADR-009: El Brain viaja en el PR del job; el ADR se aprueba con `spec.ok`; perfil de spec `full`

Fecha: 2026-11-04
Estado: Aprobado (al fusionar el PR que lo introduce)

### Contexto
En una corrida real el `@memory-curator` escribió en el checkout principal: el Brain quedó sin commitear, fuera del PR y sin revisión, y recogió como lección una afirmación falsa ("24 tests preexistentes fallan") que no estaba en la evidencia. Además no había criterio para registrar ADR: la aprobación de un ADR nunca fue un paso del flujo (los ADR-001 a ADR-007 los escribieron sesiones de trabajo con el humano y el prompt del curator solo decía "ADR si aplica").

### Decisión
1. El curator escribe en la worktree del job solo `02-DOCS/wiki/jobs/<id>.md`, `index.md` y `sdd/decisions.md`; `commit-brain.sh` los commitea en la rama del job y viajan en el PR. Los commits que solo tocan esas páginas no invalidan el gate ni los reviews (`factory_commit_fresh`).
2. El spec declara `ADR: none | <título>`. Si hay título, el curator añade el ADR y `next-step.sh` no deja subir la rama sin él. **El estado lo fija el flujo, no el curator**: la confirmación humana del spec (`spec.ok`) ya aprueba el diseño y la decisión que declara, así que el ADR se escribe `Aprobado`; si el proyecto no exige `spec.ok`, nadie la aprobó y se escribe `Propuesto` hasta que el humano revise el PR. Rechazar el PR descarta el ADR (no llega a `main`). `next-step.sh` comprueba el estado leyendo el bloque del ADR nuevo.
3. Perfil de spec `full` (`factory/project.json`): Actores, Requisitos funcionales `RF-n`, Diseño y trazabilidad RF → criterio → tarea. La página del job debe citar el commit del gate: las pruebas se afirman con la evidencia.
4. Los ids de job pueden ser descriptivos (`next-step.sh --new-id "frase corta"`): `<palabras>-<aammdd>-<4 hex>`.

### Alternativas consideradas
- Brain en una rama aparte: rechazado por ahora, añade push y PR automáticos; se puede reconsiderar.
- Dejar el Brain sin versionar: rechazado, nadie lo revisa.

### Consecuencias
- El humano revisa código y documentación en el mismo PR, y no hay un paso manual aparte para aprobar ADR.
- Las afirmaciones sobre pruebas son verificables contra `gate.md`.
- Más estructura exigida al spec-writer: se activa por proyecto con `spec_profile`.
- El `spec.ok` pasa a significar también "apruebo la decisión de arquitectura declarada": el resumen que se muestra al confirmar incluye `ADR a registrar`.

## ADR-010: Modelos por rol vigentes y decorrelación (reemplaza a ADR-001 y ADR-005)

Fecha: 2026-11-04
Estado: Aprobado (documenta lo ya fusionado en el PR #8; se aprueba al fusionar el PR que lo introduce)

### Contexto
ADR-001 (todo con modelos gratuitos, 4 tiers) y ADR-005 (corrección de IDs y reparto por autoevaluación) describían una configuración que `factory/config.json` ya no tiene: el PR #8 movió los roles críticos a modelos de `opencode-go` de otras familias.

### Decisión
La fuente de verdad de la asignación es `factory/config.json`. Estado a esta fecha:

| Rol | Tier | Modelo |
|---|---|---|
| builder | `go-builder` | `opencode-go/gpt-5.6-luna` |
| reviewer-security | `go-security` | `opencode-go/grok-4.7` |
| approver, human-gate | `go-approver` | `opencode-go/claude-haiku-5-5` |
| spec-writer, reviewer-ux, reviewer-ui, reviewer-code, memory-curator | `sol` | `opencode/glm-5.3-flash-free` |
| intake | `astra` | `opencode/mimo-v2.6-flash-free` |
| orchestrator | `opus` | `opencode/nemotron-3.5-super-vl-free` |

Criterio: quien construye (builder), quien aprueba (approver) y quien audita seguridad usan familias distintas (OpenAI, Anthropic, xAI), y `reviewer-code` va en una familia distinta del builder, para decorrelacionar errores. Los IDs se validan contra `opencode models` con `factory/scripts/validate-models.mjs`; el 2026-11-04 verificó 11 modelos de 161 disponibles. El tier `sonnet` sigue definido en `config.json` pero ningún rol lo usa.

### Alternativas consideradas
- Solo modelos gratuitos (ADR-001, ADR-005): reemplazado; los roles críticos pasaron a modelos Go.

### Consecuencias
- La asignación la probó y adoptó el humano como la mejor configuración por ahora. El único registro reproducible es el A/B del approver (ADR-006, repetido el 2026-11-05): `claude-haiku-5-5` rechazó la rama defectuosa 5/5 y aprobó la limpia 5/5.
- spec-writer, tres reviewers y memory-curator comparten modelo (GLM): sus errores pueden estar correlacionados. Si baja la señal, subir de tier al menos un reviewer.
- Cambiar un modelo es editar `factory/config.json` (archivo protegido, lo cambia el humano) y ejecutar `validate-models.mjs`.


## ADR-011: Skills de terceros en `.agents/skills/` y skills propias en `03-SKILLS/` (reemplaza a ADR-004)

Fecha: 2026-11-05
Estado: Aprobado (decisión del humano en la sesión del 2026-11-05; se aprueba al fusionar el PR que la introduce)

### Contexto
ADR-004 asumió que `03-SKILLS/` era el directorio que carga OpenCode y que `.agents/skills/` no se usaba, por lo que mandó borrar las copias de `.agents/skills/`. `opencode debug skill` (ejecutado el 2026-11-05, 22 skills) lo desmiente: `code-review`, `receiving-code-review`, `test-driven-development` y `differential-review` se cargan desde `.agents/skills/<nombre>/SKILL.md`. Los agentes las invocan por nombre (por ejemplo `builder.md` cita `test-driven-development` y `receiving-code-review`). `skills-lock.json` las fija con su fuente y su hash (getsentry/skills, trailofbits/skills, obra/superpowers). Las versiones de `.agents/skills/` son las completas (102, 205 y 330 líneas); las de `03-SKILLS/` eran resúmenes de 61 a 72 líneas que ningún agente, script ni test leía por ruta. `03-SKILLS/` guarda además skills propias de la fábrica (`factory-protocol`, `orient`, `approver`, `human-gate`, `memory-curator`, `spec-writer`) que los agentes leen por ruta y que no tienen equivalente de terceros.

### Decisión
- `.agents/skills/` queda intacta: skills de terceros fijadas por `skills-lock.json` y cargadas por OpenCode.
- Se borran de `03-SKILLS/` los tres resúmenes duplicados (`code-review`, `receiving-code-review`, `test-driven-development`). Quedan las skills propias de la fábrica.
- Regla: una skill vive en un solo sitio. De terceros: `.agents/skills/` con su entrada en `skills-lock.json`. Propia de la fábrica: `03-SKILLS/`.
- ADR-004 pasa a `Reemplazado por ADR-011`.

### Alternativas consideradas
- Cumplir ADR-004 (dejar solo `03-SKILLS/`): Rechazado. OpenCode no carga esa ruta; los reviewers y el builder perderían las versiones completas en la herramienta `skill` y `skills-lock.json` quedaría desalineado.
- Mantener las dos copias: Rechazado. Dos copias con el mismo nombre confunden qué se carga y gastan contexto.

### Consecuencias
- Antes de borrar se repitió la búsqueda de las tres rutas (sin referencias) y se confirmó que `opencode debug skill` sigue listando las cuatro skills de terceros desde `.agents/skills/`.
- `install-into.sh` copia `03-SKILLS/` pero no `.agents/skills/`: un proyecto nuevo no recibe las skills de terceros hasta que se añada esa copia (con sus entradas de `skills-lock.json`) o se instalen con `npx @ericrisco/rsc`. Queda pendiente.
