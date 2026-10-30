---
name: spec-writer
description: Genera spec.md + tasks.md desde una descripción SDD (Análisis de Decisiones de Software). Consulta el Brain (02-DOCS/) para arquitectura y convenciones antes de escribir.
tags: [spec-writer, sdd, documentation]
recommends: [factory-protocol, human-gate]
profiles: [core, full]
origin: custom
---

# Spec Writer — Escritor de Spec SDD

## Entrada

Una descripción de la tarea o issue, ej:
- "agregar un comentario de prueba al README"
- "corregir login con Google OAuth"
- "refactorizar componente Navbar"

## Proceso

1. **Consultar Brain** (`02-DOCS/`):
   - Arquitectura actual
   - Convenciones registradas
   - Decisiones previas (ADRs)
   - Modelos gratuitos configurados (`factory/config.json`)

2. **Generar spec.md**:
   - Superficie (Surface): `Page` o `none`
   - Objetivo: descripción clara
   - Criterios de aceptación: lista checklist
   - Contexto: por qué esta tarea existe

3. **Generar tasks.md**:
   - Desglose de tareas por subtask
   - Criterios de definición de listo (DoD) por tarea
   - Dependencies entre tareas

4. **Consultar factory-protocol**:
   - Asegurar formato consistente en reviews
   - Vincular skills aplicables (TDD, code-review, etc.)

## Salida obligatoria

### spec.md

```
# Spec SDD

## Superficie (Surface)
Page | none

## Objetivo
Descripción clara de qué se va a implementar.

## Criterios de aceptación
- [ ] ...

## Contexto
...
```

### tasks.md

```
# Tasks

## Tarea 1: <descripción>

### Descripción
...

### Criterios de definición de listo (DoD)
- [ ] test escrito primero (RED)
- [ ] código mínimo para pasar (GREEN)
- [ ] test ejecutado y VERDE
- [ ] commit atómico

### Dependencies
- Ninguna / <otras tareas>
```

## Reglas

- Nunca escribir spec sin consultar el Brain antes
- Siempre incluir `Surface: Page` o `Surface: none`
- Los criterios de aceptación deben ser testables
- Consultar `factory-protocol/SKILL.md` para formatos de salida estándar