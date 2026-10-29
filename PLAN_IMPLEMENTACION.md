# Plan de Implementación — AI Software Factory (Híbrida Central + Brain por Proyecto)

**Estado:** Plan (build mode activado)
**Repositorio:** `/home/frappe/ai-factory/`
**Rama actual:** `test-approver-ab`
**Rama objetivo:** `main` (alpha, con tests de ejemplo)

---

## 1. Decisión de arquitectura: Híbrida

### Modelo
- **Factory central** en `/home/frappe/ai-factory/`: contiene los agentes, skills, hooks, comandos y configuración base de OpenCode + RSC.
- **Brain aislado por proyecto**: cada proyecto (`guitar_agent`, `guitar_pro`, `karaoke_d`, `rs/autocentro`, y futuros) tiene su propio `02-DOCS/` con su constitución, specs, decisiones y lecciones aprendidas.
- **Reglas críticas de aislamiento**: ningún agente de un proyecto lee o escribe el `02-DOCS/` de otro. Cada job está acotado a un solo proyecto.

### ¿Por qué híbrida?
- Evita duplicar los 16 agentes, 31 skills RSC, hooks y configuración de OpenCode en cada proyecto.
- Evita que un agente trabajando en `guitar_agent` alucine con patrones de `guitar_pro` o pisque cambios de otro proyecto.
- Permite escalar a nuevos proyectos sin reescribir la factory.

---

## 2. Reglas críticas de aislamiento entre proyectos

### 2.1. Brain por proyecto (02-DOCS/)
Cada proyecto debe tener su propia carpeta `02-DOCS/` en su raíz:

```
/home/frappe/guitar_agent/02-DOCS/          # Brain de guitar_agent
/home/frappe/guitar_pro/02-DOCS/            # Brain de guitar_pro
/home/frappe/karaoke_d/02-DOCS/             # Brain de karaoke_d
/home/frappe/ai-factory/02-DOCS/            # Brain central de la factory
```

**Regla:** Los agentes de la factory solo leen/escriben `02-DOCS/` del proyecto en el que se ejecuta el job. Nunca cruzan fronteras.

### 2.2. Jobs por proyecto
Cada job se crea dentro del proyecto afectado:

```
/home/frappe/guitar_agent/factory/jobs/<job-id>/
/home/frappe/guitar_pro/factory/jobs/<job-id>/
```

La factory central solo define el **patrón** de jobs; los jobs reales viven en cada proyecto.

### 2.3. .gitignore crítico (evitar mezclar información)

Cada proyecto debe tener un `.gitignore` que incluya al menos:

```
# --- AI Factory: aislamiento crítico ---
# Nunca commitear el Brain de otro proyecto
!02-DOCS/
02-DOCS/other-project*/

# Nunca commitear jobs de otro proyecto
!factory/
factory/jobs/other-project*/

# Nunca commitear configuración de factory ajena
!factory/config.json.other-project*

# Archivos temporales de factory
factory/jobs/*/
!.gitkeep
*.log
.env
.env.*
```

**Archivo central `.gitignore` en `/home/frappe/ai-factory/`:**

```
/home/frappe/ai-factory/.gitignore:

# Brain de otros proyectos (aislamiento)
02-DOCS/*/projects/*

# Jobs de otros proyectos
factory/jobs/*/other-project*/

# Secretos
.env
.env.*
*.env

# Dependencias
node_modules/
.rsc/backups/

# Logs de factory
factory/logs/*.log
```

### 2.4. Regla de "no alucinación cross-proyecto"
Cada agente debe incluir en su system prompt una cláusula explícita:

> **Regla de aislamiento:** Este job pertenece al proyecto `<nombre-proyecto>`. Solo lee y escribe en `02-DOCS/` de este proyecto. No consultes `02-DOCS/` de otros proyectos. No asumas convenciones, patrones o decisiones de otros proyectos. Si necesitas información de otro proyecto, explícitalo como bloqueo y pide al humano.

---

## 3. Estrategia de Git

### 3.1. Rama `main` (alpha)
- `main` contendrá el esqueleto de la factory + tests de ejemplo de uso.
- **No** fusionar aún las branches de prueba (`test-hooks`, `test-approver-ab`).
- Crear `main` desde el estado actual de `test-approver-ab` pero limpia de datos de prueba.

### 3.2. Branches de prueba
Mantener `test-hooks` y `test-approver-ab` como referencia. No eliminar hasta que el usuario lo pida.

### 3.3. Workflow por proyecto
Cuando se inicialice la factory en un proyecto nuevo:

```bash
cd /home/frappe/<proyecto>
npx @ericrisco/rsc@3.6.0 onboard --target opencode --project-kind software
# Luego copiar la estructura de factory/ desde ai-factory/
```

---

## 4. Decisión final sobre skills externos

### 4.1. Skills RSC ya instalados (31, no tocar)
La cadena SDD completa ya está: `sdd`, `specify`, `clarify`, `plan`, `tasks`, `implement`, `verify`, `review`, `ship`, `constitution`, `parallel`, `worktrees`, `analyze`, `ux`, `debug`, `harness`, `orient`, `init`, `sdd-init`, etc.

### 4.2. Skills externos candidatos (verificados con `--list`)

| Skill | Repo | ¿Instalar? | Razón |
|-------|------|-----------|-------|
| `test-driven-development` | obra/superpowers | **SÍ (P1)** | Fuerza RED-GREEN-REFACTOR, complementa `implement` de RSC |
| `receiving-code-review` | obra/superpowers | **SÍ (P1)** | Verificar feedback antes de aplicar (bucle approver→builder) |
| `code-review` | getsentry/skills | **SÍ (P1)** | Revisión de código, complementa `review` de RSC |
| `differential-review` | trailofbits/skills | **SÍ (P1)** | Revisión de seguridad centrada en diff, complementa `secure-coding` |
| `systematic-debugging` | obra/superpowers | **SÍ (P2)** | Cuatro fases: causa raíz, patrón, hipótesis, implementación |
| `web-design-guidelines` | vercel-labs/agent-skills | **SÍ (P2, solo UI)** | Audita UI contra reglas objetivas, formato file:línea |
| `find-bugs` | getsentry/skills | **P2** | Búsqueda de bugs, solapa con `review` |
| `create-pr` / `iterate-pr` | getsentry/skills | **P2** | PRs y arreglo de CI, solapa con `ship` |
| `sentry-workflow` | getsentry/sentry-for-ai | **NO** | Repo solo tiene SDKs, no un skill de workflow útil |
| `subagent-driven-development` | obra/superpowers | **NO** | Duplica `parallel` de RSC, compite con SDD |
| `superpowers` (completo) | obra/superpowers | **NO** | Compite con cadena SDD de RSC |

### 4.3. Reglas de instalación de skills externos
- Máximo **2-3 skills por agente** para no ahogar a modelos flash gratuitos.
- Instalar siempre desde el repo original, fijando versión por commit.
- `DISABLE_TELEMETRY=1 npx skills add <repo> --skill <nombre> -a opencode -y`
- Revisar cada SKILL.md y sus scripts antes de instalar (seguridad: un skill ejecuta bash).
- Anotar commit/versión de cada skill en `02-DOCS/wiki/sdd/decisions.md` (ADR-004).

---

## 5. Plan de ejecución paso a paso

### Fase 1: Estructurar la factory central (esta sesión)

1. **Crear `PLAN_IMPLEMENTACION.md`** (este documento) en `/home/frappe/ai-factory/`.
2. **Crear `.gitignore` crítico** en `/home/frappe/ai-factory/` con reglas de aislamiento.
3. **Crear `03-SKILLS/factory-protocol/SKILL.md`** (ya creado, verificar que esté completo).
4. **Crear `02-DOCS/wiki/sdd/config.yaml`** (ya creado).
5. **Crear `02-DOCS/wiki/index.md`** (ya creado).
6. **Crear `02-DOCS/wiki/sdd/decisions.md`** (ya creado con ADR-001, 002, 003).
7. **Crear `factory/backlog.md`** (ya creado).
8. **Crear `01-TOOLS/risk.sh`** (ya creado y probado).
9. **Verificar `.rsc/skill-registry.json`** generado (ya existe).

### Fase 2: Rama `main` alpha con tests de ejemplo

1. **Crear rama `main`** desde el estado limpio de la factory (sin datos de prueba de `test-approver-ab`).
2. **Crear carpeta `tests/`** con ejemplos de uso de la factory:
   - `tests/factory-smoke-test.sh`: script que ejecuta un job trivial de punta a punta.
   - `tests/example-job/`: ejemplo de estructura de `factory/jobs/<id>/` con archivos de ejemplo.
   - `tests/verify-hooks.sh`: verifica que `pre-commit`, `pre-push` y el plugin bloquean operaciones prohibidas.
3. **Commitear y pushear a `main`** en GitHub (`https://github.com/DOKK-droid/ai-factory`).

### Fase 3: Verificar e instalar skills externos (pendiente de confirmación)

1. **Leer SKILL.md de cada candidato prioridad 1** para verificar si ejecuta comandos o descarga contenido remoto.
2. **Instalar solo los aprobados** (máximo 2-3 por agente).
3. **Actualizar prompts de agentes** para referenciar los skills instalados.
4. **Registrar versiones en ADR-004** en `02-DOCS/wiki/sdd/decisions.md`.

### Fase 4: Integrar factory en proyectos existentes (pendiente)

Para cada proyecto (`guitar_agent`, `guitar_pro`, `karaoke_d`, `rs/autocentro`):

1. **Ejecutar `rsc onboard`** en el proyecto (`--target opencode --project-kind software`).
2. **Crear `02-DOCS/`** con constitución propia del proyecto.
3. **Copiar estructura `factory/`** desde `ai-factory/` (config, scripts, backlog).
4. **Copiar `.opencode/agent/`** adaptando modelos si es necesario.
5. **Copiar `.hooks/`** y `.git/hooks/`.
6. **Agregar cláusula de aislamiento** en los prompts de agentes del proyecto.
7. **Crear `.gitignore` crítico** en el proyecto.
8. **Probar con un job trivial** en ese proyecto.

### Fase 5: Nuevos proyectos

Cuando se cree un nuevo proyecto, repetir Fase 4 automáticamente (posiblemente con un script de bootstrap).

---

## 6. Archivos clave del plan

| Archivo | Ruta | Propósito |
|---------|------|-----------|
| Este plan | `/home/frappe/ai-factory/PLAN_IMPLEMENTACION.md` | Hoja de ruta completa |
| Config central | `/home/frappe/ai-factory/factory/config.json` | Mapeo tiers → modelos OpenCode |
| Brain central | `/home/frappe/ai-factory/02-DOCS/` | Constitución, decisiones, index |
| Skills factory | `/home/frappe/ai-factory/03-SKILLS/factory-protocol/SKILL.md` | Formatos de veredicto compartidos |
| Human-gate | `/home/frappe/ai-factory/01-TOOLS/risk.sh` | Criterios deterministas de riesgo |
| Hooks | `/home/frappe/ai-factory/.hooks/` | spec-first-gate, branch-guard, ship-guard, worktree-reaper |
| Plugin OpenCode | `/home/frappe/ai-factory/.opencode/plugins/factory-guard.js` | Enforcement de push/merge/pr-create |
| Git hooks | `/home/frappe/ai-factory/.git/hooks/pre-commit`, `pre-push` | Bloqueo en main/master |

---

## 7. Reglas de operación (innegociables)

1. **Un job = un proyecto**: un job nunca toca código de dos proyectos distintos.
2. **Brain aislado**: `02-DOCS/` de proyecto A no se lee desde proyecto B.
3. **Sin push a main salvo fast_path habilitado explícitamente por el humano**.
4. **Los 4 revisores se lanzan en paralelo** por job.
5. **Cualquier valor ambiguo = lado seguro** (CHANGES / ESCALATE / NEEDS_HUMAN).
6. **Máximo 2-3 skills externos por agente**.
7. **Cada nuevo proyecto inicializa su propio `02-DOCS/` y su propia copia de `factory/`**.

---

## 8. Siguiente acción inmediata

Crear este archivo `PLAN_IMPLEMENTACION.md`, crear la rama `main` alpha con tests de ejemplo, y esperar confirmación del usuario antes de:
- Instalar skills externos.
- Integrar la factory en proyectos existentes.
- Fusionar branches de prueba a `main`.

---

**Fin del plan.**
