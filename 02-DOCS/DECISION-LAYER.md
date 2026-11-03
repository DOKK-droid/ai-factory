# Capa de Decision Humano vs. Maquina — Proxima Fase

> Especificacion para la capa de decision que determina si las acciones finales de un job las ejecuta la maquina (FAST_PATH) o un humano (NEEDS_HUMAN). Solo se ejecuta despues de APPROVE exitoso del approver.

## 1. Posicion en el pipeline

builder -> gate -> 4 reviewers -> approver -> [APPROVE?] -> complexity.sh -> risk.sh -> output

- CHANGES -> volver a builder (bucle, max. max_rounds)
- ESCALATE -> human
- APPROVE -> complexity.sh -> risk.sh -> output

## 2. Componentes

### 2.1 complexity.sh (NUEVO - paso separado)

Analiza el diff y produce factory/jobs/<id>/complexity.md.

Scoring: base=0, archivos>3=+10 c/u, lineas>50=+5 c/50, ruta sensible=+30, dependencias=+20, API=+15, sin tests=+10, cross-module=+15, max=100.

Thresholds: LOW 0-25 (machine), MEDIUM 26-50 (machine), HIGH 51-75 (human), CRITICAL 76-100 (human).

### 2.2 risk.sh (MODIFICADO)

Lee complexity.md y decide: complexity<=MEDIUM + 4/4 PASS + gate PASS + fast_path ON -> FAST_PATH. Si complexity>MEDIUM o ruta sensible o gate FAIL o review CHANGES -> NEEDS_HUMAN.

### 2.3 factory/config.json

complexity.thresholds: {low:25, medium:50, high:75}, auto_merge_max: "MEDIUM", require_human_paths: ["auth","migrations","workflows",".env","package.json"].

## 3. Consulta del Brain

- complexity.sh lee: incidents.md, errors.md
- risk.sh lee: decisions.md, constitution.md

## 4. Orden de implementacion

1. Crear 01-TOOLS/complexity.sh
2. Modificar factory/config.json (bloque complexity)
3. Modificar 01-TOOLS/risk.sh (leer complexity.md)
4. Actualizar factory-protocol/SKILL.md
5. Actualizar .opencode/agent/human-gate.md
6. npm test (165 OK)
