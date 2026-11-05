// install-into.sh: monta la fabrica en otro proyecto con un Brain limpio. Todo en directorios temporales; sin OpenCode ni red.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, git, run } from './helpers.mjs';

const INSTALL = path.join(REPO, 'factory/scripts/install-into.sh');
const sh = (args, opts = {}) => run('bash', [INSTALL, ...args], { cwd: opts.cwd || REPO, env: { ...process.env, ...(opts.env || {}) } });

/** Repo destino con un commit en main. `files` = archivos extra del proyecto. */
function dest(files = { 'README.md': '# proyecto\n' }) {
  const d = tmp('af-inst-');
  git(d, 'init', '-q', '-b', 'main'); git(d, 'config', 'user.email', 't@t.t'); git(d, 'config', 'user.name', 't'); git(d, 'config', 'commit.gpgsign', 'false');
  for (const [f, t] of Object.entries(files)) write(path.join(d, f), t);
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base');
  return d;
}
const installed = (files) => { const d = dest(files); const r = sh([d, '--apply']); assert.equal(r.status, 0, r.stderr + r.stdout); return d; };
const tree = (d) => {
  const out = [];
  (function walk(p) { for (const e of fs.readdirSync(p, { withFileTypes: true })) { if (e.name === '.git') continue; const f = path.join(p, e.name); e.isDirectory() ? walk(f) : out.push(path.relative(d, f)); } })(d);
  return out.sort();
};
const exists = (d, f) => fs.existsSync(path.join(d, f));
const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');
const manifest = () => sh(['--list']).stdout.trim().split('\n').map((l) => l.split('\t'));

test('--list: el manifiesto coincide con la tabla de docs/ONBOARDING.md (que no vuelva a desalinearse)', () => {
  const onb = read(REPO, 'docs/ONBOARDING.md');
  const rows = manifest(); assert.ok(rows.length > 20);
  for (const [kind, p] of rows) assert.ok(onb.includes('`' + p + '`'), `ONBOARDING no menciona ${kind} ${p}`);
  for (const [, p] of manifest().filter(([k]) => k === 'copy')) assert.ok(exists(REPO, p), `${p} del manifiesto no existe en la fabrica`);
});

test('el indice del Brain de esta fabrica solo enlaza a archivos que existen', () => {
  const idx = read(REPO, '02-DOCS/wiki/index.md');
  const links = [...idx.matchAll(/`(02-DOCS\/[^`]+)`/g)].map((m) => m[1]).filter((p) => !p.includes('<'));
  assert.ok(links.length >= 5);
  for (const p of links) assert.ok(exists(REPO, p), `index.md enlaza a ${p}, que no existe`);
});

test('dry-run: lista lo que haria y no escribe nada en el destino', () => {
  const d = dest(); const before = tree(d);
  const r = sh([d]);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /dry-run/); assert.match(r.stdout, /COPIAR\s+01-TOOLS\/next-step\.sh/);
  assert.deepEqual(tree(d), before); assert.equal(git(d, 'status', '--porcelain'), '');
});

test('--apply: copia la maquinaria y crea el Brain limpio', () => {
  const d = installed();
  for (const f of ['01-TOOLS/next-step.sh', '.opencode/agent/orchestrator.md', '.opencode/plugins/factory-guard.js', 'factory/project.json', 'factory/scripts/command-guard.mjs',
    '02-DOCS/wiki/sdd/methodology.md', '02-DOCS/wiki/sdd/spec-template.md', '02-DOCS/wiki/sdd/job-page-template.md', '02-DOCS/wiki/context.md', '02-DOCS/wiki/index.md',
    '.github/workflows/ci.yml', 'opencode.json', 'AGENTS.md', 'package.json', 'factory-agent', '03-SKILLS/factory-protocol/SKILL.md', 'factory/jobs/.gitkeep']) assert.ok(exists(d, f), `falta ${f}`);
  assert.ok(fs.statSync(path.join(d, '01-TOOLS/next-step.sh')).mode & 0o111, 'next-step.sh debe seguir ejecutable');
  assert.ok(fs.statSync(path.join(d, 'factory-agent')).mode & 0o111);
});

test('--apply: nada de la fabrica viaja (ADR, constitucion, jobs, tests, harness RSC, parches)', () => {
  const d = installed(); const all = tree(d);
  assert.doesNotMatch(read(d, '02-DOCS/wiki/sdd/decisions.md'), /^## ADR-/m, 'decisions.md debe estar vacio de ADR');
  assert.doesNotMatch(read(d, '02-DOCS/wiki/sdd/constitution.md'), /ai-factory — Constitution/);
  assert.doesNotMatch(read(d, '02-DOCS/wiki/sdd/constitution.md'), /AI Software Factory/);
  assert.deepEqual(all.filter((f) => /^(tests\/|\.rsc|\.agents\/|\.opencode\/rsc|\.opencode\/agents\/|\.opencode\/commands\/|\.opencode\/node_modules)/.test(f)), []);
  assert.deepEqual(all.filter((f) => /^\.opencode\/plugins\/rsc-/.test(f)), []);
  assert.deepEqual(all.filter((f) => /^factory\/jobs\/./.test(f) && f !== 'factory/jobs/.gitkeep'), []);
  assert.deepEqual(all.filter((f) => /PATCH|PARCHE|PLAN_|skills-lock|01-TOOLS\/_TEMPLATE|02-DOCS\/wiki\/harness|NEXT-STEPS|\.patch$/.test(f)), []);
  assert.doesNotMatch(read(d, 'AGENTS.md'), /rsc-suggest/);
  assert.match(read(d, 'AGENTS.md'), /Pipeline/);
});

test('--apply: el index.md del destino solo enlaza a archivos que existen y context.md entra en el Brain del spec-writer', () => {
  const d = installed();
  const idx = read(d, '02-DOCS/wiki/index.md');
  const links = [...idx.matchAll(/`(02-DOCS\/[^`]+)`/g)].map((m) => m[1]).filter((p) => !p.includes('<'));
  assert.ok(links.length >= 5);
  for (const p of links) assert.ok(exists(d, p), `index.md del destino enlaza a ${p}, que no existe`);
  const pj = JSON.parse(read(d, 'factory/project.json'));
  assert.equal(pj.require_spec_ok, true); assert.equal(pj.spec_profile, 'full'); assert.equal(pj.max_rounds, 3); assert.deepEqual(pj.human_review_surfaces, []);
  assert.ok(pj.brain.agents['spec-writer'].includes('02-DOCS/wiki/context.md'));
  for (const p of pj.brain.agents['spec-writer']) assert.ok(exists(d, p), `project.json cita ${p}, que no existe`);
});

test('nombre del proyecto: --name y por defecto el de la carpeta; un nombre raro se rechaza', () => {
  const d = dest(); assert.equal(sh([d, '--apply', '--name', 'Mi Proyecto']).status, 0);
  assert.match(read(d, '02-DOCS/wiki/context.md'), /# Contexto de Mi Proyecto/);
  const e = dest(); assert.equal(sh([e, '--apply']).status, 0); assert.match(read(e, '02-DOCS/wiki/context.md'), new RegExp('# Contexto de ' + path.basename(e)));
  const r = sh([dest(), '--name', 'a"; rm -rf /']); assert.equal(r.status, 2);
});

test('no sobrescribe package.json ni AGENTS.md existentes: mezcla scripts y deja AGENTS.factory.md', () => {
  const pkg = JSON.stringify({ name: 'mio', version: '2.0.0', scripts: { test: 'jest', build: 'tsc' }, dependencies: { x: '1.0.0' } }, null, 2) + '\n';
  const d = installed({ 'README.md': 'x\n', 'package.json': pkg, 'AGENTS.md': '# Mis reglas\n', '.gitignore': 'dist' });
  const p = JSON.parse(read(d, 'package.json'));
  assert.equal(p.name, 'mio'); assert.equal(p.version, '2.0.0'); assert.equal(p.scripts.test, 'jest'); assert.equal(p.scripts.build, 'tsc'); assert.deepEqual(p.dependencies, { x: '1.0.0' });
  assert.ok(p.scripts['factory:checks'] && p.scripts['hooks:install']);
  assert.equal(read(d, 'AGENTS.md'), '# Mis reglas\n'); assert.ok(exists(d, 'AGENTS.factory.md')); assert.match(read(d, 'AGENTS.factory.md'), /Pipeline/);
  const gi = read(d, '.gitignore'); assert.ok(gi.startsWith('dist\n')); assert.match(gi, /factory\/worktrees\//);
});

test('sin package.json se crea uno minimo; instalar dos veces no cambia nada ni duplica el bloque de .gitignore', () => {
  const d = installed(); const p = JSON.parse(read(d, 'package.json'));
  assert.ok(p.scripts['factory:new-job']); assert.ok(p.scripts.test);
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'fabrica');
  const before = tree(d).map((f) => [f, read(d, f)]);
  const r = sh([d, '--apply']); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(tree(d).map((f) => [f, read(d, f)]), before); assert.equal(git(d, 'status', '--porcelain'), '');
  assert.equal((read(d, '.gitignore').match(/AI Factory \(install-into/g) || []).length, 1);
});

test('el destino debe ser un repo git, limpio y distinto de la fabrica', () => {
  const plain = tmp('af-plain-'); let r = sh([plain, '--apply']); assert.equal(r.status, 1); assert.match(r.stderr, /no es un repositorio git/);
  assert.deepEqual(tree(plain), []);
  r = sh(['/no/existe/carpeta']); assert.equal(r.status, 1);
  const dirty = dest(); write(path.join(dirty, 'wip.txt'), 'sin commitear\n'); r = sh([dirty, '--apply']);
  assert.equal(r.status, 1); assert.match(r.stderr, /cambios sin commitear/); assert.ok(!exists(dirty, '01-TOOLS'));
  assert.equal(sh([dirty, '--apply', '--force']).status, 0); assert.ok(exists(dirty, '01-TOOLS/next-step.sh'));
  r = sh([REPO, '--apply']); assert.equal(r.status, 1); assert.match(r.stderr, /propio repo de la fabrica/);
  const sub = dest(); fs.mkdirSync(path.join(sub, 'paquete')); r = sh([path.join(sub, 'paquete')]); assert.equal(r.status, 1); assert.match(r.stderr, /raiz del repo/);
});

test('un archivo existente que difiere es un conflicto: se lista, se para y --force solo sobrescribe maquinaria', () => {
  const d = dest({ 'README.md': 'x\n', 'opencode.json': '{"mio": true}\n', '02-DOCS/wiki/sdd/decisions.md': '# Mis decisiones\n\n## ADR-001: Usar Postgres\n' });
  let r = sh([d]); assert.equal(r.status, 1); assert.match(r.stderr, /CONFLICTO/); assert.match(r.stderr, /opencode\.json/);
  r = sh([d, '--apply']); assert.equal(r.status, 1); assert.equal(read(d, 'opencode.json'), '{"mio": true}\n'); assert.ok(!exists(d, '01-TOOLS'), 'con conflicto no se instala nada');
  r = sh([d, '--apply', '--force']); assert.equal(r.status, 0, r.stderr);
  assert.equal(read(d, 'opencode.json'), read(REPO, 'opencode.json'));
  assert.equal(read(d, '02-DOCS/wiki/sdd/decisions.md'), '# Mis decisiones\n\n## ADR-001: Usar Postgres\n', 'el Brain del proyecto nunca se pisa');
});

test('--check: 0 tras instalar (con aviso de contexto sin rellenar); 1 si falta, difiere o se coló algo de la fabrica', () => {
  const d = installed();
  let r = sh([d, '--check']); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /AVISO.*context\.md.*RELLENAR/);
  write(path.join(d, '02-DOCS/wiki/context.md'), '# Contexto\nTodo relleno.\n'); write(path.join(d, '02-DOCS/wiki/sdd/constitution.md'), '# C\nok\n');
  r = sh([d, '--check']); assert.equal(r.status, 0); assert.doesNotMatch(r.stdout, /AVISO/);
  const ns = path.join(d, '01-TOOLS/next-step.sh'); const orig = fs.readFileSync(ns);
  fs.writeFileSync(ns, orig + '\n# tocado\n'); r = sh([d, '--check']); assert.equal(r.status, 1); assert.match(r.stdout, /next-step\.sh.*no coincide/);
  fs.writeFileSync(ns, orig); fs.rmSync(ns); r = sh([d, '--check']); assert.equal(r.status, 1); assert.match(r.stdout, /next-step\.sh.*no esta instalado/);
  fs.writeFileSync(ns, orig); fs.chmodSync(ns, 0o755); assert.equal(sh([d, '--check']).status, 0);
  const adr = read(REPO, '02-DOCS/wiki/sdd/decisions.md').split('\n').find((l) => /^## ADR-001:/.test(l));
  fs.appendFileSync(path.join(d, '02-DOCS/wiki/sdd/decisions.md'), '\n' + adr + '\n');
  r = sh([d, '--check']); assert.equal(r.status, 1); assert.match(r.stdout, /ADR de la fabrica/);
});

test('integracion: en el destino instalado next-step.sh crea un job y responde (DELEGATE @intake) sin la fabrica original', () => {
  const d = installed(); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'instala la fabrica');
  const env = { ...process.env, FACTORY_BASE: 'main' };
  const id = run('bash', ['01-TOOLS/next-step.sh', '--new-id', 'tarea de prueba'], { cwd: d, env }).stdout.trim().split('\n')[0];
  assert.match(id, /^[a-z0-9-]+$/);
  const nj = run('bash', ['01-TOOLS/new-job.sh', id], { cwd: d, env }); assert.equal(nj.status, 0, nj.stderr);
  const ns = run('bash', ['01-TOOLS/next-step.sh', id], { cwd: d, env });
  assert.equal(ns.status, 0, ns.stdout + ns.stderr); assert.match(ns.stdout, /^DELEGATE: @intake \| .+ \| factory\/jobs\//m); assert.match(ns.stdout, /READ: 02-DOCS\/wiki\/index\.md/);
  assert.ok(!ns.stdout.includes(REPO), 'no debe apuntar a la fabrica original');
  assert.equal(git(d, 'status', '--porcelain'), '', 'jobs y worktrees quedan ignorados por git');
});
