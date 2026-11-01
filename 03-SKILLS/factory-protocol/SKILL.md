---
name: factory-protocol
description: Formatos de veredicto e informe compartido por los 4 reviewers y el human-gate de la AI Factory. Define VERDICT/SCORE/APPROVE/ESCALATE/FAST_PATH/NEEDS_HUMAN y la regla "ambiguo = lado seguro".
tags: [factory, protocol, verdict, score, review]
recommends: []
profiles: [core, full]
origin: custom
---

# factory-protocol — Formatos de veredicto de la AI Factory

Este skill define los formatos estándar de veredicto e informe que usan todos los agentes de la AI Factory (4 reviewers, approver, human-gate, memory-curator). Su propósito es evitar repetir los mismos formatos en cada prompt de agente y garantizar que todo sea parseable.

## Formatos obligatorios

### Reviewer (4 revisores en paralelo)

Cada revisor deja un archivo `factory/jobs/<id>/round-N/review-<x>.md` con este formato:

```
VERDICT: PASS | CHANGES | PASS (n/a)
SCORE: 0-1

## Hallazgos
...

## Recomendaciones
...
```

**Regla**: Si `Surface: none`, reviewer-ux y reviewer-ui devuelven `PASS (n/a)` pero siempre se lanzan los 4.

### Aprobador

`factory/jobs/<id>/decision.md`:

```
APPROVE | CHANGES | ESCALATE

## Resumen de la decisión
...

## Detalle por revisor
- security: VERDICT / SCORE
- ux: VERDICT / SCORE
- ui: VERDICT / SCORE
- code: VERDICT / SCORE

## Cambios requeridos (si CHANGES)
...
```

### Human-gate

`factory/jobs/<id>/human.md`:

```
FAST_PATH | NEEDS_HUMAN

## Resumen para el humano
...

## Evidencias
...

## Checklist de revisión
- [ ] ...
- [ ] ...
```

### Regla: ambiguo = lado seguro

Cualquier valor ambiguo, falta de veredicto, o formato no reconocido se trata como:
- `CHANGES` para reviews
- `ESCALATE` para decisiones de approver
- `NEEDS_HUMAN` para human-gate

## Informe con score compartido

Los 4 reviewers usan esta plantilla de informe:

```
VERDICT: <PASS|CHANGES|PASS (n/a)>
SCORE: <0.0-1.0>

## Hallazgos
- [bloqueo|should-fix|nit] <descripción>
  where: <archivo:línea>
  why: <justificación>
  repro: <pasos para reproducir>
  fix: <cómo corregir>

## Recomendaciones
- <acción concreta>
```


## Consulta del Brain por etapa

El Brain (`02-DOCS/wiki/`) es la memoria persistente de la fabrica. Cada agente consulta las secciones relevantes antes de actuar. Solo `memory-curator` escribe en el Brain al final del job.

| Etapa | Lee Brain | Escribe Brain | Secciones relevantes |
|-------|-----------|---------------|---------------------|
| Intake | Si | No | `errors.md`, `incidents.md`, `glossary.md` |
| Spec Writer | Si | No | `constitution.md`, `decisions.md`, `glossary.md`, `lessons/` |
| Builder | Si | No | `constitution.md`, `errors.md`, `lessons/` |
| Gate | No | No | (determinista) |
| reviewer-security | Si | No | `incidents.md`, `errors.md` |
| reviewer-code | Si | No | `constitution.md`, `lessons/`, `errors.md` |
| reviewer-ux | Si | No | `lessons/` |
| reviewer-ui | Si | No | `lessons/` |
| Approver | Si | No | `decisions.md`, `lessons/`, `errors.md` |
| Complexity | Si | No | `incidents.md`, `errors.md` |
| Risk (human-gate) | Si | No | `decisions.md`, `constitution.md` |
| Memory Curator | No | Si | `decisions.md`, `lessons/`, `errors.md`, `incidents.md`, `trace.md` |

### Flujo de consulta

```
intake -> spec -> builder -> gate -> 4 reviewers -> approver -> complexity -> risk -> output -> memory-curator
   v       v       v       -       vvvv           v           v         v        -          v
 Brain   Brain   Brain           Brain           Brain      Brain     Brain              Brain
 (lee)   (lee)   (lee)           (lee)           (lee)      (lee)     (lee)            (ESCRIBE)
```

### Regla

- **Antes de actuar:** cada agente lee las secciones relevantes del Brain.
- **Al terminar:** solo `memory-curator` escribe en el Brain.

## Reglas de uso

1. Cada agente lee este skill antes de escribir su archivo de salida.
2. El primer campo de cada archivo es siempre el veredicto (línea 1).
3. Los 4 reviewers se lanzan en paralelo.
4. Cualquier review con `CHANGES` devuelve al builder (bucle, máx. `max_rounds` definido en `factory/config.json`).
5. Si `fast_path.enabled=false` (por defecto), todo trabajo requiere `NEEDS_HUMAN` o aprobación explícita antes de merge.
