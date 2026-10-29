# AI Software Factory

Factory de software con agentes sobre OpenCode, siguiendo la arquitectura del video de Eric Risco ("Programar con agentes ya no basta: monta tu Software Factory") y el RSC Harness.

## Arquitectura

```
Input → Spec Writer ←→ Brain → Builder ←→ Brain → [4 Revisores en paralelo] → Aprobador → Decisor Humano → Output/Ship → Brain
```

## Estructura

| Ruta | Propósito |
|------|-----------|
| `.opencode/agent/*.md` | Agentes OpenCode (10 agentes) |
| `.opencode/command/factory.md` | Comando `/factory` |
| `01-TOOLS/` | Scripts de orquestación y checks |
| `02-DOCS/` | Brain persistente (memoria) |
| `02-DOCS/wiki/` | ADR, patrones, SDD, lecciones aprendidas |
| `03-SKILLS/` | SKILL.md por agente |
| `.hooks/` | Reflexes y hooks de seguridad |
| `factory/config.json` | Mapeo tiers → modelos OpenCode |
| `factory/jobs/<id>/` | Traza por trabajo (auditable) |
| `factory/scripts/` | Utilidades de la factory |

## Modelos gratuitos de OpenCode (configurables en `factory/config.json`)

| Tier | Rol | Modelo |
|------|-----|--------|
| opus | Spec Writer, Builder, Approver, Human Gate | `opencode/nemotron-3.5-super-vl-free` |
| sonnet | Reviewer Código | `opencode/deepseek-v4-flash-free` |
| sol | Reviewer Seguridad, Reviewer UX | `opencode/glm-5.3-flash-free` |
| astra | Reviewer UI | `opencode/mimo-v2.6-flash-free` |

## Comandos

- `/factory "<tarea>"` — ejecuta el pipeline completo
- `/factory next` — toma el siguiente item del backlog
- `/factory status` — estado de jobs activos

## Reglas

- Sin push a main salvo fast_path habilitado explícitamente
- Cada job deja traza en `factory/jobs/<id>/`
- Todos los agentes leen `02-DOCS/` antes de actuar y escriben al terminar
