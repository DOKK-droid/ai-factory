#!/usr/bin/env bash
# onboard-project.sh — protege un repo nuevo de la fabrica (ajustes + ruleset de main).
# Por defecto NO cambia nada (dry-run). Con --apply ejecuta las llamadas a la API de GitHub.
#
# Uso: bash factory/scripts/onboard-project.sh <owner/repo> [--check-name ci] [--approvals 0]
#                                               [--code-owners] [--apply]
# Requiere: gh autenticado con TU cuenta (admin del repo), node.
# Nota: las llamadas a la API de GitHub NO se han probado contra GitHub real; los tests usan un `gh` simulado.
set -euo pipefail

usage() { sed -n '2,10p' "$0"; exit "${1:-2}"; }
[ $# -ge 1 ] || usage
REPO="$1"; shift
CHECK="ci"; APPROVALS=0; CODE_OWNERS=false; APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check-name) CHECK="${2:?falta valor}"; shift 2 ;;
    --approvals)  APPROVALS="${2:?falta valor}"; shift 2 ;;
    --code-owners) CODE_OWNERS=true; shift ;;
    --apply) APPLY=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Opcion desconocida: $1" >&2; usage ;;
  esac
done
[[ "$REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || { echo "ERROR: repo debe ser owner/repo" >&2; exit 2; }
[[ "$APPROVALS" =~ ^[0-9]+$ ]] || { echo "ERROR: --approvals debe ser un numero" >&2; exit 2; }
[[ "$CHECK" =~ ^[A-Za-z0-9._\ -]+$ ]] || { echo "ERROR: --check-name invalido" >&2; exit 2; }

GH="${GH_BIN:-gh}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="${HERE}/../templates/ruleset-main.json"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT

CHECK="$CHECK" APPROVALS="$APPROVALS" CODE_OWNERS="$CODE_OWNERS" TEMPLATE="$TEMPLATE" node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync(process.env.TEMPLATE, "utf8"));
  const pr = r.rules.find((x) => x.type === "pull_request").parameters;
  pr.required_approving_review_count = Number(process.env.APPROVALS);
  pr.require_code_owner_review = process.env.CODE_OWNERS === "true";
  r.rules.find((x) => x.type === "required_status_checks").parameters.required_status_checks = [{ context: process.env.CHECK }];
  process.stdout.write(JSON.stringify(r, null, 2));
' > "$TMP"

run() { if [ "$APPLY" = 1 ]; then echo "+ $*"; "$@"; else echo "[dry-run] $*"; fi; }
try() { if [ "$APPLY" = 1 ]; then echo "+ $*"; "$@" || echo "AVISO: fallo (puede requerir plan/licencia): $*" >&2; else echo "[dry-run] $*"; fi; }

echo "== Onboarding de ${REPO} (check=${CHECK}, aprobaciones=${APPROVALS}, code-owners=${CODE_OWNERS}) =="
[ "$APPLY" = 1 ] && run "$GH" api "repos/${REPO}" --jq .full_name

echo "-- 1/5 Ajustes del repo: solo squash, borrar ramas, sin auto-merge"
run "$GH" api -X PATCH "repos/${REPO}" -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
    -F delete_branch_on_merge=true -F allow_auto_merge=false -F allow_update_branch=true

echo "-- 2/5 Secret scanning + push protection"
try "$GH" api -X PATCH "repos/${REPO}" -f 'security_and_analysis[secret_scanning][status]=enabled' \
    -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'

echo "-- 3/5 Dependabot alerts y actualizaciones de seguridad"
try "$GH" api -X PUT "repos/${REPO}/vulnerability-alerts"
try "$GH" api -X PUT "repos/${REPO}/automated-security-fixes"

echo "-- 4/5 Actions: permisos de lectura y sin aprobar PRs"
run "$GH" api -X PUT "repos/${REPO}/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false

echo "-- 5/5 Ruleset protect-main"
if [ "$APPLY" = 1 ]; then
  ID="$("$GH" api "repos/${REPO}/rulesets" --jq '.[] | select(.name=="protect-main") | .id' | head -1)"
  if [ -n "$ID" ]; then run "$GH" api -X PUT "repos/${REPO}/rulesets/${ID}" --input "$TMP"
  else run "$GH" api -X POST "repos/${REPO}/rulesets" --input "$TMP"; fi
else
  echo "[dry-run] gh api -X POST (o PUT si ya existe) repos/${REPO}/rulesets --input <json>"; cat "$TMP"; echo
fi

cat <<MSG

== Manual (no se puede hacer por API sin permisos extra) ==
1. Anade a ${REPO}: .github/workflows/ci.yml (plantilla factory/templates/project-ci.yml, el job debe llamarse "${CHECK}")
   y, si usas --code-owners, .github/CODEOWNERS (plantilla factory/templates/CODEOWNERS).
2. Settings > Actions > General > Fork pull request workflows: "Require approval for all outside collaborators".
3. Settings > Security and quality > Advanced Security: confirma Secret Protection y Push protection; activa Code Security (CodeQL).
4. Da acceso al token del agente SOLO a este repo (ver docs/ONBOARDING.md) y activa los git hooks: npm run hooks:install.
MSG
[ "$APPLY" = 1 ] || echo "(dry-run: no se cambio nada; repite con --apply)"
