# AI Software Factory

Factory de software con agentes sobre OpenCode, siguiendo la arquitectura del video de Eric Risco ("Programar con agentes ya no basta: monta tu Software Factory") y el RSC Harness.

## Arquitectura

```
Input → Spec Writer ←→ Brain → Builder ←→ Brain → [4 Revisores en paralelo] → Aprobador → Decisor Humano → Output/Ship → Brain
```

## Estructura

| Ruta | Propósito |
|------|-----------|
| `.opencode/agent/*.md` | Agentes OpenCode (11 agentes) |
| `.opencode/command/factory.md` | Comando `/factory` |
| `01-TOOLS/` | Scripts de orquestación y checks; `next-step.sh` decide el siguiente paso de cada job |
| `02-DOCS/` | Brain persistente (memoria) |
| `02-DOCS/wiki/` | ADR, patrones, SDD, lecciones aprendidas |
| `03-SKILLS/` | SKILL.md por agente |
| `.hooks/` | Reflexes y hooks de seguridad |
| `factory/config.json` | Mapeo tiers → modelos OpenCode |
| `factory/project.json` | Política del proyecto: `require_spec_ok`, `max_rounds`, `spec_profile` (`full`), superficies con revisión humana y páginas del Brain que lee cada agente |
| `factory/jobs/<id>/` | Traza por trabajo (auditable) |
| `factory/scripts/` | Utilidades de la factory (guard, validación de modelos, `install-into.sh`, `onboard-project.sh`) |

## Flujo de un job

El orden de los pasos no vive en un prompt: lo decide `01-TOOLS/next-step.sh <id>` (máquina de estados de solo lectura). El orchestrator repite `next-step.sh` → ejecuta lo que dice (`RUN:` o `DELEGATE:`) hasta `DONE` o `STOP:`. Un `STOP: HUMAN_CONFIRM_SPEC` espera que el humano revise el spec y cree `spec.ok`; con `spec_profile: "full"` el spec lleva actores, requisitos RF-n, diseño y ADR. Los 4 revisores se lanzan en paralelo con `launch-reviewers.sh`, el aprobador consolida y el PR sale en borrador desde `factory/<id>` con la página del Brain del job.

## Modelos

Cada rol tiene su modelo en `factory/config.json` (tiers y roles) y en el campo `model:` de `.opencode/agent/*.md`; la decisión vigente está en ADR-010 (`02-DOCS/wiki/sdd/decisions.md`). Para comprobar que los IDs existen: `npm run factory:validate-models`.

## Comandos

- `/factory "<tarea>"` — ejecuta el pipeline completo
- `/factory <id-de-job>` — reanuda un job existente
- `/factory status` — estado de los jobs de `factory/jobs/`

## Reglas

- Sin push a main salvo fast_path habilitado explícitamente
- Cada job deja traza en `factory/jobs/<id>/`
- Todos los agentes leen `02-DOCS/` antes de actuar y escriben al terminar

## Lanzadores de OpenCode

- `./factory-agent` inicia una sesión del agente con el guard activo y usa la identidad Git `factory-agent`.
- `./factory-maint` inicia una sesión de mantenimiento supervisada con acceso a archivos protegidos. Solo úsalo para cambios de configuración, permisos, guard, hooks o ramas de mantenimiento.
- Una sesión del agente no debe modificar configuración o controles de seguridad.

## Usar la fábrica en otro proyecto

`bash factory/scripts/install-into.sh <ruta-destino>` (dry-run por defecto; `--apply` instala, `--check` verifica) monta la fábrica en un repo git existente con un Brain limpio. Cada proyecto tiene su propio `02-DOCS/` y su propio check de CI. Guía completa: [docs/ONBOARDING.md](docs/ONBOARDING.md).
