# Ejemplo de estructura de un job de la AI Software Factory

Este directorio muestra la estructura que genera cada job ejecutado por `/factory`.

```
factory/jobs/<job-id>/
├── job.json           # Estado del job (solo orchestrator)
├── input.md           # Entrada normalizada (intake)
├── spec.md            # Spec SDD (Surface: page | none)
├── tasks.md           # Desglose de tareas
├── build.md           # TDD rojo/verde por tarea
├── gate.md            # Resultado del gate determinista
├── round-1/
│   ├── review-security.md   # VERDICT + SCORE
│   ├── review-ux.md         # VERDICT + SCORE
│   ├── review-ui.md         # VERDICT + SCORE (PASS n/a si Surface: none)
│   └── review-code.md       # VERDICT + SCORE
├── decision.md        # APPROVE / CHANGES / ESCALATE
├── human.md           # FAST_PATH / NEEDS_HUMAN
└── trace.md           # Issue → Spec → Branch → PR → Reviews → Decisión
```

## Formatos obligatorios (factory-protocol)

### Reviewer (primera línea)
```
VERDICT: PASS | CHANGES | PASS (n/a)
SCORE: 0-1
```

### Aprobador (primera línea)
```
APPROVE | CHANGES | ESCALATE
```

### Human-gate (primera línea)
```
FAST_PATH | NEEDS_HUMAN
```

### Ejemplo de review-security.md
```
VERDICT: CHANGES
SCORE: 0.35

## Hallazgos
- [bloqueo] Inyección SQL en getUserByEmail
  where: src/auth.js:13
  why: concatenación de string sin parametrizar
  repro: enviar email: admin' OR '1'='1 --
  fix: usar consultas parametrizadas

## Recomendaciones
- Usar consultas preparadas
```

## Reglas de aislamiento (híbrida)

Cada job pertenece a un solo proyecto. Los agentes solo leen/escriben
`02-DOCS/` del proyecto actual. Nunca cruzan fronteras entre proyectos.
