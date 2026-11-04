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

## Tabla de estados (la primera condición verdadera gana)

| # | Condición | Salida |
|---|---|---|
| 0 | no existe job ni worktree | `RUN: bash 01-TOOLS/new-job.sh <id>` (a medias ⇒ `STOP: JOB_INCONSISTENT`) |
| 1 | falta/vacío `input.md` | `DELEGATE: @intake` |
| 2 | `spec.md` sin `Surface`/criterios numerados/`Alcance:` con rutas, o sin `tasks.md` | `DELEGATE: @spec-writer` |
| 3 | sin `spec.ok` (o `spec.md` más nuevo que `spec.ok`) | `STOP: HUMAN_CONFIRM_SPEC` + `CMD: touch …/spec.ok` |
| 4 | la worktree no tiene commits sobre la base | `DELEGATE: @builder` |
| 4b | worktree con cambios sin commitear | `STOP: WORKTREE_DIRTY` |
| 5 | falta `gate.md`, ilegible, sin `COMMIT:` o `COMMIT` ≠ HEAD | `RUN: cd factory/worktrees/<id> && bash 01-TOOLS/checks.sh <id>` |
| 6 | `GATE: FAIL` | `DELEGATE: @builder`, o `STOP: MAX_ROUNDS` |
| 7 | reviews de la ronda actual faltan, inválidas u obsoletas | `RUN: … launch-reviewers.sh <id> <ronda>`; `REVIEWER_FALLO` ⇒ `STOP: REVIEWER_FAILED` |
| 8 | falta `decision.md` o es más antigua que los reviews | `DELEGATE: @approver` |
| 9 | `CHANGES` / `ESCALATE` / basura | `DELEGATE: @builder` (o `STOP: MAX_ROUNDS`) / `STOP: ESCALATED` / `STOP: DECISION_INVALID` |
| 10 | falta `human.md` o es más antigua que `decision.md` | `RUN: … risk.sh <id>`; `NEEDS_HUMAN` sin resumen ⇒ `DELEGATE: @human-gate`; línea 1 incoherente ⇒ `STOP: HUMAN_LINE_INVALID` |
| 11 | `trace.md` sin línea `Brain:` o más antigua que `human.md` | `DELEGATE: @memory-curator` |
| 11b | `Surface` en `human_review_surfaces` y sin `review.ok` más nuevo que `human.md` | `STOP: HUMAN_REVIEW` |
| 12 | `origin/factory/<id>` ≠ HEAD | `RUN: git push -u origin factory/<id>` (sin `origin` ⇒ `STOP: NO_REMOTE`) |
| 13 | sin PR | `RUN: gh pr create --draft …`; sin `gh` ⇒ `STOP: HUMAN_CREATE_PR` con comando y URL |
| 14 | PR existe (o `pr.url` escrito por el humano) | `DONE` |

**Obsolescencia atada al commit**: `gate.md` lleva `COMMIT:` y `round-N/.commit` el sha revisado; si HEAD de la worktree es otro, el artefacto es obsoleto y se rehace. `decision.md`, `human.md`, `trace.md`, `spec.ok` y `review.ok` no llevan commit: se consideran vigentes solo si son **más nuevos (mtime)** que lo que los origina (reviews, decisión, human.md, spec.md). Un `touch` o un `git checkout` que cambie mtimes puede forzar que se rehagan; nunca que se salten.

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

- `require_spec_ok` (bool): exige `spec.ok` antes del builder. `FACTORY_REQUIRE_SPEC_OK=0` en **tu** entorno lo desactiva para una ejecución (el guard prohíbe a los agentes escribir ese nombre).
- `max_rounds` (entero ≥ 1): manda sobre `factory/config.json`; sin él se usa el de `config.json`, y si no existe, 3.
- `human_review_surfaces`: valores de `Surface:` que exigen `review.ok` antes de subir la rama.
- `brain.default` + `brain.agents.<agente>`: páginas (rutas relativas, sin `..`) que salen en `READ:`. Sin la clave `brain`, solo `02-DOCS/wiki/index.md`.
- Archivo ilegible o con valores ambiguos ⇒ `STOP: PROJECT_INVALID`.
- Para un proyecto nuevo, copia este archivo y ajústalo (el onboarding de multi-proyecto está en el backlog).

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
- **No verificado**: nada de esto se ha ejecutado contra OpenCode real, ni `gh` real, ni modelos reales. Falta la prueba en vivo de `docs/PRUEBAS-FABRICA.md` §3b y §4. En especial: que el orchestrator gratuito obedezca el bucle, y que `agent: orchestrator` y `$ARGUMENTS` en `.opencode/command/factory.md` se interpreten como se espera.
