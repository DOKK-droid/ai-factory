# AI Factory — AGENTS.md

Este repositorio es una AI Software Factory basada en el video de Eric Risco y el RSC Harness, ejecutada sobre OpenCode con modelos gratuitos.

## Brain

La memoria persistente vive en `02-DOCS/` y específicamente en `02-DOCS/wiki/`. **Todos los agentes deben consultar el Brain antes de actuar y actualizarlo al terminar.** Nunca empezar de cero.

## Pipeline

1. **Input** — normaliza Sentry / GitHub Issue / tarea manual
2. **Spec Writer** — SDD spec consultando el Brain
3. **Builder** — TDD en worktree desde main, commits atómicos
4. **4 Revisores en paralelo** — Seguridad, UX, UI, Código
5. **Aprobador** — consolida informes, decide APPROVE / CHANGES / ESCALATE
6. **Decisor Humano** — FAST_PATH o NEEDS_HUMAN
7. **Output** — PR borrador o merge (si fast_path habilitado)

## Reglas

- No push a main salvo fast_path habilitado explícitamente por el humano
- Cada job deja traza completa en `factory/jobs/<id>/`
- Los 4 revisores se lanzan en paralelo
- Cualquier valor ambiguo en un review se trata como CHANGES / ESCALATE / NEEDS_HUMAN (fallar hacia el lado seguro)
- Si `Surface: none`, reviewer-ux y reviewer-ui devuelven `PASS (n/a)` pero siempre se lanzan los 4

## Modelos

Configurados en `factory/config.json` (tiers: opus, sonnet, sol, astra mapeados a modelos gratuitos de OpenCode).
