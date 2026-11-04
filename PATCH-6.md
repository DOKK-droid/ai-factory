# Parche 6 — el guard deja de confundir *leer/ejecutar* con *escribir*

Lo que reveló tu corrida de punta a punta, y su causa real:

| Síntoma | Causa | Arreglo |
|---|---|---|
| `bash 01-TOOLS/new-job.sh x 2>&1`, `cat factory/config.json 2>&1`, `ls .hooks/ 2>&1` bloqueados → modo parada tras 3 | `splitSegments` cortaba `2>&1` en el `&` y un regex trataba cualquier `>` como escritura sobre la ruta protegida | El guard analiza **tokens**: solo bloquea el *destino* de una redirección o el argumento de un comando que escribe (`tee`, `rm`, `mv`, `cp` destino, `sed -i`, `dd of=`, `git restore/checkout --`…). Leer o ejecutar rutas protegidas siempre se permite |
| El orchestrator no sabía quién produce cada artefacto y paraba | El prompt no tenía la matriz | Tabla "Quién produce cada artefacto" + regla: *falta permiso de escritura ⇒ delega, no pares* |
| `job.json` rechazado por permisos | Patrones `factory/jobs/*/job.json` no calzan con la ruta absoluta de la worktree | Todos los patrones de `edit` empiezan por `*` |
| (hallazgo) los `deny` del builder se esquivaban con ruta absoluta y faltaban `lib.sh`, `new-job.sh`, `launch-reviewers.sh`, `validate-artifacts.sh`, `factory/scripts/*`, `.github/*`… | Lo mismo + lista incompleta | Deny alineado con `PROTECTED_PATHS` y fijado por test |
| (hallazgo) con el `opencode.json` del proyecto solo, `git push -u origin factory/x --force` quedaba **permitido** | Los `deny` de force/delete iban *antes* del `allow factory/*` y gana la última regla | Reordenado + `*:*`, `* main*`, `* master*`, `* HEAD*`, `rm -fr`, `printenv` |
| (hallazgo) config managed: `git push -u origin factory/x:main` y `… factory/x main` calzaban con el allow | Faltaban denies posteriores | Añadidos a la plantilla managed |

## Modo parada con salida

- Dos contadores: **graves** (tocar protegidos, main, force, merge, rodeos, secretos) paran a los 3; **de forma** (`gh pr create` sin `--draft`, push sin rama explícita, `checkout main`) paran a los 10.
- Parada = solo herramientas de lectura. Escribe `factory/logs/BLOCKED.md` y `blocked.log` (con `kind`).
- **Salir sin reiniciar OpenCode:** desde TU terminal `touch factory/logs/RESET`. `factory/logs/` ahora es ruta protegida: el agente no puede crear ese archivo.
- Variables: `FACTORY_GUARD_MAX_BLOCKS` (3), `FACTORY_GUARD_MAX_POLICY_BLOCKS` (10).

## Cómo aplicarlo (sobre main con el parche 5 ya aplicado)

```bash
git switch main && git pull
git switch -c fix/guard-redirects
git apply --check factory-fixes-6.patch && git apply factory-fixes-6.patch
node --test                                   # 334 tests, todos verdes
git add -A && git status                      # revisa que solo haya archivos del parche
git commit -m "fix(guard): leer/ejecutar rutas protegidas no es escribirlas; modo parada con RESET"
git push -u origin fix/guard-redirects        # desde tu terminal, y PR a main
```

## Después de mergear (obligatorio, es lo que prueba que funciona)

```bash
# 1. Reinstalar la config managed (la plantilla cambió)
bash factory/scripts/install-managed.sh --apply      # pide sudo; instala la plantilla actualizada
bash factory/scripts/install-managed.sh --check      # debe terminar con codigo 0

# 2. Comprobar la política EFECTIVA que OpenCode aplica de verdad (managed + proyecto fusionados)
opencode debug config | node factory/scripts/probe-permissions.mjs
```

La sonda imprime `OK`/`FAIL` por comando y sale con 1 si algo no se cumple. **Pégame la salida si hay algún FAIL**: lo más probable es el orden de claves tras la fusión (un `git push *` deny después del allow de `factory/*` niega el push legítimo; justo lo que sospechabas viendo las líneas 52 y 55-56 de tu `debug config`).

## Qué NO cambia

- El guard sigue siendo red de seguridad, no sandbox. Las defensas reales: ruleset de `main`, config managed, token sin permiso sobre main.
- `fast_path` sigue deshabilitado.
- Por seguridad, **no** se permite que un agente edite `factory/scripts/*` ni `01-TOOLS/*`: los cambios a esos archivos los haces tú.

## Pendiente de verificar en vivo (no se puede probar sin tu OpenCode)

1. Que los modelos gratuitos respeten `VERDICT:`/`SCORE:` en los 4 reviewers (si no, `launch-reviewers.sh` marca `CHANGES` fail-closed y verás cuál sube de modelo).
2. Que el orchestrator (`nemotron…-free`) siga la tabla delegando con Task. Si no lo hace, es un problema de modelo, no de permisos: sube el tier `opus` de `factory/config.json`.
3. Que `opencode run --auto` no apruebe nada fuera de lo previsto: la sonda lo cubre para push/merge/gh; para el resto, `ask` cuenta como riesgo.
