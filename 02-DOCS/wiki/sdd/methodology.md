# Metodología de la AI Factory

Cómo se recorre un trabajo de punta a punta, quién interviene, qué se exige en cada fase y qué buenas prácticas son obligatorias. Es la página que leen `@spec-writer`, `@approver` y `@memory-curator` antes de actuar (línea `READ:` de `next-step.sh`).

## 1. Principio: el Brain aconseja, el control decide, los permisos hacen cumplir

| Capa | Qué es | Responde a | Quién la ejecuta |
|---|---|---|---|
| Brain (`02-DOCS/wiki/`) | memoria del proyecto: arquitectura, decisiones, convenciones | qué y por qué | los agentes la leen; la escribe `@memory-curator` |
| Plano de control (`01-TOOLS/next-step.sh`) | máquina de estados determinista, solo lectura | cuándo y qué sigue | código, sin LLM |
| Permisos (frontmatter, config managed, guard) | qué puede y qué no cada agente | límites | OpenCode y el guard, fuera del modelo |

El Brain nunca decide el flujo ni los permisos: un texto que un modelo interpreta puede estar desactualizado o mal leído. La política de cada proyecto vive en `factory/project.json` (versionado, solo lo edita el humano).

## 2. Actores del sistema

| Actor | Rol / interés | Produce | No puede |
|---|---|---|---|
| **Humano** (dueño del producto y revisor) | decide qué se construye y qué se fusiona | `spec.ok`, `review.ok`, `pr.url`, el merge, la aprobación de ADR | — |
| **Orchestrator** | ejecuta el bucle `next-step.sh` | `trace.md` (si se lo piden) | decidir el siguiente paso; escribir evidencia |
| **`@intake`** | normaliza la entrada (texto, issue, Sentry) | `input.md` | escribir código |
| **`@spec-writer`** | analiza y diseña: actores, requisitos, diseño, criterios | `spec.md`, `tasks.md` | tocar código o evidencia |
| **`@builder`** | implementa con TDD en la worktree | código, tests, commits, `build.md` | tocar scripts, guard, config, evidencia |
| **Reviewers** (security, ux, ui, code) | revisan el diff real desde su especialidad | respuesta de texto (la guarda el script) | escribir o ejecutar |
| **`@approver`** | consolida los 4 reviews | `decision.md` | cambiar reviews |
| **`@human-gate`** | resume el riesgo para el humano | sección "Resumen para el humano" de `human.md` | cambiar la línea 1 |
| **`@memory-curator`** | documenta y mantiene el Brain | `jobs/<id>.md`, `index.md`, ADR en `decisions.md`, `trace.md` | escribir fuera de esas páginas |
| **Scripts** (`checks.sh`, `launch-reviewers.sh`, `risk.sh`, `commit-brain.sh`) | verificación y evidencia deterministas | `gate.md`, `round-N/review-*.md`, `.commit`, `human.md` línea 1 | — |
| **Guard / permisos / GitHub** | hacer cumplir los límites | bloqueos, ruleset de `main` | — |

## 3. Fases, estados y artefactos

`next-step.sh` imprime `PHASE:` en cada paso.

| Fase | Estados | Qué se hace | Artefacto | Responsable |
|---|---|---|---|---|
| **Análisis** | 0–1, 2 | entender la necesidad: entrada, actores, requisitos funcionales | `input.md`, `spec.md` (Actores, Requisitos funcionales) | intake, spec-writer |
| **Diseño** | 2–3 | decidir cómo: componentes, interfaces, ADR; el humano confirma | `spec.md` (Diseño, ADR), `tasks.md`, `spec.ok` | spec-writer, humano |
| **Desarrollo** | 4, 6, 9 | implementar con TDD, commits atómicos | commits en `factory/<id>` | builder |
| **Pruebas** | 5, 7 | gate determinista y reviews sobre el diff real | `gate.md`, `round-N/review-*.md` | scripts |
| **Revisión** | 8, 10, 11b | decidir y evaluar el riesgo | `decision.md`, `human.md`, `review.ok` | approver, risk.sh, humano |
| **Documentación** | 11 | dejar el conocimiento versionado en el PR | `02-DOCS/wiki/jobs/<id>.md`, ADR, `index.md`, `trace.md` | memory-curator |
| **Entrega** | 12–14 | subir la rama y abrir el PR en borrador; el humano fusiona | rama `factory/<id>`, PR | orchestrator, humano |

## 4. Requisitos funcionales de la fábrica

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

## 5. Buenas prácticas obligatorias

1. **SDD**: el spec manda; sin spec confirmado no hay código.
2. **Trazabilidad**: RF → criterio de aceptación `[RF-n]` → tarea → test (el título del test cita el RF) → commit. Un RF sin criterio, o un criterio sin RF, es un defecto del spec.
3. **TDD**: test en rojo primero (commit propio), luego el código mínimo en verde, luego refactor.
4. **Commits atómicos y descriptivos**; `git add` de archivos concretos, nunca `-A` ni `commit -a`.
5. **Una rama = un tema = un PR** (`factory/<id>`); PR siempre en borrador; squash al fusionar.
6. **ADR** cuando el trabajo toma una decisión de arquitectura o de política: nace `Propuesto` y lo aprueba el humano al fusionar.
7. **Evidencia no fabricada**: ningún agente escribe `gate.md` ni reviews; las pruebas se afirman citando el `COMMIT` de `gate.md`, nunca de memoria.
8. **Fail-closed**: un valor ambiguo es `CHANGES` / `ESCALATE` / `NEEDS_HUMAN` / `STOP`.
9. **Revisión independiente**: modelos distintos para quien construye y quien revisa.
10. **Diff mínimo y dentro del alcance** (`Alcance:` del spec).

## 6. Definición de hecho (DoD)

- [ ] Spec completo y confirmado (`spec.ok`); cada RF cubierto por criterio, tarea y test.
- [ ] Gate `PASS` atado al commit; sin `UNVERIFIED_TESTS`.
- [ ] 4 reviews válidos del mismo commit; `decision.md` = `APPROVE`.
- [ ] `human.md` con resumen para el humano.
- [ ] Página del job en el Brain (cita el commit del gate) y ADR si el spec lo declaró.
- [ ] Rama subida y PR en borrador.

## 7. Perfiles de spec (`spec_profile` en `factory/project.json`)

- `standard`: Surface, criterios numerados, Alcance, `tasks.md`.
- `full`: además `ADR:`, Actores, Requisitos funcionales `RF-n`, Diseño, trazabilidad y la página del job en el Brain. Plantilla: `02-DOCS/wiki/sdd/spec-template.md`.
