# Decisiones de la AI Factory

Registro de decisiones arquitectónicas (ADR) de la AI Software Factory sobre OpenCode + RSC Harness.

## ADR-001: Mapeo de modelos (tiers → OpenCode gratuitos)

Fecha: 2026-10-29
Estado: Aprobado

### Contexto
La factory usa 4 tiers (opus, sonnet, sol, astra) para decorrelacionar errores entre builder y revisores. Cada tier se mapea a un modelo gratuito de OpenCode.

### Decisión

| Tier | Modelo OpenCode | Roles | Razón |
|------|----------------|-------|-------|
| opus | `opencode/nemotron-3.5-super-vl-free` | spec-writer, builder, orchestrator | Mejor razonamiento/código gratuito para roles críticos |
| sonnet | `opencode/deepseek-v4-flash-free` | approver, human-gate, memory-curator, intake, reviewer-code | Otra familia (DeepSeek vs NVIDIA), decorrelaciona errores |
| sol | `opencode/glm-5.3-flash-free` | reviewer-security, reviewer-ux | Tercera familia (Zhipu/GLM) |
| astra | `opencode/mimo-v2.6-flash-free` | reviewer-ui | Cuarta familia (Mimo) |

### Alternativas consideradas
- Usar nemotron para todo: Rechazado. El approver sería del mismo modelo que el builder, tiende a aprobar sus propios errores.
- Usar solo deepseek para todo: Rechazado. No hay decorrelación de familias de modelos.

### Consecuencias
- El approver y human-gate usan deepseek (otra familia que el builder) para detección independiente de errores.
- Los 4 revisores usan 3 familias distintas (deepseek, glm, mimo) para decorrelacionar.
- fallback: todos los tiers caen a deepseek-v4-flash-free si el modelo principal falla.

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
Estado: Aprobado

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
- Modelo del approver: `approver = sonnet`, `human-gate = sonnet`, `reviewer-code = sonnet`. Se mantiene **provisional** hasta ejecutar el A/B real (paso 7: `tests/ab/run-ab.mjs` modo approver y reviewer) y registrar el resultado en ADR-006. Mientras tanto, `fast_path` permanece desactivado.

### Alternativas consideradas
- Mantener ambas copias: Rechazado. Duplicidad de nombre y contexto.
- Elegir `.agents/skills/` como canónica: Rechazado. Ninguna referencia del repo apunta allí; rompería configs de agente y smoke test.

### Consecuencias
- Un solo origen de verdad para skills: `03-SKILLS/`.
- La elección final del modelo del approver queda pendiente del A/B; si ningún modelo gratuito cumple los criterios, se usa el mejor disponible y `fast_path` se deja apagado.
