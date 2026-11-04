# 02-DOCS/wiki/index.md

## Knowledge map

| Topic | Where | What |
|-------|-------|------|
| constitution | `02-DOCS/wiki/sdd/constitution.md` | Principios no negociables de la AI Factory |
| arquitectura | `02-DOCS/wiki/sdd/constitution.md` | Stack canon, calidad, convenciones, branching |
| ADRs | `02-DOCS/wiki/sdd/decisions.md` | Decisiones de arquitectura (ADR-001 a ADR-010; el estado de un ADR nuevo lo fija el flujo: `Aprobado` si el humano confirmó el spec con `spec.ok`) |
| metodología | `02-DOCS/wiki/sdd/methodology.md` | Actores, fases, requisitos funcionales de la fábrica, buenas prácticas y definición de hecho |
| plantilla de spec | `02-DOCS/wiki/sdd/spec-template.md` | Estructura del spec (perfil `full`): actores, RF-n, diseño, ADR, trazabilidad |
| plantilla de job | `02-DOCS/wiki/sdd/job-page-template.md` | Estructura de la página que documenta cada job |
| glosario | `02-DOCS/wiki/sdd/glossary.md` | Términos del proyecto |
| documentación por job | `02-DOCS/wiki/jobs/<id>.md` | Qué se construyó, diseño, pruebas (con el commit del gate) y lecciones de cada job; viaja en el PR del job |
| job: clamp(n, min, max) | `02-DOCS/wiki/jobs/clamp-numeros-test-261104-133f.md` | Utilidad `clamp` en `src/clamp.js` con test `node:test`; gate PASS 6/6 sobre `4c50d00`; APPROVE con pendiente TDD para el humano |
| errores recurrentes | `02-DOCS/wiki/sdd/errors.md` | Errores recurrentes y cómo se resolvieron |
| incidentes por zona | `02-DOCS/wiki/sdd/incidents.md` | Incidentes registrados por zona de código |
| installation plan | `02-DOCS/wiki/harness/installation-plan.md` | Plan de instalación RSC |
| user profile | `02-DOCS/wiki/harness/user-profile.md` | Perfil del usuario y nivel técnico |
| harness decisions | `02-DOCS/wiki/harness/decisions.md` | Decisiones del harness RSC |

## Regla de lectura

**Lee el índice primero y solo las 2-3 páginas relevantes.** No cargues todo el Brain de una vez. Cada agente consulta `02-DOCS/` antes de actuar y actualiza al terminar.
