# Parche 8 — `next-step.sh`: el flujo en código, no en el prompt

Rama: `feat/next-step` (sobre el parche 7, `fix/evidencia-protegida`). Sin push ni PR hechos por quien lo preparó.

## Por qué

Un modelo gratuito no sigue de forma fiable 11 pasos escritos en prosa: se saltó pasos, lanzó los reviewers por Task, escribió `gate.md` a mano. El **orden** de los pasos es una decisión de control, no de contenido, así que vive en código.

| Capa | Qué es | Responde a | Quién la ejecuta |
|---|---|---|---|
| **Brain** (`02-DOCS/`) | memoria del proyecto | *qué y por qué* | los agentes la consultan; la actualiza `@memory-curator` |
| **Plano de control** (`01-TOOLS/next-step.sh`) | máquina de estados determinista, solo lectura | *cuándo y qué sigue* | código, sin LLM |
| **Permisos** (frontmatter, managed, guard) | qué puede y qué no cada agente | *límites* | OpenCode y el guard, por fuera del modelo |

**El Brain aconseja, el plano de control decide y los permisos hacen cumplir.** Si el Brain (texto que un modelo interpreta) decidiera también el flujo, un Brain mal leído o desactualizado dejaría pasar un paso sin que nada lo frene. Por eso el Brain *alimenta* al plano de control por tres vías acotadas:

- **Brain → control**: la política del proyecto vive en `factory/project.json` (versionado, solo lo edita el humano) y `next-step.sh` la lee. Cada proyecto tiene su flujo.
- **Control → Brain**: el estado 11 manda a `@memory-curator` **antes** del push; no se sube nada sin una línea `Brain:` en `trace.md`.
- **Brain → agentes**: cada `DELEGATE:` trae una línea `READ:` con las páginas del Brain que ese agente debe leer antes de actuar (solo las que existen).

## Qué cambia

| Archivo | Cambio |
|---|---|
| `01-TOOLS/next-step.sh` | **Nuevo.** `next-step.sh <id>` → `RUN:` / `DELEGATE:` / `STOP:` / `DONE` (+ `STATE:`, `WHY:`, `CMD:`, `READ:`). `--new-id` imprime un id. Exit 0 acción/DONE, 2 STOP, 1 uso |
| `01-TOOLS/checks.sh` | `gate.md`: línea 1 `GATE:`, línea 2 `COMMIT: <sha de HEAD>`, línea 3 `GATE_FAIL_STREAK: n` (FAIL seguidos; acota el bucle con el builder) |
| `01-TOOLS/launch-reviewers.sh` | escribe `round-N/.commit` al terminar; lo borra al empezar; se niega si `gate.md` es de otro commit; `FACTORY_LOW_RESOURCES=1` ⇒ `REVIEW_MAX_PARALLEL=1` por defecto |
| `01-TOOLS/validate-artifacts.sh` | `VALIDATE_REVIEWS_ONLY=1` omite `decision.md` |
| `01-TOOLS/risk.sh` | riesgos `gate_obsoleto` y `reviews_obsoletas` si el commit declarado no es HEAD |
| `factory/project.json` | **Nuevo.** Política del proyecto |
| `factory/scripts/command-guard.mjs` | protege `01-TOOLS/next-step.sh`, `factory/project.json`, y la evidencia `spec.ok`, `review.ok`, `pr.url`, `round-N/.commit`; `FACTORY_REQUIRE_SPEC_OK` es puerta del humano |
| `.opencode/agent/orchestrator.md` | la prosa del pipeline se sustituye por el bucle; permiso `bash 01-TOOLS/next-step.sh*` |
| `.opencode/agent/builder.md` | `deny` de `next-step.sh`, `project.json` y las marcas |
| `.opencode/agent/{memory-curator,human-gate}.md` | línea `Brain:` obligatoria; el human-gate solo añade el resumen |
| `.opencode/command/factory.md` | `/factory <id\|descripción>` arranca el bucle por el estado 0 |
| `01-TOOLS/commit-brain.sh` | **Nuevo.** Commitea en la worktree SOLO las páginas del curator, para que la documentación viaje en el PR |
| `01-TOOLS/lib.sh` | `factory_commit_fresh`: un commit posterior al gate sigue siendo vigente si solo toca páginas del curator |
| `factory/scripts/spec-lint.mjs` | **Nuevo.** Valida la estructura del spec y la trazabilidad RF → criterio → tarea según el perfil |
| `factory/scripts/scope-check.mjs` | las páginas del curator nunca están fuera de alcance; `## Alcance` también se parsea |
| `02-DOCS/wiki/sdd/{methodology,spec-template,job-page-template}.md` | **Nuevas.** Metodología (actores, fases, requisitos de la fábrica, buenas prácticas, DoD) y plantillas |
| `02-DOCS/wiki/sdd/decisions.md` | ADR-008 (plano de control) y ADR-009 (Brain en el PR, ADR propuestos, perfil full), ambos `Propuesto` |

## Tabla de estados (la primera condición verdadera gana)

| # | Condición | Salida |
|---|---|---|
| 0 | no existe job ni worktree | `RUN: bash 01-TOOLS/new-job.sh <id>` (a medias ⇒ `STOP: JOB_INCONSISTENT`) |
| 1 | falta/vacío `input.md` | `DELEGATE: @intake` |
| 2 | spec o tasks que no cumplen el perfil (`spec_profile`): `standard` = Surface, criterios, Alcance, tasks; `full` = además ADR, Actores, RF-n, Diseño y trazabilidad | `DELEGATE: @spec-writer` (el `WHY:` lista lo que falta) |
| 3 | sin `spec.ok` (o `spec.md` más nuevo que `spec.ok`) | `STOP: HUMAN_CONFIRM_SPEC` + `CMD: touch …/spec.ok` |
| 4 | la worktree no tiene commits sobre la base | `DELEGATE: @builder` |
| 4b | worktree con cambios sin commitear | `STOP: WORKTREE_DIRTY` |
| 5 | falta `gate.md`, ilegible, sin `COMMIT:` o `COMMIT` ≠ HEAD | `RUN: cd factory/worktrees/<id> && bash 01-TOOLS/checks.sh <id>` |
| 6 | `GATE: FAIL` | `DELEGATE: @builder`, o `STOP: MAX_ROUNDS` |
| 7 | reviews de la ronda actual faltan, inválidas u obsoletas | `RUN: … launch-reviewers.sh <id> <ronda>`; `REVIEWER_FALLO` ⇒ `STOP: REVIEWER_FAILED` |
| 8 | falta `decision.md` o es más antigua que los reviews | `DELEGATE: @approver` |
| 9 | `CHANGES` / `ESCALATE` / basura | `DELEGATE: @builder` (o `STOP: MAX_ROUNDS`) / `STOP: ESCALATED` / `STOP: DECISION_INVALID` |
| 10 | falta `human.md` o es más antigua que `decision.md` | `RUN: … risk.sh <id>`; `NEEDS_HUMAN` sin resumen ⇒ `DELEGATE: @human-gate`; línea 1 incoherente ⇒ `STOP: HUMAN_LINE_INVALID` |
| 11 | documentación del job incompleta: `trace.md` sin `Brain:` (o más antigua que `human.md`), página del job inexistente / sin sus 6 secciones / sin el commit del gate (`full`), ADR declarado y no registrado | `DELEGATE: @memory-curator`; con la documentación escrita y sin commitear, `RUN: … commit-brain.sh <id>` |
| 11b | `Surface` en `human_review_surfaces` y sin `review.ok` más nuevo que `human.md` | `STOP: HUMAN_REVIEW` |
| 12 | `origin/factory/<id>` ≠ HEAD | `RUN: git push -u origin factory/<id>` (sin `origin` ⇒ `STOP: NO_REMOTE`) |
| 13 | sin PR | `RUN: gh pr create --draft …`; sin `gh` ⇒ `STOP: HUMAN_CREATE_PR` con comando y URL |
| 14 | PR existe (o `pr.url` escrito por el humano) | `DONE` |

**Obsolescencia atada al commit**: `gate.md` lleva `COMMIT:` y `round-N/.commit` el sha revisado; si HEAD de la worktree es otro, el artefacto es obsoleto y se rehace. `decision.md`, `human.md`, `trace.md`, `spec.ok` y `review.ok` no llevan commit: se consideran vigentes solo si son **más nuevos (mtime)** que lo que los origina (reviews, decisión, human.md, spec.md). Un `touch` o un `git checkout` que cambie mtimes puede forzar que se rehagan; nunca que se salten.

**Brain en el PR**: el curator escribe en la worktree (solo `02-DOCS/wiki/jobs/<id>.md`, `index.md` y `sdd/decisions.md`), `commit-brain.sh` lo commitea y el PR lleva código y documentación. Ese commit no invalida el gate ni los reviews (`factory_commit_fresh`); un commit que toque código u otras páginas del Brain sí.

**Fail-closed**: cualquier valor ambiguo o ilegible ⇒ `STOP`, nunca avanza. Un gate o review que no se pueda verificar nunca cuenta como verde.

## `factory/project.json`

```json
{
  "require_spec_ok": true,
  "max_rounds": 3,
  "human_review_surfaces": [],
  "brain": {
    "default": ["02-DOCS/wiki/index.md"],
    "agents": { "spec-writer": ["02-DOCS/wiki/sdd/decisions.md"], "approver": ["02-DOCS/wiki/sdd/decisions.md"] }
  }
}
```

- `spec_profile`: `standard` (por defecto) o `full` (Actores, Requisitos funcionales `RF-n`, Diseño, `ADR:`, trazabilidad y página del job en el Brain). Ver `02-DOCS/wiki/sdd/methodology.md` y `spec-template.md`.
- `require_spec_ok` (bool): exige `spec.ok` antes del builder. `FACTORY_REQUIRE_SPEC_OK=0` en **tu** entorno lo desactiva para una ejecución (el guard prohíbe a los agentes escribir ese nombre).
- `max_rounds` (entero ≥ 1): manda sobre `factory/config.json`; sin él se usa el de `config.json`, y si no existe, 3.
- `human_review_surfaces`: valores de `Surface:` que exigen `review.ok` antes de subir la rama.
- `brain.default` + `brain.agents.<agente>`: páginas (rutas relativas, sin `..`) que salen en `READ:`. Sin la clave `brain`, solo `02-DOCS/wiki/index.md`.
- Archivo ilegible o con valores ambiguos ⇒ `STOP: PROJECT_INVALID`.
- Para un proyecto nuevo, copia este archivo y ajústalo (el onboarding de multi-proyecto está en el backlog).

## Flujo completo simulable: análisis → diseño → desarrollo → pruebas → revisión → documentación → entrega

Con `"spec_profile": "full"` cada job recorre y deja evidencia de todas las fases (`next-step.sh` imprime `PHASE:` en cada paso):

| Fase | Qué queda escrito | Qué comprueba el script |
|---|---|---|
| Análisis | `input.md`; en el spec, **Actores** y **Requisitos funcionales** `RF-n` | secciones presentes, ids únicos |
| Diseño | **Diseño** y `ADR:` en el spec; `spec.ok` del humano | sección presente; confirmación más nueva que el spec |
| Desarrollo | commits atómicos (test en rojo, luego código) | commits sobre la base; worktree limpia |
| Pruebas | `gate.md` (con `COMMIT:`) | alcance, sintaxis, tests; atado al commit |
| Revisión | 4 reviews, `decision.md`, `human.md` | formato; vigencia; línea 1 coherente |
| Documentación | `jobs/<id>.md` (Resumen, Actores, RF, Diseño, Implementación, Pruebas, Lecciones), ADR `Propuesto`, `trace.md` | secciones, cita del commit del gate, ADR registrado, páginas existentes y permitidas |
| Entrega | rama `factory/<id>` y PR en borrador con código + documentación | `origin` al día; PR |

Trazabilidad que cierra el script: cada criterio cita `[RF-n]`, cada RF tiene criterio y aparece en `tasks.md`; los títulos de los tests citan el RF (lo revisan los reviewers).

## Ids descriptivos

`next-step.sh --new-id 'palabras clave'` → `<palabras>-<aammdd>-<4 hex>` (p. ej. `clamp-numeros-261104-8acd`): minúsculas, sin tildes ni palabras vacías, hasta 5 palabras y 32 caracteres, y un sufijo que evita choques de rama y worktree. Es determinista y seguro con cualquier texto (nunca produce un id inválido). Sin frase, conserva el formato antiguo `job-<ms>-<8hex>`.

## Máquina con pocos recursos

`FACTORY_LOW_RESOURCES=1` lanza los reviewers de uno en uno (`REVIEW_MAX_PARALLEL` explícito manda). No lances `node --test` completo dentro del bucle. Si WSL se cae por memoria, limita su RAM **por debajo de la total** en `C:\Users\<tú>\.wslconfig` y reinicia WSL con `wsl --shutdown`:

```ini
[wsl2]
memory=6GB      # por debajo de la RAM total de la máquina
swap=4GB
```

## Cómo aplicarlo

```bash
git switch feat/next-step
node --test tests/*.test.mjs && FORCE_COLOR=1 node --test tests/*.test.mjs   # 0 fallos
```

`node --test` a secas también recoge los `tests/` de `.worktrees/*` y `factory/worktrees/*`: el recuento sube, no es comparable. Tras fusionar, reinicia OpenCode (cambian el agente y el comando). No hace falta reinstalar la config managed: la plantilla no cambió.

## Verificado y no verificado

- **Verificado ejecutando**: la batería de `tests/next-step.test.mjs` (un caso por estado, orden, obsolescencia, rondas, ambigüedad, idempotencia y solo lectura, y dos recorridos completos de la nada a `DONE` con los scripts reales y un `gh`/`opencode` simulados), la consistencia agentes↔guard↔`next-step.sh`, y las mutaciones (quitar `spec.ok`, la obsolescencia por commit o la protección de evidencia hace fallar tests).
- **Verificado en vivo (una corrida, parche 8 inicial)**: un job real de punta a punta con OpenCode, `gh` y modelos reales llegó a `DONE` y abrió el PR #14; el Brain quedó fuera del PR y con una afirmación falsa, lo que motivó ADR-009. **Lo posterior a esa corrida (perfil `full`, `commit-brain.sh`, ids descriptivos, `PHASE:`) está verificado solo con tests.**
- **No verificado**: nada de esto se ha ejecutado contra OpenCode real, ni `gh` real, ni modelos reales. Falta la prueba en vivo de `docs/PRUEBAS-FABRICA.md` §3b y §4. En especial: que el orchestrator gratuito obedezca el bucle, y que `agent: orchestrator` y `$ARGUMENTS` en `.opencode/command/factory.md` se interpreten como se espera.
