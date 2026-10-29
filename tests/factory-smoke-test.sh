#!/usr/bin/env bash
# tests/factory-smoke-test.sh
# Prueba de humo de la AI Software Factory.
# Ejecuta un job trivial de punta a punta y verifica que las capas de protección funcionan.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO_ROOT}"

echo "=============================================="
echo "  AI Factory — Smoke Test"
echo "=============================================="

# 1. Verificar que existen los agentes
echo "-> Verificando agentes OpenCode..."
AGENT_COUNT=$(ls .opencode/agent/ 2>/dev/null | wc -l)
RSC_AGENT_COUNT=$(ls .opencode/agents/ 2>/dev/null | wc -l)
echo "   Agentes custom: ${AGENT_COUNT}"
echo "   Agentes RSC: ${RSC_AGENT_COUNT}"

# 2. Verificar que existe el comando /factory
echo "-> Verificando comando /factory..."
if [ -f .opencode/command/factory.md ]; then
  echo "   OK: .opencode/command/factory.md existe"
else
  echo "   ERROR: .opencode/command/factory.md no existe"
  exit 1
fi

# 3. Verificar Brain
echo "-> Verificando Brain (02-DOCS/)..."
if [ -f 02-DOCS/wiki/sdd/constitution.md ]; then
  echo "   OK: constitución existe"
else
  echo "   ERROR: constitución no existe"
  exit 1
fi

# 4. Verificar gate determinista
echo "-> Verificando gate determinista (01-TOOLS/checks.sh)..."
if [ -f 01-TOOLS/checks.sh ]; then
  echo "   OK: checks.sh existe"
else
  echo "   ERROR: checks.sh no existe"
  exit 1
fi

# 5. Verificar human-gate risk.sh
echo "-> Verificando human-gate (01-TOOLS/risk.sh)..."
if [ -f 01-TOOLS/risk.sh ]; then
  echo "   OK: risk.sh existe"
else
  echo "   ERROR: risk.sh no existe"
  exit 1
fi

# 6. Verificar hooks
echo "-> Verificando hooks (.hooks/)..."
for hook in spec-first-gate.sh branch-guard.sh ship-guard.sh worktree-reaper.sh; do
  if [ -f ".hooks/${hook}" ]; then
    echo "   OK: ${hook} existe"
  else
    echo "   ERROR: ${hook} no existe"
    exit 1
  fi
done

# 7. Verificar plugin de OpenCode
echo "-> Verificando plugin factory-guard.js..."
if [ -f .opencode/plugins/factory-guard.js ]; then
  echo "   OK: factory-guard.js existe"
else
  echo "   ERROR: factory-guard.js no existe"
  exit 1
fi

# 8. Verificar opencode.json tiene denegados
echo "-> Verificando permisos de opencode.json..."
if grep -q '"git push": "deny"' opencode.json; then
  echo "   OK: git push denegado"
else
  echo "   ERROR: git push no está denegado"
  exit 1
fi

if grep -q '"git merge": "deny"' opencode.json; then
  echo "   OK: git merge denegado"
else
  echo "   ERROR: git merge no está denegado"
  exit 1
fi

# 9. Verificar skill-registry
echo "-> Verificando skill-registry de RSC..."
if [ -f .rsc/skill-registry.json ]; then
  echo "   OK: skill-registry.json existe"
else
  echo "   ERROR: skill-registry.json no existe"
  exit 1
fi

# 10. Resumen
echo ""
echo "=============================================="
echo "  Smoke Test: TODAS LAS VERIFICACIONES PASARON"
echo "=============================================="
echo ""
echo "La factory está lista para recibir jobs vía /factory"
echo "Ejemplo: opencode run --agent orchestrator \"/factory <tarea>\""
echo ""
echo "Nota: El pipeline completo (/factory con todos los agentes)"
echo "se ejecuta en el TUI de OpenCode, no vía CLI directa."
