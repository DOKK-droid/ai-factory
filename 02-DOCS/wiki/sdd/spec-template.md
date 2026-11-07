# Plantilla de spec (perfil `full`)

Copia esta estructura en `factory/jobs/<id>/spec.md`. `next-step.sh` valida con `spec-lint.mjs` que cada sección existe y que la trazabilidad cierra. Las secciones se pueden escribir como `## Actores` o como `Actores:`. Las líneas `Surface:` y `ADR:` van sueltas.

```markdown
# Spec — <título corto>

Surface: none            <!-- page | none -->
ADR: none                <!-- none, o el título de la decisión de arquitectura/política que toma este trabajo -->

## Objetivo de negocio
<qué se quiere lograr y por qué, en lenguaje de negocio>

## Actores
- <Actor 1>: <rol o interés; incluye humanos, otros sistemas y componentes que interactúan>
- <Actor 2>: ...

## Requisitos funcionales
- RF-1: <el sistema debe ... (una capacidad verificable)>. Implementa: REQ-F-1, UC-2
- RF-2: .... Implementa: REQ-F-2

## Diseño
- <componentes y archivos que se tocan, interfaces (firmas, formatos), decisiones y alternativas descartadas>

## Criterios de aceptación
1. [RF-1] <comportamiento observable y comprobable>
2. [RF-1] <caso borde>
3. [RF-2] ...

## Restricciones de arquitectura
<lo que el Brain dice que hay que respetar>

## Tests esperados
<casos; los títulos de los tests citan el RF: "RF-1: acota por debajo de min">

## Riesgos
<qué puede salir mal>

## Alcance
- src/<archivo>.js
- tests/<archivo>.test.mjs
```

`tasks.md`: una tarea por línea, citando el RF que cubre.

```markdown
- [ ] T1 (RF-1): test en rojo de ...
- [ ] T2 (RF-1): implementación mínima de ...
- [ ] T3 (RF-2): ...
```

**`Implementa:` (obligatoria cuando el proyecto tiene base documental).** Con `project_docs: required` en `factory/project.json`, o en cuanto hay documentos aprobados en `02-DOCS/wiki/project/`, cada RF termina con `Implementa: REQ-F-n, UC-n`: los IDs de la base que ese RF cumple (acepta `REQ-F`, `REQ-NF`, `UC` y `ENT`). `spec-lint` comprueba el formato y que cada ID exista en la base de la worktree del job. Al confirmar el spec (`spec.ok`), `project-lint stamp` guarda el hash de cada bloque citado en `implementa.lock`: si la base cambia uno de esos IDs más tarde, el job vuelve al spec-writer para realinear el spec y el humano debe confirmarlo de nuevo. Si un RF no corresponde a nada de la base, no inventes el ID: pide el cambio con `brain-request.md`.

Reglas de trazabilidad (las comprueba el script): cada criterio cita al menos un `[RF-n]` declarado; cada RF lo cubre al menos un criterio; cada RF aparece en `tasks.md`; los ids `RF-n` no se repiten.
