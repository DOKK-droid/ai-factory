# Plantilla de spec de un job de documentación (`kind: docs`)

Un job de documentación cambia la base del proyecto (`02-DOCS/wiki/project/`) sin escribir código. Su spec es corto pero detallado: dice **qué** documentos cambian, **quién** los escribe y **cómo se comprueba**. `next-step.sh` lo valida con `spec-lint.mjs` (perfil `docs`): estructura, no acierto. No lleva `Actores`, `RF-n` ni `Implementa:` (eso es del spec de un job de código).

Copia esta estructura en `factory/jobs/<id>/spec.md` y `tasks.md`. Los IDs del ejemplo son los de una base de muestra; sustitúyelos por los reales (los que existen salen de `node factory/scripts/project-lint.mjs impact <ID>` y `state`; lo que citan los jobs, de `node factory/scripts/project-status.mjs`).

```markdown
# Spec — Cambio documental: cancelar pedidos

Surface: none
ADR: none                <!-- none, o el título de la decisión de arquitectura que toma este cambio (entonces la tabla lleva una fila `decisions` → architect) -->

## Objetivo
Permitir que el cliente cancele un pedido antes del despacho. Nace de factory/jobs/<id>/input.md (petición del humano): hoy ninguna parte de la base lo contempla.

## Cambio solicitado
- Modificar REQ-F-1 en 01-requisitos: el pedido puede cancelarse mientras no esté despachado.
- Añadir un caso de uso nuevo en 02-casos-de-uso que cubra esa cancelación.
- Modificar ENT-1 en 03-dominio: el pedido tiene un estado de cancelación.

## Documentos afectados
| ID | Documento | Agente |
|---|---|---|
| REQ-F-1, nuevo | 01-requisitos | system-analyst |
| nuevo | 02-casos-de-uso | system-analyst |
| ENT-1 | 03-dominio | domain-modeler |

## Impacto en jobs
- Los jobs que citan REQ-F-1 o ENT-1 en `Implementa:` quedarán «requiere revisión» (ninguno hoy, según project-status.mjs).

## Criterios de aceptación
1. REQ-F-1 queda definido en 01-requisitos con la cancelación y cubierto por un caso de uso.
2. ENT-1 en 03-dominio refleja el estado de cancelación y 05-datos lo sigue citando.
3. `node factory/scripts/project-lint.mjs check --strict` sin errores.
4. Ningún [PENDIENTE], [PROPUESTO] ni [INFERIDO] sin resolver en los documentos tocados.

## Alcance
- 02-DOCS/wiki/project/**
```

`tasks.md`: una tarea por documento afectado, con su dueño:

```markdown
- [ ] T1 (01-requisitos, system-analyst): modificar REQ-F-1 y añadir el requisito de cancelación, con [FUENTE]
- [ ] T2 (02-casos-de-uso, system-analyst): caso de uso nuevo que cubra el requisito
- [ ] T3 (03-dominio, domain-modeler): estado de cancelación en ENT-1
```

Con un ADR añade también `- 02-DOCS/wiki/sdd/decisions.md` al `Alcance` y la fila `| nuevo | decisions | architect |` a la tabla.

## Reglas que comprueba `spec-lint` (perfil `docs`)

- Primera línea `# Spec — Cambio documental: <título>`; `Surface: none`; línea `ADR:`.
- Secciones presentes y no vacías: `Objetivo`, `Cambio solicitado`, `Documentos afectados`, `Impacto en jobs`, `Criterios de aceptación` (numerados) y `Alcance`.
- `Documentos afectados`: una tabla `ID | Documento | Agente`. Cada ID existe en la base o es `nuevo`; el documento es uno de los siete (`00-vision` … `06-despliegue`) o `decisions`; el agente es el dueño de ese documento (`system-analyst`: 00, 01, 02; `domain-modeler`: 03, 05; `architect`: 04 y `decisions`; `deployment-planner`: 06).
- `Alcance`: solo rutas dentro de `02-DOCS/wiki/project/`; `02-DOCS/wiki/sdd/decisions.md` solo si hay ADR (y entonces la tabla lleva su fila `decisions`). Nunca `**` global ni nada fuera de la base.
- `tasks.md` nombra cada documento afectado.

## Cómo sigue el job

Con el spec confirmado (`spec.ok`), los agentes dueños de cada documento lo editan en la worktree (no el builder), `commit-brain.sh --project` lo commitea, el gate es `project-lint check --strict` más alcance, y los reviewers, el approver y el human-gate son los de siempre. Al final el humano aprueba la base con `cd factory/worktrees/<id> && node factory/scripts/project-lint.mjs approve <documentos>` y el job sigue hasta el PR. Lo que el humano no confirmó queda `[PENDIENTE]` o `[PROPUESTO]` y el gate no pasa hasta que lo resuelva.
