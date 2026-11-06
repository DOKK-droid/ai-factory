# 02-DOCS/wiki/index.md

## Knowledge map

| Topic | Where | What |
|-------|-------|------|
| constitution | `02-DOCS/wiki/sdd/constitution.md` | Principios no negociables de la AI Factory |
| arquitectura | `02-DOCS/wiki/sdd/constitution.md` | Stack canon, calidad, convenciones, branching |
| ADRs | `02-DOCS/wiki/sdd/decisions.md` | Decisiones de arquitectura (ADR-001 a ADR-011; el estado de un ADR nuevo lo fija el flujo: `Aprobado` si el humano confirmó el spec con `spec.ok`) |
| metodología | `02-DOCS/wiki/sdd/methodology.md` | Método genérico: actores, fases, buenas prácticas y definición de hecho (vale para cualquier proyecto) |
| requisitos de la fábrica | `02-DOCS/wiki/sdd/factory-requirements.md` | RF-F1 a RF-F10: lo que debe garantizar la propia fábrica (no se copia a otros proyectos) |
| plantilla de spec | `02-DOCS/wiki/sdd/spec-template.md` | Estructura del spec (perfil `full`): actores, RF-n, diseño, ADR, trazabilidad |
| plantilla de job | `02-DOCS/wiki/sdd/job-page-template.md` | Estructura de la página que documenta cada job |
| documentación por job | `02-DOCS/wiki/jobs/<id>.md` | Qué se construyó, diseño, pruebas (con el commit del gate) y lecciones de cada job; viaja en el PR del job |
| installation plan | `02-DOCS/wiki/harness/installation-plan.md` | Plan de instalación RSC |
| user profile | `02-DOCS/wiki/harness/user-profile.md` | Perfil del usuario y nivel técnico |
| harness decisions | `02-DOCS/wiki/harness/decisions.md` | Decisiones del harness RSC |

## Regla de lectura

**Lee el índice primero y solo las 2-3 páginas relevantes.** No cargues todo el Brain de una vez. Cada agente consulta `02-DOCS/` antes de actuar y actualiza al terminar.
