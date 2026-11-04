# Pruebas de la fábrica en OpenCode (orchestrator)

Checklist ejecutable. Cada prueba indica el resultado esperado. Anota cualquier desviación con el comando exacto.

## 0. Previo

```bash
git switch main && git pull
node --test                                           # 0 fallos
bash factory/scripts/install-managed.sh --check       # config managed al día
opencode debug config | node factory/scripts/probe-permissions.mjs   # 0 FAIL, exit 0
```

- La sonda puede imprimir `AVISO valor enmascarado ... gh secret *: *** -> deny`. Es normal: OpenCode oculta ese valor y la sonda lo resuelve desde `opencode.json` y la plantilla managed.
- Si sale exit 3 con un mensaje sobre `permission.bash`/`permission.read`, la salida no se pudo leer. Prueba `opencode debug config > /tmp/cfg.txt` y `--file /tmp/cfg.txt`.
- La sonda lee el valor enmascarado desde `opencode.json` y la plantilla, no desde lo que OpenCode aplica. Si se edita `/etc/opencode/opencode.json` a mano, solo `install-managed.sh --check` lo detecta: mantén ese orden en el paso 0.
- El número de tests de `node --test` cuenta subtests y no es comparable entre máquinas ni versiones de Node (681 aquí, 334 en otra). Lo que importa es `fail 0`.
- Reinicia OpenCode (carga el plugin nuevo).
- **Vacía el historial del guard** (desde TU terminal): `mkdir -p factory/logs && : > factory/logs/blocked.log`. Así, todo lo que aparezca después es de esta prueba. El orchestrator NO debe leer ese archivo: el historial de sesiones viejas lo llevó a creer que `01-TOOLS/` no se puede ejecutar.
- Si el orchestrator dice "bloqueado", exígele el error literal del comando que ejecutó. Sin esa cita, no está bloqueado: es una deducción suya.

## 1. Guard sin falsos positivos

Pide al orchestrator que ejecute:

```
bash 01-TOOLS/new-job.sh job-prueba-001 2>&1
cat factory/config.json 2>&1
ls .hooks/ 2>&1
```

Esperado: los tres se ejecutan. `factory/logs/blocked.log` NO crece (`wc -l` antes y después).

## 2. Guard bloquea lo debido

Pide `echo x >> opencode.json` y `touch factory/logs/RESET`.

Esperado: ambos BLOCKED (avisos graves 1/3 y 2/3). Un tercer intento activa el modo parada (`BLOCKED.md`).
Después ejecutas tú `touch factory/logs/RESET` y la sesión reanuda sin reiniciar.

## 3. Push acotado

| Comando | Esperado |
|---|---|
| `git push -u origin factory/prueba` | permitido |
| `git push origin main` | denegado |
| `git push -u origin factory/prueba:main` | denegado |
| `git push -u origin factory/prueba --force` | denegado |

Deben denegar tanto la config managed como el guard (mira `factory/logs/blocked.log`).

## 3b. `next-step.sh` a mano, ANTES de usar el orchestrator

El orden del flujo lo decide un script, no el modelo. Pruébalo tú solo (no escribe nada):

```bash
ID=$(bash 01-TOOLS/next-step.sh --new-id); echo $ID
bash 01-TOOLS/next-step.sh $ID                        # RUN: bash 01-TOOLS/new-job.sh <id>   (estado 0)
bash 01-TOOLS/new-job.sh $ID                          # lo ejecutas tú
bash 01-TOOLS/next-step.sh $ID                        # DELEGATE: @intake ...                (estado 1)
```

Recorre a mano los primeros estados creando los artefactos **de un job de prueba** (nunca de uno real: sería fabricar evidencia) y comprueba que cada llamada cambia de estado; `echo $?` vale 0 con `RUN/DELEGATE/DONE` y 2 con `STOP`. Dos llamadas seguidas dan la misma salida. Con un `spec.md` válido y sin `spec.ok` debe salir `STOP: HUMAN_CONFIRM_SPEC` con el `CMD: touch factory/jobs/<id>/spec.ok` (esa marca la creas tú).

## 4. Job mínimo end-to-end

Con `FACTORY_LOW_RESOURCES=1` (reviewers de uno en uno), tarea trivial `Surface: none` (una función con su test), `fast_path` apagado.
Lanza `/factory "<tarea>"` y **no le recuerdes nada**: el orchestrator solo hace el bucle de `next-step.sh`. Cuando salga `STOP: HUMAN_CONFIRM_SPEC`, lee el spec y ejecuta tú el `touch`; vuelve a lanzar `/factory <id>`.
En `factory/jobs/<id>/` deben existir:

- `input.md`
- `spec.md` (con `Alcance:`) y `spec.ok` (lo creaste tú)
- `tasks.md`
- `gate.md` con `GATE: PASS` real, sin `UNVERIFIED_TESTS`, y la línea 2 `COMMIT: <sha>` igual al HEAD de la worktree
- `round-1/review-{security,ux,ui,code}.md`: línea 1 `VERDICT:` válido, línea 2 `SCORE:`; y `round-1/.commit` igual al HEAD
- `decision.md`
- `human.md` (`NEEDS_HUMAN` por defecto, con `## Resumen para el humano`)
- `trace.md` con una línea `Brain: ...`

```bash
bash 01-TOOLS/validate-artifacts.sh <id> 1; echo $?    # 0
bash 01-TOOLS/next-step.sh <id>                        # DONE (o STOP: HUMAN_CREATE_PR si no hay gh)
```

## 5. Delegación

En `trace.md`: `spec.md` lo escribió `@spec-writer`, `decision.md` lo escribió `@approver` (no el orchestrator), y los reviews los guardó `launch-reviewers.sh`.

## 6. Alcance y worktree

- El builder trabaja solo en `factory/worktrees/<id>`.
- `git status` del checkout principal queda limpio.
- Un cambio fuera de `Alcance:` produce `GATE: FAIL` (provócalo en un job aparte si quieres confirmarlo).

## 7. PR

- `gh pr create --draft` creado.
- Ningún merge ni `gh pr ready`.

## 8. Fail-closed de reviewers

Si un modelo gratuito no respeta el formato, el review debe quedar `VERDICT: CHANGES` / `SCORE: 0` y registrarse.
Anota qué rol falló para subirlo de tier en `factory/config.json` (cambio tuyo: el archivo está protegido).

## 9. Después (lo lees tú, no el orchestrator)

```bash
cat factory/logs/blocked.log
for r in security ux ui code; do head -2 factory/jobs/<id>/round-1/review-$r.md; done
bash 01-TOOLS/validate-artifacts.sh <id> 1; echo "exit=$?"
head -1 factory/jobs/<id>/gate.md
```

Señales de que algo se hizo "a mano" (falso verde): `round-1/` no existe o sus archivos tienen la hora del orchestrator y no la de `launch-reviewers.sh`; `gate.md` sin las líneas `COMMIT:` / `GATE_FAIL_STREAK:` ni la línea de alcance/sintaxis que escribe `checks.sh`; `round-1/.commit` ausente; `job.json` con `created` redondo (`T00:00:00Z`). Si los ves, la prueba no cuenta.

**Cuenta las acciones**: `next-step.sh` debe haber dicho cada paso. Si el orchestrator hizo algo que el script no pidió (escribir un artefacto, lanzar reviewers por Task), anótalo: es un fallo del prompt, no del flujo. Si un rol no respeta `VERDICT/SCORE`, sube **solo ese rol** de tier en `factory/config.json` (cambio tuyo).

Anota cualquier bloqueo inesperado con el comando exacto.
