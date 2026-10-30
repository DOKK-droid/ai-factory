---
name: orient
description: Skill de orientación del sistema: informa al usuario sobre estado actual, qué skills están instaladas, qué pipeline está activo y qué próximo paso seguir. Previene "estoy perdido en la factory".
tags: [orient, system, overview]
recommends: [factory-protocol]
profiles: [core]
origin: custom
---

# Orient — Orientación del Sistema

## Propósito

Dar al usuario una visión clara y inmediata del estado de la AI Software Factory, evitando que se pierda en la arquitectura compleja. Responde: "¿Dónde estoy? ¿Qué sigue?".

## Información que entrega

### Estado actual de la factory

```
📍 Factory Status
- Pipeline activo: <intake|spec|builder|review|approver|human-gate|memory-curator|complete>
- Job actual: <id o none>
- Revisores activos: <cuántos corriendo>

🤖 Skills Instaladas (exteriores)
- test-driven-development (obra/superpowers)
- receiving-code-review (obra/superpowers)
- code-review (getsentry/skills)
- differential-review (trailofbits/skills)

🧠 Skills Internas (03-SKILLS/)
- test-driven-development ✅
- receiving-code-review ✅
- code-review ✅
- differential-review ✅
- factory-protocol ✅
- human-gate ✅
- approver ✅
- memory-curator ✅
- spec-writer ✅
- orient ✅

📁 Estructura actual
- 02-DOCS/wiki/: <estado>
- factory/jobs/: <jobs activos>
- .opencode/agent/: <agentes configurados>

➡️ Siguiente paso recomendado
<Based on current state>
```

## Cuándo invocarla

- Al inicio de cada sesión: `opencode run --orient`
- Cuando el usuario dice "¿qué hacíamos?"
- Cuando hay cambio de contexto importante
- Antes de explicar qué skill instalar a continuación

## Integración

- Esta skill es la primera en ejecutarse en cualquier sesión
- No modifica archivos, solo reporta estado
- Consultando `.rsc.json` y `03-SKILLS/` para listar capabilities
- Formato de salida diseñado para ser legible en terminal y TUI