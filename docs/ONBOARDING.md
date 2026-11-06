# Identidad del agente, proyectos nuevos y niveles de autonomía

> Las llamadas a la API de GitHub de `onboard-project.sh` están probadas con un `gh` simulado, no contra GitHub real.
> Los nombres de menús salen de la documentación de GitHub (octubre 2026); si tu pantalla difiere, manda la captura.

## 1. Dos identidades, dos credenciales

| | Humano (tú) | Agente (OpenCode) |
|---|---|---|
| Credencial | tu login normal de `gh` / git | token **solo del agente** (abajo) |
| Puede | merge, cambiar rulesets, secretos | crear ramas `factory/*`, abrir PR en borrador |
| No puede | — | push/merge a `main`, tocar settings, leer secretos |

Un token de agente que solo tiene `Contents` y `Pull requests` **no puede** cambiar rulesets ni ajustes (eso exige *Administration*). Y aunque pudiera escribir en el repo, el ruleset de `main` le impide empujar a `main`.

## 2. Token del agente

### Fase A (ahora, simple): fine-grained personal access token

GitHub → foto de perfil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**

| Campo | Valor |
|---|---|
| Token name | `factory-agent-<proyecto>` |
| Expiration | **30 días** (renovar es barato, un token filtrado caduca solo) |
| Resource owner | tu cuenta |
| Repository access | **Only select repositories** → solo el repo del proyecto |
| Repository permissions | **Contents: Read and write**, **Pull requests: Read and write**, Metadata: Read-only (se pone solo) |
| Todo lo demás | **No access** (en especial Administration, Workflows, Actions, Secrets, Environments) |

Notas: un PAT fine-grained **no se puede limitar a ramas**, por eso la protección de `main` es el ruleset. Los PR creados con el `GITHUB_TOKEN` de Actions no disparan workflows; con un PAT o un GitHub App sí, así que el check del CI se ejecutará.

**Dónde guardarlo** (nunca en el repo ni en `.env` del proyecto):

```bash
mkdir -p ~/.config/ai-factory && chmod 700 ~/.config/ai-factory
umask 077 && printf 'GH_TOKEN=github_pat_XXXX\n' > ~/.config/ai-factory/agent.env
cat > ~/bin/factory-agent <<'SH'
#!/usr/bin/env bash
set -euo pipefail
set -a; . "$HOME/.config/ai-factory/agent.env"; set +a
exec opencode "$@"
SH
chmod +x ~/bin/factory-agent
gh auth setup-git     # una vez: git usa gh como credential helper (respeta GH_TOKEN)
```

Lanza OpenCode siempre con `factory-agent`. Tu terminal normal sigue usando tu login. El guard bloquea que el agente lea `*.env`, imprima `$GH_TOKEN` o ejecute `printenv`/`env`, pero **es una red de seguridad, no un sandbox**: el token es de mínimo privilegio justamente por eso.

### Fase B (cuando uses CODEOWNERS o aprobaciones obligatorias): GitHub App

Con tu propia cuenta como autor del PR no puedes aprobar tu propio PR. Un **GitHub App** da al agente identidad propia (`tu-app[bot]`): tu aprobación pasa a ser real. Settings → Developer settings → GitHub Apps → New GitHub App: webhook desactivado; permisos de repositorio *Contents* y *Pull requests* en Read & write; instalarla solo en los repos necesarios; generar la clave privada. Los *installation tokens* caducan en 1 hora. (Cuando llegues aquí, se añade un script que cambie la clave por un token de 1 h.)

### Rotación y revocación
Anota la fecha de caducidad; si sospechas una filtración: Settings → Developer settings → Fine-grained tokens → **Revoke**. Crea uno nuevo; no reutilices.

## 3. Proyecto nuevo, paso a paso

El instalador `factory/scripts/install-into.sh` monta la fábrica en un repo git existente y le deja un **Brain limpio** (sin las decisiones de la fábrica). Cada proyecto tiene **su propio `02-DOCS/`** y su propio check de CI.

1. **Prepara el repo destino:** un repo git con al menos un commit en `main` y el árbol limpio. Si no tiene `package.json`, el instalador crea uno mínimo.
2. **Instala (primero dry-run, que no escribe nada):**
   ```bash
   bash factory/scripts/install-into.sh /ruta/al/proyecto                  # dry-run: lista qué copia, crea y qué choca
   bash factory/scripts/install-into.sh /ruta/al/proyecto --apply --name mi-proyecto
   bash factory/scripts/install-into.sh /ruta/al/proyecto --check          # 0 = la maquinaria y las skills coinciden con la fuente
   # opcional: --engine opencode (por defecto; el único soportado hoy)
   ```
   Si un archivo del destino ya existe y difiere, el instalador lista los conflictos y se detiene (`--force` solo sobrescribe maquinaria; nunca el Brain, `project.json`, `package.json` ni `AGENTS.md`). No instala el harness RSC (eso es `npx @ericrisco/rsc`, aparte) ni toca `/etc/opencode`.
3. **Escribe el contexto:** rellena `02-DOCS/wiki/context.md` (qué es el proyecto, actores, stack, cómo se prueba, restricciones) y los marcadores `RELLENAR` de `02-DOCS/wiki/sdd/constitution.md`. El spec-writer lee `context.md` antes de cada spec; `--check` avisa mientras queden marcadores. Si el destino ya tenía `AGENTS.md`, las reglas de la fábrica quedan en `AGENTS.factory.md`: fusiónalas a mano.
4. **Primer commit a `main`** con la instalación y el CI (`.github/workflows/ci.yml`, que el instalador crea desde `factory/templates/project-ci.yml`; el job se llama `ci`). Si usarás code owners, añade `.github/CODEOWNERS`. Se hace **antes** de proteger `main`.
5. **Protege `main`:**
   ```bash
   bash factory/scripts/onboard-project.sh OWNER/REPO --check-name ci            # dry-run: revisa
   bash factory/scripts/onboard-project.sh OWNER/REPO --check-name ci --apply
   ```
   (o importa `factory/templates/ruleset-main.json` en Settings → Rules → Rulesets → New ruleset → *Import a ruleset*).
6. **Config managed (opcional, recomendada):** `bash factory/scripts/install-managed.sh` (dry-run; luego `--apply`, pide sudo).
7. **Ajustes manuales:** Settings → Actions → General → *Fork pull request workflows* = require approval for all outside collaborators; Settings → Security and quality → **Advanced Security**: Secret Protection (y Push protection) activados; Code Security → CodeQL en configuración por defecto.
8. **Acceso del token:** edita el token del agente y añade el repo (o crea uno nuevo solo para él).
9. **Local:** `npm run hooks:install`, `npm test`, `./factory-agent`.
10. **Prueba de humo:** un job trivial con `/factory "<tarea pequeña>"`; comprueba que el PR sale en borrador desde `factory/<job-id>`, que el check `ci` corre y que **tú** haces el merge. No exijas `behavior-tests` fuera de `ai-factory`.

### Qué instala (la tabla que el test de consistencia compara con el instalador)

| Tipo | Ruta |
|---|---|
| copia | `opencode.json`, `.opencode/agent`, `.opencode/command/factory.md`, `.opencode/plugins/factory-guard.js`, `.hooks`, `01-TOOLS`, `factory/scripts`, `factory/templates`, `factory/config.json`, `factory/jobs/.gitkeep`, `03-SKILLS`, `.agents/skills` (skills de terceros, según `--engine`), `factory-agent`, `factory-maint` |
| mezcla o adapta | `package.json` (solo añade los scripts `factory:*` y `hooks:install`), `.gitignore` (bloque de la fábrica), `AGENTS.md` (sin el bloque del harness RSC; si ya existe, queda `AGENTS.factory.md`), `skills-lock.json` (añade las skills de terceros que falten; nunca pisa una entrada del destino) |
| crea si falta | `.github/workflows/ci.yml`, `factory/project.json`, `factory/backlog.md`, `02-DOCS/wiki/index.md`, `02-DOCS/wiki/context.md`, `02-DOCS/wiki/sdd/constitution.md`, `02-DOCS/wiki/sdd/decisions.md`, `02-DOCS/wiki/sdd/methodology.md`, `02-DOCS/wiki/sdd/spec-template.md`, `02-DOCS/wiki/sdd/job-page-template.md` |

No se copian: `tests/`, los ADR y la constitución de la fábrica, `factory/jobs/*`, `docs/PATCH*`, `.rsc*`, `02-DOCS/wiki/sdd/factory-requirements.md` (los RF-F son de la fábrica) ni `01-TOOLS/_TEMPLATE`. `methodology.md` viaja genérico (el método vale para cualquier proyecto); `--check` falla si el destino acaba con `factory-requirements.md` o con algún `RF-F` en su Brain o su `AGENTS`.

**Motor de IA (`--engine`).** Decide dónde van las skills de terceros. Hoy solo existe `opencode` (el valor por defecto): las deja en `.agents/skills/`, que es lo que OpenCode carga (`opencode debug skill`, ADR-011). Un motor distinto se rechaza con exit 2 y sin escribir nada: su ruta se añade a `engine_skills_dir` cuando se compruebe en su documentación, no antes. Las skills propias de la fábrica (`03-SKILLS/`) se leen por ruta y viajan siempre.

## 4. Quién decide si una máquina sigue sola o interviene un humano

Orden recomendado, de más simple a más ambicioso. **Empieza en el nivel 0.**

| Nivel | Qué ocurre | Cómo se implementa |
|---|---|---|
| 0 | Todo PR lo fusiona un humano | Ruleset con PR + check. Es el estado actual |
| 1 | **Modo sombra**: `risk.sh` calcula FAST_PATH, pero igual lo revisas | 2–4 semanas. Compara la decisión del sistema con la tuya y anota discrepancias |
| 2 | Rutas por riesgo | `CODEOWNERS`: docs/tests/estilos sin dueño; auth, pagos, migraciones, CI, `factory/**` con dueño obligatorio |
| 3 | Auto-merge de cambios pequeños | Ver abajo: la decisión la toma un **CI de confianza**, no la máquina del agente |
| 4 | Despliegue con aprobación | *Environments* con *required reviewers*: se fusiona solo, pero producción espera tu clic |

**Por qué no basta con `human.md`:** lo escribe un script que corre en la máquina del agente; si esa máquina se compromete, miente. La política debe recalcularse en un entorno que el agente no controla:

1. Un workflow `risk-gate` en GitHub Actions recalcula el riesgo **desde el diff del PR** (mismas reglas que `risk.sh`: tamaño, rutas sensibles, dependencias, tests tocados) y publica un check obligatorio `factory-risk`.
2. Riesgo bajo → el check pasa y se permite el auto-merge de GitHub (*Allow auto-merge*, hoy desactivado). Riesgo alto → el check queda en rojo hasta que un humano distinto del autor apruebe.
3. Los archivos que definen la política (`.github/`, `factory/`, `01-TOOLS/`, `.hooks/`) llevan CODEOWNERS: el agente **no puede cambiar las reglas de su propio juez** sin tu aprobación.
4. **Interruptor de emergencia:** variable de repo `FACTORY_AUTOMERGE=false` que el workflow comprueba, o `Enforcement: Disabled` del ruleset de auto-merge.
5. **Límites:** máximo de auto-merges por día y enfriamiento (por ejemplo, esperar N horas antes del merge) para poder revertir.
6. **Métricas:** tasa de reverts y de CI roto por clase de cambio. Amplía la autonomía solo si son bajas durante semanas.

Esta pieza (`risk-gate`) **no está implementada todavía**; pasa al nivel 3 solo después del modo sombra.

## 5. Verificación del ruleset

```bash
git checkout main && git pull
echo x >> README.md
FACTORY_HUMAN=1 git commit -am "prueba" && git push   # GitHub debe rechazarlo (rama protegida)
git reset --hard origin/main
```
Y, con el token del agente: `git push origin main` debe fallar en el guard, y `git push -u origin factory/prueba` + `gh pr create --draft` debe funcionar.
