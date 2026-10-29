CHANGES

## Resumen de la decisión
El approver debe decidir basado en 4 revisiones con 3 fallos plantados críticos.

## Detalle por revisor
- security: CHANGES / 0.35 (3 blockers: rate limiting, SQL injection, test falso)
- ux: CHANGES / 0.55
- ui: PASS (n/a) / 0.90
- code: CHANGES / 0.45 (1 blocker: test falso, 1 should-fix, 1 nit)

## Cambios requeridos
- Corregir rate limiting (>= 5)
- Usar consultas parametrizadas
- Restaurar test real
