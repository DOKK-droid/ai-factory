---
name: human-gate
description: Decisor humano determinista que evalúa FAST_PATH vs NEEDS_HUMAN. Regla: ambiguo = lado seguro. Consulta siempre al humano antes de merge a main.
tags: [human-gate, decision, factory]
recommends: [factory-protocol]
profiles: [core, full]
origin: custom
---

# Human-Gate — Decisor Humano Determinista

## Formatos

### human.md

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

## Regla: ambiguo = lado seguro

Cualquier valor ambiguo, falta de veredicto, o formato no reconocido se trata como:

- `CHANGES` para reviews
- `ESCALATE` para decisiones de approver
- `NEEDS_HUMAN` para human-gate

## Uso

- Si `fast_path.enabled=true` (explicitamente habilitado por humano): puede autorizar merge directamente
- Si `fast_path.enabled=false` (por defecto): todo trabajo requiere `NEEDS_HUMAN` o aprobación explícita antes de merge
- El human-gate siempre se lanza después de los 4 reviewers paralelos