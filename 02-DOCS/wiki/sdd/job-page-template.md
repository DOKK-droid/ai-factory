# Plantilla de la página de un job (`02-DOCS/wiki/jobs/<id>.md`)

La escribe `@memory-curator` en la worktree del job; `commit-brain.sh` la commitea para que viaje en el PR. En el perfil `full`, `next-step.sh` exige las seis secciones y que la página cite el commit del gate. Si el spec cita IDs de la base documental (`Implementa:` en sus RF), la página lleva esa misma línea, con la unión exacta de los IDs del spec: de ahí deriva `project-status.mjs` el estado de cada REQ y UC.

```markdown
# <título del job> (`<id>`)

Implementa: REQ-F-1, UC-2

## Resumen
<qué se construyó y para qué, en 2-4 líneas; enlaza el PR cuando exista>

## Actores
<copiados del spec>

## Requisitos funcionales
<RF-n copiados del spec, con su estado: cubierto por qué criterio/test>

## Diseño
<decisiones tomadas; enlaza el ADR si lo hay>

## Implementación
<archivos creados o cambiados y los commits (hash corto + mensaje), tomados de `git log` de la worktree>

## Pruebas
Gate (`gate.md`): `GATE: PASS` sobre el commit `<sha7 del COMMIT de gate.md>`. <comando y resultado, copiados de gate.md>
Reviews (ronda N): <veredicto y score de cada uno, copiados de review-*.md>.
Solo se afirma lo que aparece literalmente en `gate.md` y en los reviews; lo demás se escribe "no verificado".

## Lecciones
<qué salió bien, qué salió mal, patrones reutilizables; sin afirmaciones que no estén en la evidencia>
```
