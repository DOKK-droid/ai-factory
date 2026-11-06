# Propuesta de la rama 4: parche a `factory/config.json`

`factory/config.json` lo edita solo el humano. La rama no lo modifica: se entrega en [`rama4-factory-init.patch`](rama4-factory-init.patch) (1 archivo, 7 líneas añadidas, ninguna cambiada ni borrada).

## Qué añade

Seis líneas en `roles`, una por agente nuevo, con los tiers de la decisión D6 de la especificación:

| Agente | Tier | Modelo (según `tiers` actuales) |
|---|---|---|
| `discovery` | `go-approver` | `opencode-go/claude-haiku-5-5` |
| `architect` | `go-approver` | `opencode-go/claude-haiku-5-5` |
| `system-analyst`, `domain-modeler`, `deployment-planner` | `sol` | `opencode/glm-5.3-flash-free` |
| `consistency-auditor` | `go-security` | `opencode-go/grok-4.7` |

El `model:` del frontmatter de cada agente ya trae ese modelo resuelto, así que `node factory/scripts/apply-models.js --check` sale 0 con el parche aplicado y sin él solo avisa de que esos seis agentes no tienen rol (los demás siguen igual). **Sin A/B: es un supuesto de la especificación**; cambiar un modelo es editar esta tabla.

## Cómo aplicarlo y comprobarlo

```
git switch feat/factory-init
git apply --check docs/propuestas/rama4-factory-init.patch   # no escribe nada; debe salir 0
git apply docs/propuestas/rama4-factory-init.patch
node factory/scripts/apply-models.js --check                 # debe salir 0
FORCE_COLOR=0 node --test tests/*.test.mjs
FORCE_COLOR=1 node --test tests/*.test.mjs
git add -- factory/config.json
git commit -m "feat(factory): roles de los seis agentes de /factory-init"
```

Hasta que lo apliques, un test de `tests/pipeline-consistency.test.mjs` sale como «saltado: falta aplicar el parche» (no como verde) y otro falla si el parche está a medias (algunos roles sí y otros no). Para deshacerlo: `git apply --reverse docs/propuestas/rama4-factory-init.patch`.

## Riesgos que conozco

| Riesgo | Estado |
|---|---|
| `factory:validate-models` (y `launch-reviewers.sh`) comprueban que los modelos existan en `opencode models`; `claude-haiku-5-5` y `grok-4.7` ya los usan `approver` y `reviewer-security` | sin cambio |
| sin el parche los seis agentes funcionan con el modelo escrito en su frontmatter, pero el siguiente `apply-models.js` (sin `--check`) los dejaría igual y avisaría | inocuo |
| el comportamiento real de `task` (discovery → especialistas) y de `webfetch: ask` en ejecución no se ha probado con un modelo; solo se verificó con `opencode debug agent <id>` (OpenCode 1.18.35) que los permisos se leen como se escribieron | pendiente de la primera ejecución real |
