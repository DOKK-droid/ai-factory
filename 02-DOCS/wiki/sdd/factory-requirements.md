# Requisitos funcionales de la fábrica

Qué debe garantizar la propia AI Factory como producto (RF-F1 a RF-F10). Son los requisitos **de la fábrica**, no de un proyecto que la use: por eso esta página vive solo en el repositorio `ai-factory` y `install-into.sh` no la copia a otros proyectos. El método genérico está en `02-DOCS/wiki/sdd/methodology.md`.

- **RF-F1** Normalizar cualquier entrada (texto, issue, Sentry) a `input.md`.
- **RF-F2** Producir un spec con actores, requisitos funcionales numerados, diseño, ADR y criterios trazables.
- **RF-F3** Exigir la confirmación del humano antes de construir (`spec.ok`).
- **RF-F4** Construir con TDD en una worktree aislada, con commits atómicos.
- **RF-F5** Verificar de forma determinista (alcance, sintaxis, tests) y atar el resultado al commit.
- **RF-F6** Revisar con 4 reviewers sobre el diff real, guardados por un script.
- **RF-F7** Consolidar en una decisión y evaluar el riesgo (`risk.sh`); ante duda, `NEEDS_HUMAN`.
- **RF-F8** Documentar cada job en el Brain, dentro del mismo PR.
- **RF-F9** Entregar siempre un PR en borrador; nunca push a `main` ni merge automático.
- **RF-F10** Dejar traza completa y auditable en `factory/jobs/<id>/`.
