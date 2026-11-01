---
name: approver
description: Consolidación de los 4 reviewers (security, ux, ui, code) y decisión final: APPROVE | CHANGES | ESCALATE. Bucle al builder si CHANGES, máximo max_rounds definido en factory/config.json.
tags: [approver, decision, factory]
recommends: [factory-protocol, differential-review, code-review]
profiles: [core, full]
origin: custom
---

# Aprobador — Decisión Consolidada

## Formato

### decision.md

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

## Justificación del ESCALATE
cuando algún reviewer entregue ESCALATE o cuando hay desacuerdos irreconciliables entre veredictos
```

## Flujo de Decisión

1. **APPROVE**: Todos los 4 reviewers votaron PASS, no hay cambios críticos. Listo para merge (solo si fast_path habilitado).

2. **CHANGES**: Algun(s) reviewer(s) votaron CHANGES. Regresa al builder para nuevas iteraciones. Bucle máximo `max_rounds` (default: 3) definido en `factory/config.json`.

3. **ESCALATE**: Algun(s) reviewer(s) votaron ESCALATE, o hay conflictos entre veredictos. El approver decide si:
   - Regresa al builder para rework mayor
   - O pasa directamente al human-gate como `NEEDS_HUMAN`
   - O en casos críticos: bloquea el merge permanentemente

## Integración con factory-protocol

El approver debe leer los archivos de los 4 reviewers en el formato estándar:
```
VERDICT: PASS | CHANGES | PASS (n/a)
SCORE: 0-1
```