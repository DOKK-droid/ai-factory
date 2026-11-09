# Línea base de consumo — caso A (proyecto vacío, `/factory-init`)

Medida el 2026-11-09 con `node factory/scripts/job-cost.mjs /home/frappe/pf-1-vacio` sobre `~/.local/share/opencode/opencode.db`
(job `init-261107-5a04`, 45 sesiones). Es la referencia para comparar cualquier cambio que busque reducir tokens:
repetir el caso A con los mismos datos de entrada y volver a ejecutar el script.

El `costo$` es la estimación de OpenCode, no el consumo real del plan (suma $5.50 y el humano reportó ~50 % del mes: contrastar con el
panel de opencode-go). No incluye la fase `/factory <JOB>`.

```
Proyecto: /home/frappe/pf-1-vacio (45 sesiones)
rol                   modelo                         ses  turnos      input   output   razon.   cacheLect  cacheEscr   ctxMax  corr  costo$
--------------------  -----------------------------  ---  ------  ---------  -------  -------  ----------  ---------  -------  ----  ------
consistency-auditor   opencode-go/grok-4.7             6      62    774,805   15,408  221,157   2,260,480          0  116,571     0   4.099
principal(discovery)  opencode-go/claude-haiku-5-5     1     139        302  174,026  191,409  29,113,908  6,320,445  538,220     0   1.264
architect             opencode-go/claude-haiku-5-5     9      57        132   48,611   57,389   2,131,224    460,971   82,430     8   0.132
system-analyst        opencode/glm-5.3-flash-free     14     113    432,423   42,517   35,213   2,504,576          0   47,875    11   0.000
domain-modeler        opencode/glm-5.3-flash-free      7      51    245,708   18,253   26,851   1,122,816          0   45,384     6   0.000
deployment-planner    opencode/glm-5.3-flash-free      7      48    201,661   15,800    7,235     969,408          0   39,023     6   0.000
intake                opencode/mimo-v2.6-flash-free    1       9     28,221    4,496      490     202,496          0   30,456     0   0.000
TOTAL                                                 45     479  1,683,252  319,111  539,744  38,304,908  6,781,416             31   5.495

costo$ es la estimacion de OpenCode, no el consumo real del plan. "corr" es una heuristica sobre el titulo de la sesion.
```

## Criterios de no regresión (un cambio de costo solo se adopta si los cumple)

- `PASS` en una pasada **completa** del `consistency-auditor` al cierre.
- `project-lint check --strict`: 0 errores y 0 avisos nuevos.
- Ningún `REQ-F`, `UC` o `ENT` menos que en la línea base; PL021–PL026 limpios.
- Hallazgos de la pasada final completa ≤ línea base (0 bloqueantes, 3 menores).
- Ninguna respuesta del humano tergiversada.
- Costo total ≤ línea base. Mínimo 2 corridas por el ruido entre ejecuciones.

Plan completo: `NEXT-STEPS-FABRICA.md`, TAREA C.
