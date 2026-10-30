---
name: memory-curator
description: Actualiza la memoria persistente (Brain) y el trace.md después de cada job completado. Sincroniza 02-DOCS/wiki/ con conclusiones, convenciones y decisiones tomadas.
tags: [memory-curator, documentation, brain]
recommends: [factory-protocol]
profiles: [core, full]
origin: custom
---

# Memory Curator — Curador de Memoria

## Responsabilidades

Después de cada job completado (aprobado o con CHANGES), el memory-curator actualiza:

### 1. `02-DOCS/wiki/index.md`
- Agregar nuevo tópico si es necesario (nueva convención, decisión Arquitectura, etc.)
- Vincular desde páginas existentes

### 2. `02-DOCS/wiki/constitution.md` (o similar)
- Actualizar convenciones de código si los reviewers detectaron incumplimientos
- Registrar nuevas decisiones ADR (Architecture Decision Records)

### 3. `trace.md` del job completado
- Issue/Error → Spec → Branch → PR → Reviews → Decisión → Resultado final
- Veredicto final (APPROVE/CHANGES/ESCALATE/NEEDS_HUMAN)
- Lecciones aprendidas

### 4. `factory/backlog.md`
- Marcar tareas completadas
- Agregar próximas tareas detectadas durante el job

## Formato de actualización

```
# Job: <id> - <resultado>

## Cierre
- Veredicto final: <APPROVE|CHANGES|ESCALATE|NEEDS_HUMAN>
- Round completado en: <N>
- Humanos involucrados: <sí/no>

## Conventions actualizadas
- <nueva convención o cambio>
- <archivo:línea> actualizado

## Lessons learned
- <what went well>
- <what could improve>

## Next steps
- <siguientes jobs en backlog>
- <proyectos hijo que requieren onboarding>
```

## Ejecución

Se invoca automáticamente después de que el human-gate resuelva (aprobado o NEEDS_HUMAN). Nunca se ejecuta antes del human-gate.