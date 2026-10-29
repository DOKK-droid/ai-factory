# ai-factory — installation-plan

Plan de instalación RSC Harness aceptado.

- **Plan ID:** a30303d8fd8792ad1d16134c3ae8d70401131d44237f9a49152d487ee7f94f3a
- **Proyecto:** software (complex)
- **Nivel técnico:** technical
- **Workflow:** branches + pull request
- **Target:** opencode
- **Agentes RSC:** developer, finding-verifier, refuter-correctness, refuter-security, refuter-tests
- **Skills RSC instaladas:** sdd, specify, clarify, plan, tasks, implement, verify, review, ship, constitution, parallel, worktrees, orient, analyze, design, ux, debug, simplify-code, unslop, source-grounded-development, automation-strategy, connect-tool, decision-challenge, deprecation, fable-operator, idea-refinement, init, suggest, harness
- **Capacidades:** memory, code-hooks, harness-documents
- **Rutas gestionadas:** .opencode/agents/, .opencode/commands/, .opencode/plugins/, .opencode/rsc/, .rsc.json, 02-DOCS/wiki/harness/, AGENTS.md, opencode.json

## Agentes personalizados de la Factory (.opencode/agent/)

1. orchestrator — ejecuta el pipeline completo
2. intake — normaliza Sentry / GitHub / tarea manual
3. spec-writer — SDD spec consultando el Brain
4. builder — TDD en worktree
5. reviewer-security — seguridad/performance/observabilidad
6. reviewer-ux — producto/UX/criterios de aceptación
7. reviewer-ui — consistencia visual/componentes
8. reviewer-code — convenciones/TDD/cobertura
9. approver — consolida informes → decisión
10. human-gate — FAST_PATH / NEEDS_HUMAN
11. memory-curator — actualiza Brain y trace.md

## Modelos (tiers → OpenCode gratuitos)

| Tier | Modelo | Roles |
|------|--------|-------|
| opus | opencode/nemotron-3.5-super-vl-free | spec-writer, builder, approver, human-gate, orchestrator |
| sonnet | opencode/deepseek-v4-flash-free | reviewer-code, memory-curator, intake |
| sol | opencode/glm-5.3-flash-free | reviewer-security, reviewer-ux |
| astra | opencode/mimo-v2.6-flash-free | reviewer-ui |
