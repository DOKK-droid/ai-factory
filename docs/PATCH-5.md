# Parche 5 — cierra los falsos verdes

Base: `main` con los PR #10 (lanzadores), #8 (modelos Go, **con `config.json` alineado**) y #9 (ADR) ya fusionados.
Probado: 256 tests, con y sin `FORCE_COLOR`. **No probado contra tu OpenCode** (ver "Lo que solo se comprueba en vivo").

## Qué cambia y por qué

| Problema real (job e2e) | Cambio |
|---|---|
| Código roto (`\`` literales) con gate en verde | `checks.sh` verifica la sintaxis de **cada archivo cambiado** (un `.js` se prueba como módulo y como CommonJS: `node --check x.js` da 0 sobre un `.js` roto con sintaxis ESM) y **ejecuta explícitamente los tests que el job cambió**. Si no hay runner, `gate.md` lleva `UNVERIFIED_TESTS:` y `risk.sh` lo trata como riesgo |
| El gate corría la suite de la fábrica, no el test del job (`.test.js` fuera del glob `*.test.mjs`) | idem: los tests cambiados se ejecutan por ruta y deben ejecutar al menos 1 caso |
| El commit recogió 5 borrados ajenos | Control de **alcance**: el spec declara `Alcance:` y `checks.sh`/`risk.sh` marcan lo que queda fuera (los borrados, aparte) |
| El job trabajó en tu directorio principal | `new-job.sh` crea la **worktree** `factory/worktrees/<id>` desde la rama base (lo que tengas sin commitear no puede colarse) y el hook `pre-commit` no deja commitear `factory/*` fuera de una worktree |
| Reviewers sin código (solo la narración del builder) | `launch-reviewers.sh` reescrito: spec + `gate.md` + **diff real**; el script guarda los reviews (los reviewers no tienen `bash` ni `edit`); borra reviews viejos; 1 reintento y luego `CHANGES / 0` |
| `pkill -f "opencode run"` mataba procesos ajenos | Solo se terminan los PID lanzados; límite total (`REVIEW_TIMEOUT_SECS`, 10 h por defecto) **y** por inactividad (`REVIEW_IDLE_SECS`, 30 min); concurrencia limitada (`REVIEW_MAX_PARALLEL`, 2) |
| IDs de modelo inexistentes | `validate-models.mjs` los compara con `opencode models`; `launch-reviewers.sh` aborta antes de gastar nada |
| A/B con fixture defectuoso | `tests/ab/`: **misma spec** para las dos ramas; la limpia la cumple; la defectuosa la cumple pero rompe 3 cosas (los tests originales lo demuestran). `AB_TIMEOUT_MIN` para modelos lentos |
| El agente esquivó el guard (variable, `python`) | El guard bloquea intérpretes (`python/node/perl/ruby…`, en línea o por heredoc) que mencionen rutas protegidas o `.env`, asignar rutas protegidas a variables, `factory-maint`, `FACTORY_HUMAN` y `FACTORY_GUARD_ALLOW_PROTECTED_EDIT`, y `git -c core.hooksPath` |
| Insistir tras un bloqueo | El plugin cuenta los bloqueos: al 3.º la sesión entra en **modo parada** (solo lectura), y registra los intentos en `factory/logs/blocked.log` + `BLOCKED.md` |
| `opencode.json` reescribible por el agente | Plantilla **managed** + `install-managed.sh` (con `sudo`): los `deny` de push/merge/gh api… en `/etc/opencode/`, de máxima prioridad |

## Orden de aplicación

1. Fusiona **#10** (ya está bien).
2. **#8**: añade `factory/config.json` (ver abajo) o fallará `los agentes reales coinciden con config.json`.
3. **#9**: corrige los estados de los ADR 004–007 (ver abajo).
4. **Cierra** el PR #3 y **no fusiones** `revert-6-rsc/knowledge`: este parche reescribe los dos scripts que trajo el #6.
5. `git checkout main && git pull --ff-only && git checkout -b fix/parche-5`
6. `git apply --check factory-fixes-5.patch && git apply --index factory-fixes-5.patch` (si falla por contexto: `--3way`)
7. `FORCE_COLOR=1 npm test` → 256 pass · commit · push · PR · squash.
8. `bash factory/scripts/install-managed.sh` (dry-run) y luego `--apply`.

### `factory/config.json` para el PR #8 (coincide con los modelos de sus agentes)

```json
"tiers": {
  "opus": "opencode/nemotron-3.5-super-vl-free",
  "builder": "opencode-go/gpt-5.6-luna",
  "judge": "opencode-go/claude-haiku-5-5",
  "security": "opencode-go/grok-4.7",
  "sol": "opencode/glm-5.3-flash-free",
  "astra": "opencode/mimo-v2.6-flash-free"
},
"roles": {
  "spec-writer": "sol", "builder": "builder", "reviewer-security": "security", "reviewer-ux": "sol",
  "reviewer-ui": "sol", "reviewer-code": "sol", "approver": "judge", "human-gate": "judge",
  "memory-curator": "sol", "intake": "astra", "orchestrator": "opus"
}
```
(Elimina la clave `fallback`: ningún código la lee.) Edítalo **a mano**: está protegido para los agentes.

## Cómo se usa ahora un job

```bash
bash 01-TOOLS/new-job.sh mi-job                 # worktree aislada
# spec.md con Surface, criterios y Alcance (el spec-writer lo escribe en factory/jobs/mi-job/)
bash .hooks/spec-first-gate.sh mi-job
cd factory/worktrees/mi-job                      # el builder trabaja y commitea AQUI
bash 01-TOOLS/checks.sh mi-job                   # gate real
bash 01-TOOLS/launch-reviewers.sh mi-job         # reviewers con el diff real
bash 01-TOOLS/risk.sh mi-job                     # decision humano/maquina
```

## Lo que solo se comprueba en vivo (no he podido ejecutar OpenCode)

| Qué | Cómo | Si falla |
|---|---|---|
| Flags de `opencode run` | `opencode run --help`: deben existir `--agent`, `--model`, `--pure`, `--auto` | Ajusta `args` en `run_role` o usa `REVIEW_PURE=0` / `REVIEW_AUTO=0` |
| Qué hace `--pure` | Si desactiva plugins, los reviewers corren sin guard (no importa: no tienen `bash`/`edit`) | — |
| Salida de `opencode models` | `node factory/scripts/validate-models.mjs --config` debe decir OK | Mándame las primeras líneas de `opencode models` |
| Formato de los reviewers | Un job real: ¿empieza cada review con `VERDICT:` y `SCORE:`? | Sube el modelo de ese rol; el script ya falla cerrado |
| Plugin cargado | Con `factory-agent`: `python3 -c "open('opencode.json')"` → `BLOCKED by factory-guard`; al 3.º, `STOP` | Revisa `.opencode/plugins/` y `factory/logs/blocked.log` |
| Config managed | `opencode debug config` tras instalarla; `git push origin main` debe estar denegado y `git push -u origin factory/x` permitido | El orden de reglas o la ruta cambian según versión: `FACTORY_MANAGED_DIR` |
| Tamaño del prompt | El diff va en el argumento de `opencode run` (hasta `REVIEW_MAX_DIFF_BYTES`) | Baja `REVIEW_MAX_DIFF_BYTES` |

## Límites

- El guard es una red de seguridad, no un sandbox: un modelo que ofusque lo bastante puede esquivarlo. Lo que protege `main` es el ruleset, la config managed y un token sin permisos sobre `main`.
- El control de alcance depende de que el spec declare un `Alcance:` correcto. Un alcance demasiado amplio (`**`) se rechaza.
- Un cambio pequeño con consecuencias semánticas (`>=` → `>`) sigue dependiendo de que los reviewers y los tests lo detecten: **mantén `fast_path` apagado** hasta que el A/B limpio lo demuestre.
