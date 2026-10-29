---
type: constitution
title: ai-factory — Constitution
description: Constitución de la AI Software Factory sobre OpenCode + RSC Harness
tags: [sdd, constitution]
timestamp: 2026-10-29T17:13:32Z
topic: sdd
status: ratified
version: 1.0.0
---

# ai-factory — Constitution

Constitución ratificada de la AI Software Factory. Rige todos los agentes, skills y hooks del repositorio.

## 1. Stack canon

- Lenguaje: JavaScript/TypeScript (Node.js v24)
- Gestor de paquetes: npm
- Agente de IA: OpenCode CLI con modelos gratuitos (Zen)
- Harness: RSC Harness (@ericrisco/rsc)
- Git: ramas + pull request (default branch cerrado a trabajo directo)
- Modelo por defecto para roles críticos (opus): `opencode/nemotron-3.5-super-vl-free`
- Modelos de revisión: `opencode/deepseek-v4-flash-free`, `opencode/glm-5.3-flash-free`, `opencode/mimo-v2.6-flash-free`

## 2. Quality bar

- TDD obligatorio: test primero, código después, nunca al revés
- Gate determinista antes de lanzar revisores (`01-TOOLS/checks.sh`)
- Cobertura mínima de tests: 80% de líneas modificadas
- Lint y typecheck deben pasar antes de commit
- Diff máximo por job: `max_diff_lines` definido en `factory/config.json` (400)

## 3. Convenciones

- Commits: mensaje descriptivo, sin trailers de IA, autoría humana
- Branches: worktree desde main, nombre descriptivo, merge solo tras aprobación
- Archivos de job: primera línea siempre el veredicto (`VERDICT:`, `APPROVE|CHANGES|ESCALATE`, `FAST_PATH|NEEDS_HUMAN`)
- Cualquier valor ambiguo se trata como CHANGES / ESCALATE / NEEDS_HUMAN (lado seguro)

## 4. Branching & shipping

- Rama por defecto (main) cerrada a trabajo directo
- Cada job crea su propia worktree/branch desde main
- Ship solo tras human-gate (`FAST_PATH` o aprobación humana explícita)
- fast_path desactivado por defecto (`factory/config.json`)

## 5. Security & privacy floor

- Nunca leer `.env` ni secretos
- Nunca push a main salvo fast_path habilitado explícitamente
- Bash allowlist: git, gh, npm, npx, test runners únicamente
- No borrados masivos (`rm -rf` prohibido)

## 6. UX / accessibility floor (si hay UI)

- Surface: page | none (si no hay interfaz, reviewer-ux/ui devuelven PASS (n/a))
- Criterios de aceptación del Spec son vinculantes
- Accesibilidad básica (a11y) en todo componente UI

## 7. Performance budgets

- Gate determinista debe completarse en < 60s
- Cada revisor debe producir su informe en < 120s
- Jobs bloqueados > 3 rondas pasan a ESCALATE

## 8. Knowledge & decisions

- Brain: `02-DOCS/wiki/` es la fuente de verdad de decisiones y patrones
- memory-curator actualiza el Brain al cerrar cada job
- trace.md registra: Issue → Spec → Branch → PR → Reviews → Decisión
- El Brain debe responder: "¿por qué se tomó esta decisión hace 3 semanas?"

## Definition of Done (merge bar que `verify` ejecuta)

- [ ] Spec aprobado y en `02-DOCS/`
- [ ] Tests escritos y pasando (TDD rojo → verde)
- [ ] Gate determinista pasado (lint + typecheck + tests)
- [ ] 4 revisores lanzados en paralelo con veredictos
- [ ] Aprobador consolidó: APPROVE
- [ ] Human-gate: FAST_PATH o aprobación humana
- [ ] Brain actualizado con decisiones y lecciones
- [ ] trace.md completo

## Amendment log (append-only)

| Date | Version | Change | Why |
|------|---------|--------|-----|
| 2026-10-29 | draft | Draft generado por `rsc onboard`. | SDD floor necesita constitución. |
| 2026-10-29 | 1.0.0 | Constitución ratificada. | Principios innegociables de la Factory. |
