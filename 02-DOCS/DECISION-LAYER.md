# Capa de Decisión Humano vs. Máquina — Próxima Fase

> Este documento define la especificación para la capa de decisión que determina si las acciones finales de un job las ejecuta la máquina (FAST_PATH) o un humano (NEEDS_HUMAN). Solo se ejecuta después de que el approver haya dado APPROVE.

---

## 1. Posición en el pipeline

```
builder → gate → 4 reviewers → approver → [APPROVE?] → complexity.sh → risk.sh → output
                                              ↓
                                    CHANGES → volver a builder (bucle, máx. max_rounds)
                                    ESCALATE → human
                                    APPROVE  → complexity.sh → risk.sh → output
```

**Regla clave:** la capa de decisión solo se ejecuta después de APPROVE exitoso. El approver valida primero (con bucle iterativo si falla). Solo cuando el approver confirma que la solución cumple los estándares, se decide quién ejecuta las acciones finales.

---

## 2. Componentes

### 2.1 `01-TOOLS/complexity.sh` (NUEVO — paso separado)

Analiza el diff y produce `factory/jobs/<id>/complexity.md`.

**Uso:**
```bash
bash 01-TOOLS/complexity.sh <job-id> <base> <head>
```

**Formato de salida (`complexity.md`):**
```
COMPLEXITY: LOW | MEDIUM | HIGH | CRITICAL
SCORE: 0-100
FACTORS: <lista de factores contribuyentes>
```

**Algoritmo de scoring:**

| Factor | Puntos | Descripción |
|--------|--------|-------------|
| Base | 0 | Punto de partida |
| Archivos > 3 | +10 c/u | Cada archivo más allá de 3 |
| Líneas > 50 | +5 c/50 | Cada 50 líneas más allá de 50 |
| Ruta sensible | +30 | auth, migrations, workflows, .env |
| Dependencias | +20 | package.json, lockfiles modificados |
| API/contratos | +15 | Cambios en interfaces, APIs, contratos |
| Sin tests | +10 | No hay archivos de test en el diff |
| Cross-module | +15 | Cambios que cruzan múltiples directorios |
| **Máximo** | **100** | Cap del score |

**Thresholds:**

| Nivel | Rango | Decisión |
|-------|-------|----------|
| LOW | 0-25 | Machine |
| MEDIUM | 26-50 | Machine (con nota de precaución) |
| HIGH | 51-75 | Human |
| CRITICAL | 76-100 | Human |

---

### 2.2 `01-TOOLS/risk.sh` (MODIFICADO)

Lee `complexity.md` y añade la lógica de decisión.

**Flujo de decisión:**
```
Si complexity ≤ MEDIUM Y 4/4 reviews PASS Y gate PASS Y fast_path ON
  → FAST_PATH (machine merge)

Si complexity > MEDIUM
  → NEEDS_HUMAN

Si ruta sensible tocada
  → NEEDS_HUMAN (siempre, sin importar score)

Si gate FAIL
  → NEEDS_HUMAN (siempre)

Si algún review = CHANGES
  → NEEDS_HUMAN (siempre)
```

---

### 2.3 `factory/config.json` (MODIFICADO)

Bloque `complexity` genérico:

```json
"complexity": {
  "thresholds": {
    "low": 25,
    "medium": 50,
    "high": 75
  },
  "auto_merge_max": "MEDIUM",
  "require_human_paths": [
    "auth",
    "migrations",
    "workflows",
    ".env",
    "package.json",
    "API_CONTRACTS"
  ]
}
```

- `auto_merge_max`: complejidad máxima para machine merge (LOW o MEDIUM)
- `require_human_paths`: rutas/patrones que SIEMPRE requieren humano

---

## 3. Consulta del Brain en la capa de decisión

### `complexity.sh` — LEE el Brain

| Sección | Por qué |
|---------|---------|
| `incidents.md` | Si una ruta tiene historial de incidentes, el score sube |
| `errors.md` | Si una ruta tiene errores recurrentes, el score sube |

**Lógica:** si la ruta tocada aparece en `incidents.md` o `errors.md`, se añaden +10 puntos adicionales al score. Esto hace que cambios en zonas problemáticas sean más propensos a requerir humano.

### `risk.sh` — LEE el Brain

| Sección | Por qué |
|---------|---------|
| `decisions.md` | Verificar que el cambio cumple criterios de riesgo de ADRs |
| `constitution.md` | Verificar que no viola principios no negociables |

---

## 4. Ejemplos de escenarios

### Cambio simple
```
1 archivo, 20 líneas, con test, sin rutas sensibles

complexity.md:
  COMPLEXITY: LOW
  SCORE: 12
  FACTORS: base=0, files=0, lines=0

risk.sh: FAST_PATH → machine merge
```

### Cambio medio
```
5 archivos, 150 líneas, con tests, sin rutas sensibles

complexity.md:
  COMPLEXITY: MEDIUM
  SCORE: 42
  FACTORS: files=+20, lines=+15, cross-module=+15

risk.sh: FAST_PATH → machine merge (con nota de precaución)
```

### Cambio complejo
```
15 archivos, 500 líneas, cambia API, con tests

complexity.md:
  COMPLEXITY: HIGH
  SCORE: 68
  FACTORS: files=+120, lines=+45, API=+15, cross-module=+15

risk.sh: NEEDS_HUMAN → PR borrador + resumen para humano
```

### Cambio crítico
```
auth + migrations + sin tests + 500 líneas

complexity.md:
  COMPLEXITY: CRITICAL
  SCORE: 95
  FACTORS: files=+80, lines=+45, sensitive=+30, no-tests=+10, cross-module=+15

risk.sh: NEEDS_HUMAN → PR borrador + resumen para humano
```

---

## 5. Iteración del approver (ciclo de vida iterativo e incremental)

El approver ya tiene esta lógica (ADR-002):

```
4 reviews → approver evalúa:
  ├─ Todos PASS + gate PASS + spec cumplido → APPROVE
  ├─ Algún CHANGES → volver al builder (bucle, máx. max_rounds)
  ├─ Desacuerdo entre reviews → ESCALATE
  └─ Spec no cumplido → CHANGES (volver a builder)
```

**Solo después de APPROVE exitoso se ejecuta la capa complexity.sh → risk.sh.**

---

## 6. Orden de implementación

| Paso | Archivo | Acción | Estado |
|------|---------|--------|--------|
| 1 | `01-TOOLS/complexity.sh` | Crear con lógica de scoring | ⏳ Pendiente |
| 2 | `factory/config.json` | Añadir bloque `complexity` | ⏳ Pendiente |
| 3 | `01-TOOLS/risk.sh` | Modificar para leer `complexity.md` | ⏳ Pendiente |
| 4 | `03-SKILLS/factory-protocol/SKILL.md` | Documentar formato de `complexity.md` | ⏳ Pendiente |
| 5 | `.opencode/agent/human-gate.md` | Referenciar `complexity.md` en su prompt | ⏳ Pendiente |
| 6 | `npm test` | Verificar 165 tests OK | ⏳ Pendiente |
| 7 | `npm run factory:apply-models` | Si se cambian modelos | ⏳ Pendiente |

---

## 7. Formato de `complexity.md` para `factory-protocol/SKILL.md`

```markdown
### Complexity (post-approver)

`factory/jobs/<id>/complexity.md`:

```
COMPLEXITY: LOW | MEDIUM | HIGH | CRITICAL
SCORE: 0-100

## Factores
- <factor>: <+puntos>
- <factor>: <+puntos>

## Consulta del Brain
- incidents.md: <rutas con historial>
- errors.md: <rutas con errores recurrentes>
```

**Regla:** si `COMPLEXITY > MEDIUM` o se toca una ruta sensible → `NEEDS_HUMAN`.
```

---

## 8. Resumen

| Aspecto | Detalle |
|---------|---------|
| **Cuándo se ejecuta** | Después de APPROVE exitoso del approver |
| **Componentes** | `complexity.sh` (separado) + `risk.sh` (modificado) |
| **Max machine merge** | MEDIUM (LOW + MEDIUM = machine) |
| **Thresholds** | Genéricos (no por proyecto, por ahora) |
| **Brain** | `complexity.sh` lee `incidents.md` + `errors.md`; `risk.sh` lee `decisions.md` + `constitution.md` |
| **Iteración** | El approver valida primero; solo APPROVE pasa a complexity → risk |
