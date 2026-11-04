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
- Reinicia OpenCode (carga el plugin nuevo).

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

## 4. Job mínimo end-to-end

Con el orchestrator, tarea trivial `Surface: none` (una función con su test), `fast_path` apagado.
En `factory/jobs/<id>/` deben existir:

- `input.md`
- `spec.md` (con `Alcance:`)
- `tasks.md`
- `gate.md` con `GATE: PASS` real, sin `UNVERIFIED_TESTS`
- `round-1/review-{security,ux,ui,code}.md`: línea 1 `VERDICT:` válido, línea 2 `SCORE:`
- `decision.md`
- `human.md` (`NEEDS_HUMAN` por defecto)
- `trace.md`

```bash
bash 01-TOOLS/validate-artifacts.sh <id> 1; echo $?    # 0
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

## 9. Después

```bash
tail factory/logs/blocked.log
```

Anota cualquier bloqueo inesperado con el comando exacto.
