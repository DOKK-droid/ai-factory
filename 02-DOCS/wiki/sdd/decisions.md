# Decisiones de la AI Factory

Registro de decisiones arquitectónicas (ADR) de la AI Software Factory sobre OpenCode + RSC Harness.

## ADR-001: Mapeo de modelos (tiers → OpenCode gratuitos)

Fecha: 2026-10-29
Estado: Aprobado

### Contexto
La factory usa 4 tiers (opus, sonnet, sol, astra) para decorrelacionar errores entre builder y revisores. Cada tier se mapea a un modelo gratuito de OpenCode.

### Decisión

| Tier | Modelo OpenCode | Roles | Razón |
| opus        | opencode/nemotron-3.5-super-vl-free | orchestrator              | NVIDIA, coordinación y fallback |
| go-builder  | opencode-go/gpt-5.6-luna            | builder                   | OpenAI, código crítico, TDD     |
| go-approver | opencode-go/claude-haiku-5-5        | approver, human-gate      | Anthropic, juicio independiente |
| go-security | opencode-go/grok-4.7                | reviewer-security         | xAI, detección de vulnerabilidades |
| sonnet      | opencode/deepseek-v4.1-flash-free   | memory-curator, intake    | DeepSeek, tareas de soporte     |
| sol         | opencode/glm-5.3-flash-free         | reviewer-code, reviewer-ux| Zhipu/GLM, familia distinta al builder |
| astra       | opencode/mimo-v2.6-flash-free       | reviewer-ui               | Mimo, UI y UX                   |

### Alternativas consideradas
- Usar un solo modelo para todo: Rechazado. El approver aprobaría sus propios errores sin decorrelación.
- Usar modelos gratuitos para roles críticos: Rechazado para builder/approver. Falta razonamiento profundo y juicio independiente.

- Builder (gpt-5.6-luna, OpenAI) y reviewer-code (glm-5.3-flash-free, Zhipu/GLM) son familias distintas: decorrelación real.
- Approver (claude-haiku-5-5, Anthropic) y reviewer-security (grok-4.7, xAI) son familias distintas entre sí y del builder.
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

## ADR-004: Skills en una sola copia y modelo del approver

Fecha: 2026-10-30
Estado: Aplicado

### Contexto
`code-review`, `receiving-code-review` y `test-driven-development` existían dos veces. Se conserva una sola copia en `03-SKILLS/`. El modelo del approver ya no es provisional: usa `deepseek-v4.1-flash-free` (sonnet) y `reviewer-code` usa `glm-5.3-flash-free` (sol), familia distinta al builder (nemotron/opus).

### Decisión
- Una sola copia de cada skill en `03-SKILLS/` (canónica).
- Borradas duplicadas de `.agents/skills/`: `code-review`, `receiving-code-review`, `test-driven-development`.
- Conservado `.agents/skills/differential-review`.
- Borrada carpeta typo `03-SILLS/` y carpeta `patch-refactor/` (idéntica a `PATCH_INSTRUCCIONES.md`).

## ADR-005: Corrección de modelos gratuitos y asignación de roles (PROPUESTO, sin validar)

Fecha: 2026-10-30
Estado: Propuesto, sin validar

### Contexto
El tier `sonnet` apuntaba a `opencode/deepseek-v4-flash-free`, un modelo que no existe en OpenCode. Se corrige a `deepseek-v4.1-flash-free`. Además, se introducen modelos Go (OpenCode Go layer) para roles críticos que requieren mayor razonamiento.

### Nuevos roles por tier
| Tier | Modelo | Roles |
|------|--------|-------|
| opus | `opencode/nemotron-3.5-super-vl-free` | orchestrator |
| go-builder | `opencode-go/gpt-5.6-luna` | builder |
| go-approver | `opencode-go/claude-haiku-5-5` | approver, human-gate |
| go-security | `opencode-go/grok-4.7` | reviewer-security |
| sonnet | `opencode/deepseek-v4.1-flash-free` | memory-curator, intake |
| sol | `opencode/glm-5.3-flash-free` | reviewer-code, reviewer-ux |
| astra | `opencode/mimo-v2.6-flash-free` | reviewer-ui |

### Decorrelación de familias
- builder (gpt-5.6-luna, OpenAI) ≠ reviewer-code (glm-5.3-flash-free, Zhipu/GLM) ✅
- approver (claude-haiku-5-5, Anthropic) ≠ builder ✅
- reviewer-security (grok-4.7, xAI) ≠ builder ✅

## ADR-006: Resultado A/B del approver (paso 7) (PROPUESTO, sin validar)

Fecha: 2026-10-30
Estado: Propuesto, sin validar

### Contexto
Se ejecutó A/B con 4 modelos gratuitos. Todos detectan 100% de ramas defectuosas, pero ninguno aprueba `cand-clean` porque el fixture no implementa el spec (fallo del fixture, no del modelo).

### Decisión
- Usar `deepseek-v4.1-flash-free` como approver (configurado).
- `fast_path` permanece desactivado.
- Pendiente: corregir fixture `cand-clean` y reejecutar A/B.

## ADR-007: Lanzamiento robusto de los 4 revisores en paralelo (scripts aún no versionados)

Fecha: 2026-10-30
Estado: Scripts aún no versionados

### Contexto
Los 4 revisores se lanzan en paralelo con `launch-reviewers.sh` (timeout 10h, `--pure --auto`, anti-zombies, validación de formato).

### Timeout
36000 segundos (10 horas) por revisor, configurable con `REVIEW_TIMEOUT_SECS`.

## Paso 6: Verificación en vivo — completada

Todas las 8 pruebas de verificación en vivo pasaron durante el job e2e-001.

