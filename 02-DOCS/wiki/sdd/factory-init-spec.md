# Especificación: `/factory-init` y base documental del proyecto

Estado: borrador · Fecha: 2026-11-06 · Plan de ramas: [`factory-init-plan.md`](factory-init-plan.md)

Objetivo: en un proyecto nuevo o existente, `/factory-init` prepara el entorno y conduce un descubrimiento hasta dejar la base documental de análisis y diseño **aprobada por el humano** antes del primer job. La fábrica no depende de RSC para funcionar.

Los identificadores de esta especificación son `RF-I<n>` (requisitos) y `CA-I<n>.<m>` (criterios). No colisionan con `RF-n` (specs de jobs), `RF-F<n>` (requisitos de la fábrica) ni con los `REQ-F-n`/`REQ-NF-n`/`UC-n`/`ENT-n` de los proyectos.

## 1. Decisiones fijadas

| # | Decisión | Quién |
|---|---|---|
| D1 | El Brain no va en rama paralela: se queda en el repo, en la línea de `main`; el control es por permisos y aprobaciones. Se registra la alternativa descartada en ADR-012 | humano |
| D2 | En proyectos nuevos se instala RSC con la versión exacta `3.6.0` (nunca `@latest`), con knowledge-sync y auto-update apagados desde el primer día, y de forma que el apagado viaje en `.rsc.json` | humano |
| D3 | El inicializador es adaptativo: el modo se deriva del contenido del repo | humano |
| D4 | Comando `/factory-init`; carpeta `02-DOCS/wiki/project/` | humano, 2026-11-06 |
| D5 | Política `project_docs: off \| required`; con `required`, `next-step.sh` bloquea el spec hasta que la base esté aprobada. **Revisada (2026-11-06): todo proyecto con la fábrica instalada nace con `required`** (`install-into.sh` lo escribe en su `project.json`); `off` queda solo para la propia fábrica y para quien lo ponga a mano | humano, 2026-11-06 |
| D6 | Modelos: discovery y architect = `go-approver`; system-analyst, domain-modeler, deployment-planner = `sol`; consistency-auditor = `go-security`. `webfetch: ask` solo para discovery, sin `websearch`. **Sin A/B: es un supuesto** | humano, 2026-11-06 |
| D7 | Apagado de RSC por marcadores más `optOuts` en `.rsc.json` | humano, 2026-11-06 |
| D9 | **La documentación manda.** Ningún flujo de la fábrica empieza sin la base documental aprobada de punta a punta; todo artefacto (spec, tareas, código) deriva de ella y la cita por ID; un cambio se decide primero en la documentación, con aprobación humana, y solo después vuelve a la fábrica para realinear los artefactos (§1.1) | humano, 2026-11-06 |
| D8 | **A confirmar.** La frescura de documentos versionados se mide por hash de contenido, no por mtime (ver §5.4). Se mantiene mtime solo para marcas locales ignoradas por git (`brain.ok`) | propuesta |

### 1.1 Ciclo de cambio (D9)

| Paso | Qué ocurre | Quién | Estado |
|---|---|---|---|
| 1 | Proyecto nuevo o existente: sin base aprobada no hay spec (`STOP: HUMAN_CONFIRM_PROJECT`). `/factory-init` explora, pregunta al humano y los especialistas redactan; el humano aprueba con `project-lint approve` | humano + discovery | rama 4 (`project_docs=required` por defecto, hecho) |
| 2 | Trabajo normal: el spec cita lo que implementa (`Implementa: REQ-F-1, UC-2`); builder y approver leen la base antes de actuar | spec-writer, builder | lectura: rama 4 (`brain.agents`); `Implementa:`: rama 5 |
| 3 | Un agente ve que el código o el spec contradicen o amplían la base: **no la edita**, escribe `brain-request.md` y el job se detiene hasta `brain.ok` (humano) | builder, spec-writer, approver | rama 2 (hecho) |
| 4 | Con `brain.ok`, el especialista dueño de cada documento lo actualiza; `project-lint` valida; el humano re-aprueba (`project.ok`) | especialistas + humano | rama 2 y 4 (hecho) |
| 5 | Solo entonces vuelve la fábrica: los artefactos que citan un ID cambiado quedan **desactualizados** y se realinean (`spec.ok` del job en curso se invalida; los jobs entregados salen como «requiere revisión» en `project-status`) | next-step, spec-writer | **rama 5** (hoy no existe: `spec.ok` solo mira la fecha de `spec.md`) |
| 6 | Un cambio que no nace de un job (requisito nuevo, rediseño) se hace con un job de documentación, con las mismas aprobaciones | humano + discovery | rama 6 |

Lo que hoy **no** cubre el ciclo y las ramas siguientes deben cerrar: (a) cambiar un documento aprobado no invalida un `spec.ok` ya dado; (b) la worktree de un job lleva la base tal como estaba en la rama base al crearse, así que una base actualizada después en `main` no llega al job en curso hasta que se rebasa; (c) nada impide hoy que un humano apruebe un cambio de requisito sin pasar por un job de documentación (la protección es `project.ok` y el PR).

## 2. Alcance y no-objetivos

Dentro: plantillas, linter, índice generado, protocolo de peticiones, política, inicializador, seis agentes, instalación de RSC fijado, integración con spec y página del job, informe de estado, job de documentación, ADR.

Fuera: generar código; sustituir el spec de cada job; ejecutar nunca `sudo`, `install-managed.sh --apply`, `onboard-project.sh --apply` ni tocar `/etc/opencode` (se imprimen como pasos del humano); activar `fast_path`; cambiar `config.json`, `next-step.sh`, `command-guard.mjs`, `project.json` o `AGENTS.md` (se proponen como parche).

## 3. Requisitos

| ID | Requisito | Rama |
|---|---|---|
| RF-I1 | Existen plantillas cortas para `00-vision`, `01-requisitos`, `02-casos-de-uso`, `03-dominio`, `04-arquitectura`, `05-datos`, `06-despliegue` y `discovery`, con cabecera de estado, versión y fecha y diagramas Mermaid | 1 |
| RF-I2 | El formato de IDs, etiquetas y bloques es fijo y legible a mano (§4) | 1 |
| RF-I3 | `project-lint.mjs check` aplica las reglas de §5.1, un problema por línea, salida 0/1 | 1 |
| RF-I4 | La aprobación se registra en `project.ok` por hash de contenido; un documento editado después queda `DESACTUALIZADO` (§5.4) | 1 |
| RF-I5 | `project-lint.mjs impact` y `trace` generan el mapa «si cambias X, revisa Y» y `trazabilidad.md` (derivado, nunca a mano) | 1 |
| RF-I6 | `index.md` se genera desde las cabeceras de las páginas; no se edita a mano (§6) | 1 |
| RF-I7 | Un agente que detecta que el código contradice o amplía el Brain escribe `brain-request.md`; el job se detiene hasta `brain.ok` (§7) | 2 |
| RF-I8 | Con `project_docs: required`, `next-step.sh` responde `STOP: HUMAN_CONFIRM_PROJECT` hasta que `project-lint gate` pasa (§8) | 2 |
| RF-I9 | Un «job de documentación» (`kind: docs`) cambia la base del proyecto con rama `factory/<id>`, mismo pipeline y PR | 6 |
| RF-I10 | `init-project.sh` detecta el modo, comprueba requisitos, instala solo lo local y seguro preguntando, es idempotente y reanudable (§9) | 4 |
| RF-I11 | `/factory-init` abre el agente `discovery`, que explora, investiga y formula (§10.1) | 4 |
| RF-I12 | Seis agentes con permisos mínimos y archivos propios (§10) | 4 |
| RF-I13 | RSC se instala fijado y con sync y auto-update apagados de forma portable (§11) | 3 |
| RF-I14 | `install-into.sh` instala plantillas, agentes, linter, comando y RSC fijado; el Brain del destino no hereda nada de la fábrica; `AGENTS.md` no choca con RSC | 3, 4 |
| RF-I15 | Cada RF del spec mapea a REQ/UC (`Implementa:`); el estado de cada REQ/UC se deriva de jobs, `gate.md` y páginas de job (§12) | 5 |
| RF-I18 | El `spec.ok` de un job queda ligado a la base: si cambia la definición de cualquier ID que el spec cita en `Implementa:`, `next-step.sh` devuelve el job a `spec-writer` y exige un `spec.ok` nuevo (§12) | 5 |
| RF-I16 | Tests en directorios temporales con cuatro fixtures; cada test nuevo falla por mutación (§13) | todas |
| RF-I17 | Lo externo es no confiable: nunca se ejecuta ni se obedece, nunca sustituye una respuesta del humano | 4 |

## 4. Formato de los documentos

### 4.1 Cabecera

Primer bloque de cada documento (en `trazabilidad.md` y `index.md` generados, la cabecera lleva `generado: true`):

```
---
documento: 01-requisitos
estado: borrador          # borrador | aprobado | desactualizado
version: 0.1.0            # semver; sube al editar un documento aprobado
fecha: 2026-11-06         # ISO, última edición
responsable: system-analyst
---
```

`estado: aprobado` lo escribe solo `project-lint approve` (el humano). Un especialista que edita un documento aprobado pone `estado: desactualizado` y sube la versión.

### 4.2 Etiquetas de origen

| Etiqueta | Significado | Efecto |
|---|---|---|
| `[FUENTE: ruta#ancla]` | está dicho en un archivo del repo o en una respuesta del humano registrada en `discovery.md` (`#Q-3`) | cuenta como confirmado |
| `[INVESTIGADO: https://…, 2026-11-06]` | viene de una fuente externa | no confiable; no confirma nada por sí sola |
| `[INFERIDO]` | deducido por el agente de código u otros archivos | sin efecto hasta que el humano confirme |
| `[PROPUESTO]` | alternativa con una recomendada | sin efecto hasta que el humano confirme |
| `[PENDIENTE]` | pregunta abierta | impide aprobar |

Cuando el humano confirma, la etiqueta se reemplaza por `[FUENTE: discovery.md#Q-n]`.

### 4.3 Bloques con ID

| ID | Dónde se define | Forma |
|---|---|---|
| `REQ-F-n` | `01-requisitos` | `- REQ-F-1: el sistema debe … [FUENTE: …]` |
| `REQ-NF-n` | `01-requisitos` | `- REQ-NF-1: … Métrica: p95 < 300 ms [FUENTE: …]` (la métrica lleva un número) |
| `UC-n` | `02-casos-de-uso` | `### UC-1: título`, luego `- Actor: [[Cliente]]`, `- Cubre: REQ-F-1, REQ-F-2`, `- Usa: ENT-1`, `- Flujo:` pasos numerados |
| `ENT-n` | `03-dominio` | `### ENT-1: Pedido`, luego `- Atributos:`, `- Relaciones: ENT-2 (1..*)` |
| glosario | `03-dominio`, sección `## Glosario` | `- **Término**: definición (alias: a, b)` |

Las entidades cuentan como términos del glosario. Los términos se marcan en el texto con `[[Término]]` (el linter solo puede comprobar los marcados; el resto lo revisa `consistency-auditor`). Los bloques de código (incluido Mermaid) se ignoran en todas las reglas. `04-arquitectura` cita REQ-NF, ENT y ADR existentes; `05-datos` y `06-despliegue` citan IDs, no los redefinen.

### 4.4 Propietarios

| Archivo | Escribe | Notas |
|---|---|---|
| `00-vision`, `01-requisitos`, `02-casos-de-uso` | `system-analyst` | |
| `03-dominio`, `05-datos` | `domain-modeler` | |
| `04-arquitectura` y ADR del proyecto en `sdd/decisions.md` | `architect` | |
| `06-despliegue` | `deployment-planner` | |
| `discovery.md` | `discovery` | hallazgos `H-n`, propuestas `P-n`, preguntas `Q-n` por rondas |
| `trazabilidad.md` | `project-lint trace --write` | generado |
| `project.ok` | `project-lint approve` | solo el humano; protegido por el guard |

## 5. `project-lint.mjs`

### 5.1 Reglas

Formato de salida: `<CÓDIGO> <E|W> <archivo>:<línea> <mensaje>`. Sale con 1 si hay algún `E`.

| Código | Sev. | Regla |
|---|---|---|
| PL001 | E | cabecera ausente o con claves que faltan |
| PL002 | E | `estado` no es borrador, aprobado o desactualizado |
| PL003 | E | `version` no es semver o `fecha` no es ISO |
| PL004 | E | `documento:` no coincide con el nombre del archivo |
| PL005 | E | documento ausente (solo con `--strict` y en `gate`) |
| PL010 | E | ID mal formado (`REQ-F-x`, `REQ-3`, …); `REQ-F` y `REQ-NF` sin número son nombres de tipo y se aceptan |
| PL011 | E | ID definido más de una vez (en uno o en dos documentos) |
| PL012 | E | ID definido fuera de su documento propietario |
| PL013 | E | aparece `RF-n` o `RF-F<n>` en un documento de proyecto |
| PL020 | E | referencia a un ID que no existe |
| PL021 | E | `REQ-F` que ningún UC cubre |
| PL022 | E | UC sin `Cubre:` o con `Cubre:` vacío |
| PL023 | E | ENT que no usa ningún UC ni REQ |
| PL024 | E | `REQ-NF` sin métrica numérica |
| PL025 | E | `REQ-NF` sin referencia desde `04` o `06` |
| PL026 | E | ENT sin entrada en `05-datos` (ni la nota `No persiste`) |
| PL030 | E | bloque con ID sin ninguna etiqueta de origen |
| PL031 | E | `[FUENTE: ruta#ancla]` cuya ruta o ancla no resuelve |
| PL032 | E | `[INVESTIGADO]` sin URL https o sin fecha ISO |
| PL033 | E | `[PENDIENTE]`, `[PROPUESTO]` o `[INFERIDO]` en un documento aprobado |
| PL034 | E | bloque con ID de un documento aprobado sin `[FUENTE]` |
| PL040 | E | `[[Término]]` fuera del glosario |
| PL041 | E | término de glosario repetido |
| PL050 | E | documento aprobado cuyo hash cambió (`DESACTUALIZADO`) |
| PL051 | E | documento aprobado que cita un ID cuyo bloque cambió o ya no existe |
| PL052 | W | contenido cambiado sin subir la versión |
| PL053 | E | la cabecera dice `aprobado` sin registro en `project.ok`, o al revés |
| PL054 | E | `project.ok` no es un JSON válido con `docs` (nunca se interpreta como aprobación) |
| PL060 | W | texto de un REQ repetido literalmente en otro documento («un hecho, un documento») |
| PL061 | E | `trazabilidad.md` existe y no coincide con lo generado |
| PL070 | E | marcador `RELLENAR` en un documento aprobado |

Se ignoran los bloques de código, los comentarios HTML y el código en línea. Las reglas de cobertura (PL021, PL022, PL023, PL025, PL026) se evalúan solo entre documentos sin marcador `RELLENAR`, para poder avanzar documento a documento; `gate` y `check --strict` las exigen todas. Implementado en la rama 1 (`feat/project-docs-base`): 40 tests y 39 mutaciones, todas detectadas.

### 5.2 Comandos

```
node factory/scripts/project-lint.mjs check   [--dir <carpeta>] [--strict]
node factory/scripts/project-lint.mjs state   [--dir <carpeta>]      # KEY=VALUE, lo consume init-project.sh
node factory/scripts/project-lint.mjs impact  <ID|documento>         # si cambias X, revisa Y
node factory/scripts/project-lint.mjs trace   [--write]              # trazabilidad.md
node factory/scripts/project-lint.mjs approve <documento...>         # humano: registra hash y estado
node factory/scripts/project-lint.mjs gate                           # 0 si los 7 documentos están aprobados y frescos
```

`--dir` por defecto: `02-DOCS/wiki/project`. `approve` se niega si el documento tiene errores `E` o dependencias sin aprobar.

### 5.3 `state`

Estado por documento, derivado de archivos: `PLANTILLA` (tiene `RELLENAR`), `BORRADOR`, `PENDIENTE` (con `[PENDIENTE]`), `LISTO` (sin errores, sin aprobar), `APROBADO`, `DESACTUALIZADO`. Salida:

```
DOC 01-requisitos LISTO
PENDIENTES=<n abiertos en discovery.md y documentos>
PROJECT=none|partial|complete|stale
NEXT=<documento> OWNER=<agente>
```

`complete` exige siete documentos `APROBADO` y cero pendientes; `stale` si alguno está `DESACTUALIZADO`; `none` si no existe la carpeta o todo es `PLANTILLA`. No hay contador aparte: volver a ejecutar recalcula todo.

### 5.4 Aprobación y frescura (desviación D8)

La petición original fija la frescura por mtime «como `spec.ok`». Eso funciona para `spec.ok` porque vive en `factory/jobs/` (ignorado por git, local). Los documentos del proyecto están versionados y viajan por PR: tras `git clone` o `git checkout` el orden de mtime se pierde (comprobado: tras clonar, dos archivos con 1 s de diferencia quedan a ~1 ms y en orden arbitrario). Por eso:

- `02-DOCS/wiki/project/project.ok` es un JSON versionado que escribe solo `approve`:
  ```json
  {"version":1,"docs":{"01-requisitos":{"sha256":"…","version":"1.0.0","fecha":"2026-11-06","refs":{"REQ-F-1":"…","ENT-2":"…"}}}}
  ```
- `sha256` es el hash del cuerpo (sin cabecera, con saltos de línea y espacios finales normalizados). `refs` guarda, por cada ID **citado** (no definido) por el documento, el hash de su bloque de definición.
- Un documento está fresco si su hash coincide **y** todos sus `refs` siguen coincidiendo. Si cambia `REQ-F-3`, solo quedan `REVISAR` los documentos que lo citan, no toda la base.
- El guard protege `project.ok` igual que `spec.ok`: ningún agente puede escribirlo.
- `brain.ok` sí es local y usa mtime (más reciente que `brain-request.md`), porque vive en `factory/jobs/`.

Si prefieres mtime también para los documentos, solo cambia §5.4 y la regla PL050/PL051; el resto de la especificación no depende de ello.

## 6. `gen-index.mjs`

`node factory/scripts/gen-index.mjs --check|--write [--wiki 02-DOCS/wiki]`. Recorre `**/*.md` del wiki (sin `index.md`), toma `title` y `description` de la cabecera de cada página o, si no los tiene, el primer `# ` y su primera frase, y escribe `index.md` ordenado por ruta; las páginas de `jobs/` van agrupadas y ordenadas de la más reciente a la más antigua. Es determinista (misma entrada, mismo texto) para que dos jobs concurrentes que añaden páginas distintas no choquen en `index.md`: el conflicto se resuelve regenerando. `--check` sale 1 si `index.md` no coincide. En la rama 1 el generador existe y se prueba, pero el `index.md` de la fábrica no cambia.

## 7. Protocolo de peticiones al Brain

Dos clases de contenido:
- **Ejecución**: página del job, trace, lecciones. Las escribe `memory-curator` sin confirmación; se revisan en el PR.
- **Normativo**: REQ, UC, dominio, arquitectura, ADR. Solo los agentes de documentación escriben; builder, reviewers, approver, human-gate y orchestrator solo leen.

Petición: `factory/jobs/<id>/brain-request.md`, un bloque `## BR-n` por petición con los campos `Documento`, `Ids`, `Solicitante`, `Cita`, `Motivo` y `Cambio propuesto` (todos obligatorios; `Documento` es uno de los siete o `decisions`; `Ids` pertenecen a ese documento, o `-` si es contenido nuevo). Los escriben `builder`, `spec-writer` y `approver`; los reviewers no escriben: reportan el hallazgo en su informe con `CHANGES` y lo registra el approver. El builder además no puede escribir `02-DOCS/wiki/project/` ni `brain.ok` (antes podía: su permiso `edit` era `*: allow` con excepciones).

Toda la lógica vive en `factory/scripts/brain-request.mjs state`, que `next-step.sh` solo traduce (bloque 1b, tras el estado 1 y antes del 2). La primera palabra de su respuesta decide:

| Respuesta | Qué hace `next-step.sh` |
|---|---|
| `NONE`, `DONE` | sigue el flujo normal |
| `INVALID` o cualquier otra cosa (vacía, error de node) | `STOP: BRAIN_REQUEST_INVALID` (fallar hacia el lado seguro) |
| `CONFIRM` | `STOP: HUMAN_CONFIRM_BRAIN`, con `CMD: touch factory/jobs/<id>/brain.ok`. Solo cuenta si `brain.ok` es más nuevo que la petición |
| `APPLY BR-n` | `DELEGATE` al dueño del documento (`decisions` → `architect`) para editar en la worktree |
| `COMMIT [BR-n]` | `RUN` de `commit-brain.sh <id> --project [BR-n]`: commit acotado a `02-DOCS/wiki/project/` y `decisions.md`; con BR-n lleva la línea `Brain-Request: BR-n` |
| `ALIGN` | `DELEGATE` al dueño de un documento aprobado que `project-lint` marca con errores tras el cambio |
| `REAPPROVE` | `STOP: HUMAN_CONFIRM_PROJECT` con el `CMD` de `project-lint approve` para los documentos desactualizados |

«Aplicada» = existe un commit con `Brain-Request: BR-n` entre la base del job y `HEAD`; así una petición con el mismo número en otro job no cuenta. Solo se vigilan los documentos que ya tienen aprobación registrada: un error en un borrador no genera `ALIGN`. Los commits que solo tocan la base documental no cuentan como trabajo del builder (estado 4) ni invalidan el gate (`lib.sh`), y no hace falta que figuren en `Alcance:`; su aprobación es humana (`project.ok`). El approver no llega a `APPROVE` con una petición pendiente porque el bloque 1b se evalúa antes que el estado 8 en cada llamada.

Riesgo residual: los tres agentes con permiso sobre `brain-request.md` podrían borrarlo; OpenCode no ofrece permiso de «solo añadir». Las peticiones aplicadas quedan en el historial de git.

Cambios de proyecto sin job (requisitos nuevos, rediseños): se hacen con un job de documentación (RF-I9).

## 8. Política `project_docs`

`factory/project.json`: `"project_docs": "off" | "required"`; ausente = `off`. Con `required` (y, desde la rama 6, un job que no es `kind: docs`), `next-step.sh` ejecuta `project-lint gate --root <worktree>` antes del estado 2 (bloque 1c) y, si falla, `STOP: HUMAN_CONFIRM_PROJECT` con el resultado del gate en `WHY:` y, solo si hay documentos en estado `LISTO`, `CMD: node factory/scripts/project-lint.mjs approve <esos documentos>` (lo ejecuta el humano; el guard impide que lo ejecute un agente). Un valor inválido es `PROJECT_INVALID` (fallar hacia el lado seguro). `/factory-init` termina imprimiendo el diff de una línea que pone `required`; lo aplica el humano.

## 9. `init-project.sh`

`bash factory/scripts/init-project.sh [--dir <proyecto>] [--apply <paso>] [--yes]`. Dry-run por defecto: informa, no escribe. Salida `CLAVE=valor`, una por línea, más líneas `STEP:`/`MANUAL:` legibles.

### 9.1 Modo (derivado, no guardado)

| Variable | Valores |
|---|---|
| `CONTENT` | `A` vacío (ni código ni `.md` salvo los de la fábrica) · `B` con `.md` y sin código · `C` con código |
| `FACTORY` | `installed` (existen `factory/project.json` y `01-TOOLS/next-step.sh`) · `missing` |
| `PROJECT` | el de `project-lint state` |
| `MODE` | `D` si `FACTORY=installed` y `PROJECT` es `partial` o `stale`; si no, `CONTENT` |

Se ignoran `.git`, `node_modules`, `.worktrees`, `factory/worktrees`, `.rsc`, `.opencode`, `01-TOOLS`, `03-SKILLS`, `02-DOCS/wiki/{sdd,harness,project}`. Código = extensiones de lenguaje conocidas y manifiestos (`package.json`, `pyproject.toml`, `go.mod`, …). Sin la fábrica instalada y con una ruta de destino, delega en `install-into.sh` (dry-run; `--apply` explícito).

### 9.2 Requisitos

| Comprobación | Si falla |
|---|---|
| `node` ≥ 20, `git` | error |
| `opencode` | error |
| `gh` y `gh auth status` | aviso (hace falta para el PR) |
| modelos: `node factory/scripts/validate-models.mjs --config` | aviso con la salida |
| runner de tests: `package.json` con `scripts.test` real, o `FACTORY_TEST_CMD`, o `gate.test_cmd` | aviso (el gate fallará sin él) |

### 9.3 Pasos (cada uno se aplica por separado: `--apply deps|hooks|rsc|workspace`)

| Paso | Qué hace | Nota |
|---|---|---|
| `deps` | `npm ci` si hay `package-lock.json`; en otros gestores solo imprime el comando | |
| `hooks` | `npm run hooks:install` o `bash .hooks/install-git-hooks.sh` | |
| `rsc` | `rsc-pin.sh --apply` | §11 |
| `workspace` | crea el job de documentación `init-<aammdd>-<4 hex>` con `new-job.sh` (rama `factory/<id>`, worktree) | si ya hay uno abierto con ese prefijo, lo reutiliza (`JOB=<id>`) |

«Preguntando antes»: el agente `discovery` tiene `ask` sobre `init-project.sh --apply*`, así que cada paso exige la aprobación del humano en OpenCode; el script no pide nada por su cuenta.

Nunca ejecuta `sudo`, `install-managed.sh --apply`, `onboard-project.sh --apply` ni toca `/etc/opencode`: los imprime como `MANUAL:`. Idempotencia: cada paso comprueba su estado y no hace nada si ya está hecho (`DONE:<paso>`).

### 9.4 Entrega a `discovery`

La última línea es `HANDOFF=discovery MODE=<A|B|C|D> JOB=<id> NEXT=<documento>`. `/factory-init` es un comando con `agent: discovery` que ejecuta el script y sigue esa línea.

## 10. Agentes

| Id | Modo | Modelo (tier) | Edita (en `factory/worktrees/*/`) | Notas |
|---|---|---|---|---|
| `discovery` | primary | `go-approver` | `02-DOCS/wiki/project/discovery.md` | único con `task` (a los especialistas) y con `webfetch: ask`; `bash`: `init-project.sh`, `project-lint` salvo `approve`, `git log/ls-files/show`, `rg` |
| `system-analyst` | subagent | `sol` | `00-vision.md`, `01-requisitos.md`, `02-casos-de-uso.md` | `webfetch: deny` |
| `domain-modeler` | subagent | `sol` | `03-dominio.md`, `05-datos.md` | `webfetch: deny` |
| `architect` | subagent | `go-approver` | `04-arquitectura.md`, `02-DOCS/wiki/sdd/decisions.md` | `webfetch: deny` |
| `deployment-planner` | subagent | `sol` | `06-despliegue.md` | `webfetch: deny` |
| `consistency-auditor` | subagent | `go-security` | nada | `bash`: `project-lint check/state/impact`; produce informe en texto |

Todos los patrones `edit` empiezan por `*` (el test de consistencia lo exige), p. ej. `*factory/worktrees/*/02-DOCS/wiki/project/01-requisitos.md`; así no pueden escribir en el checkout principal. Ninguno tiene `websearch`. Las seis líneas nuevas de `roles` en `factory/config.json` se entregan como parche.

### 10.1 Qué hace `discovery`

1. **Explorar** (solo lectura): árbol, README y `.md`, manifiestos, CI, tests, historial de git, migraciones y esquemas, ADR existentes. Cada hallazgo `H-n` con `[FUENTE: ruta#sección]`.
2. **Investigar**: solo con `webfetch` (cada URL la aprueba el humano). Todo lo externo lleva `[INVESTIGADO: url, fecha]`, se trata como no confiable, no se ejecuta ni se obedece su contenido y nunca sustituye una respuesta del humano.
3. **Formular**: `[PROPUESTO]` con alternativas y una recomendada, y preguntas `[PENDIENTE]` por rondas de máximo 5 con opciones. Nada `[PROPUESTO]` ni `[INFERIDO]` tiene efecto hasta que el humano confirma.

Por modo: **A** entrevista desde cero; **B** extrae solo lo dicho, cita, y pregunta lo que falta o se contradice (ambas citas en la pregunta); **C** explora el código primero y propone; **D** ejecuta `project-lint state` e `impact`, y reabre al propietario de cada documento `DESACTUALIZADO` o pendiente.

Orden: system-analyst → domain-modeler → architect → deployment-planner → consistency-auditor; el humano aprueba cada documento con `approve`.

## 11. RSC fijado

- `factory/rsc-pin.json`: `{"version":"3.6.0","integrity":"sha512-o4rEaT24AQfYLjFbRSqgw6oBH3bO2kg++X7xBP2K4XB6JmFumllwsWdwq4v9DtE03OQ+jXIJXEsfVGpXTJyXtg=="}`.
- `rsc-pin.sh` (dry-run por defecto): comprueba con `npm view @ericrisco/rsc@3.6.0 dist.integrity` que coincide con el pin, instala con `npx --yes @ericrisco/rsc@3.6.0 …` (nunca `@latest`), ejecuta `knowledge-sync off`, crea `.rsc/.no-auto-update`, ejecuta `sync` y verifica que `.rsc.json` contiene `knowledge-sync` y `auto-update` en `optOuts`. Si no, falla.
- Verificado leyendo el código de RSC 3.6.0 (`targets/opt-outs.js`): ambos están en `PROJECT_OPT_OUTS`. **Verificado ejecutando RSC 3.6.0 real en directorios temporales (rama 3), en ambos órdenes**: `sync` registra `auto-update` en `optOuts` cuando existe `.rsc/.no-auto-update` (y `knowledge-sync off` registra `knowledge-sync`); `onboard` conserva el `AGENTS.md` previo y añade su bloque entre marcadores. Hallazgos que cambian el diseño:
  - `onboard` no es un «instalar»: pide `--technical-level` y `--goal`, imprime un plan con su id sin escribir nada y solo instala con `--accept-plan <id>`. `rsc-pin.sh --apply` no inventa las respuestas: sin ellas sale 2; con ellas, la primera pasada muestra el plan y sale 3; la segunda, con el id, instala.
  - En un proyecto nuevo RSC activa `gitPermissions` y **reescribe `opencode.json`**: cambia `git push: deny` por `allow` y `git push --force*` por `ask`; con `git-permissions off` quita sus claves sin devolver las de la fábrica. `rsc-pin.sh` ejecuta `git-permissions off`, guarda `opencode.json` antes y lo restaura después, y `--check` falla si en el `opencode.json` de la fábrica falta `git push: deny`. El muro real sigue siendo la config managed de `/etc/opencode`.
  - Los marcadores `.rsc/.no-*` son locales (`.rsc/` está ignorado); lo que viaja con el repo es `.rsc.json`. `--check` los trata como aviso, no como error.
  - `install-into.sh --check` comparaba `AGENTS.md` byte a byte y fallaba tras instalar RSC; ahora ignora el bloque `rsc-suggest`.
  - Además: un `rsc sync` manual posterior vuelve a reescribir `opencode.json`; `rsc-pin.sh --check` (y `install-into.sh --check`) lo detectan.
- `AGENTS.md`: el instalador nunca sobrescribe el existente (deja `AGENTS.factory.md`); RSC escribe entre marcadores. Un test prueba que el bloque de RSC y el contenido previo sobreviven.
- La fábrica funciona sin RSC: todo paso de RSC es opcional y ningún script de la fábrica lo invoca salvo `rsc-pin.sh`.

## 12. Ligadura con la fábrica

- Cada RF del spec (perfil `full`) termina con `Implementa: REQ-F-1, UC-2`. `spec-lint` lo exige y comprueba que los IDs existen cuando la política es `required` y hay documentos aprobados.
- La página del job lleva la línea `Implementa: …` (unión de las del spec); `next-step.sh` la valida en `brain_problem`.
- **Realineación (RF-I18).** Al confirmar el spec (`spec.ok`), `next-step.sh` ejecuta `project-lint stamp <job>`, que guarda en `factory/jobs/<id>/implementa.lock` el hash de cada bloque citado en `Implementa:` (el mismo hash por bloque que `project.ok` usa en `refs`). En cada llamada compara; si algún bloque cambió o desapareció responde `DELEGATE: @spec-writer` con los IDs afectados y borra la confirmación pendiente (hace falta un `spec.ok` nuevo). El archivo lo escribe el script y el guard lo protege como `gate.md`. Cambios en `next-step.sh` y `command-guard.mjs`: parche para el humano.
- `project-status.mjs [--json]` (solo lectura) deriva el estado de cada REQ/UC: `sin job` · `en curso (job X)` · `implementado (job X, PR, commit del gate, tests)`. Fuentes: `factory/jobs/*/spec.md`, `gate.md`, `pr.url` y `02-DOCS/wiki/jobs/*.md`. Fuera del equipo local `gate.md` no existe (los jobs están ignorados por git): entonces cita el commit que figura en la página del job y marca la evidencia como «no verificable aquí». Nada se escribe a mano.

## 13. Tests y mutaciones

Todos en directorios temporales (`tmp()` de `tests/helpers.mjs`), sin red, con `FORCE_COLOR=0` y `=1`.

Fixtures de `init-project.sh`: **vacío**; **con `.md`**; **con código**; **fábrica instalada con base parcial**. Más: «RSC instalado, sync apagado, `AGENTS.md` respetado» (con un `npx` simulado en el `PATH`).

Cada código `PLxxx` tiene un test que lo provoca y otro que comprueba que el caso válido no lo dispara. Mutaciones a verificar (se aplican a una copia y el test correspondiente debe fallar):

| Regla | Mutación |
|---|---|
| PL011 | no detectar el ID duplicado |
| PL020 | tratar toda referencia como existente |
| PL021/022 | invertir el sentido de `Cubre:` |
| PL031 | aceptar cualquier ruta en `[FUENTE]` |
| PL033 | ignorar `[PENDIENTE]` si el estado es aprobado |
| PL040 | aceptar términos fuera del glosario |
| PL050/051 | comparar solo la cabecera, no el hash |
| `gate` | devolver 0 con un documento `DESACTUALIZADO` |
| `gen-index` | ordenar por fecha de modificación en vez de por ruta |
| `init-project.sh` | llamar a `sudo` o a `onboard-project.sh --apply` (un `PATH` con espías debe registrar 0 llamadas) |
| modo | clasificar `.md` como código |
| `rsc-pin.sh` | usar `@latest` |

## 14. Riesgos y puntos abiertos

| Riesgo | Mitigación |
|---|---|
| D8: mtime frente a hash | propuesto hash; si lo rechazas, cambia §5.4 |
| `permission.task` y `webfetch: ask` de OpenCode no están verificados | se comprueban con `opencode debug agent <id>` en la rama 4 antes de depender de ellos |
| `/init` propio de OpenCode (supuesto, no verificado) | no hay colisión: el comando se llama `/factory-init` |
| Tests que dependen de parches a archivos protegidos | `skip` explícito condicionado + verificación en worktree temporal |
| Modelos sin A/B | revisar tras el primer proyecto real; cambiar un modelo es editar `config.json` |
| El job de documentación (rama 6) toca el plano de control | va el último y con parche revisable |
| `[FUENTE]` de respuestas humanas apunta a `discovery.md`, que escribe un agente | el humano las ve al aprobar; el linter solo comprueba que el ancla existe, no que la respuesta sea fiel |
| Límite del linter | no detecta términos sin marcar ni afirmaciones falsas con etiqueta correcta; lo cubre la revisión humana y `consistency-auditor` |

## 15. Trazabilidad

| Requisito | Rama | Criterio de aceptación |
|---|---|---|
| RF-I1, I2 | 1 | CA-I1.1 cada plantilla pasa `check` en modo plantilla; CA-I1.2 una plantilla rellenada correctamente pasa `check --strict` |
| RF-I3 | 1 | CA-I3.1 cada código PLxxx tiene un test que falla por mutación |
| RF-I4, I5 | 1 | CA-I4.1 editar un documento aprobado produce PL050; CA-I5.1 cambiar `REQ-F-3` marca solo los documentos que lo citan |
| RF-I6 | 1 | CA-I6.1 dos páginas añadidas en orden distinto producen el mismo `index.md` |
| RF-I7, I8 | 2 | CA-I7.1 petición sin `brain.ok` → `HUMAN_CONFIRM_BRAIN`; CA-I7.2 con `APPROVE` y petición pendiente no se avanza; CA-I8.1 `required` sin base aprobada → `HUMAN_CONFIRM_PROJECT` |
| RF-I13, I14 | 3 | CA-I13.1 `.rsc.json` contiene los dos `optOuts`; CA-I14.1 `AGENTS.md` previo intacto |
| RF-I10, I11, I12, I17 | 4 | CA-I10.1 las cuatro fixtures dan el `MODE` esperado; CA-I10.2 repetir el script no cambia nada; CA-I10.3 cero llamadas a `sudo` |
| RF-I18 | 5 | CA-I18.1 cambiar `REQ-F-3` tras `spec.ok` devuelve el job a `spec-writer`; CA-I18.2 cambiar `REQ-F-9`, que el spec no cita, no lo toca |
| RF-I15 | 5 | CA-I15.1 RF sin `Implementa:` → error de `spec-lint`; CA-I15.2 el estado de un REQ cambia al aparecer su job |
| RF-I9 | 6 | CA-I9.1 un job `docs` llega a PR sin builder |
| RF-I16 | todas | informe de mutaciones por rama |
