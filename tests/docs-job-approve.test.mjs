// Q2 (rama 6): `project-lint approve` solo se acepta desde la worktree de un job (rama factory/*); en una rama que no lo es,
// de un repo con rama base, hace falta --bootstrap explicito. Fuera de un repo git (tmp de los tests) se comporta como siempre.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { write, run, git } from './helpers.mjs';
import { makeProject, lintCli, DOC_NAMES, LINT } from './project-fixture.mjs';

const ALL = DOC_NAMES;
const okFile = (root) => path.join(root, '02-DOCS/wiki/project/project.ok');
/** Repo git con la base documental commiteada en `main` (sin aprobar). */
function repo({ branch = 'main', config = null } = {}) {
  const p = makeProject();
  if (config) write(path.join(p.root, 'factory/config.json'), JSON.stringify(config));
  git(p.root, 'init', '-q', '-b', branch); git(p.root, 'config', 'user.email', 't@t.t'); git(p.root, 'config', 'user.name', 't'); git(p.root, 'config', 'commit.gpgsign', 'false');
  git(p.root, 'add', '-A'); git(p.root, 'commit', '-qm', 'base');
  return p;
}
const approve = (root, ...a) => run('node', [LINT, 'approve', ...ALL, '--root', root, ...a], { encoding: 'utf8' });

test('Q2: en main de un repo git, approve se niega, explica el motivo y no escribe project.ok', () => {
  const p = repo(); const r = approve(p.root);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /main/); assert.match(r.stdout, /factory\/\*/); assert.match(r.stdout, /--bootstrap/);
  assert.equal(fs.existsSync(okFile(p.root)), false);
  assert.doesNotMatch(r.stdout, /APROBADO/);
});
test('Q2: --bootstrap lo permite y deja constancia en la salida', () => {
  const p = repo(); const r = approve(p.root, '--bootstrap');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^APROBADO /m); assert.match(r.stdout, /^BOOTSTRAP: .*main/m);
  assert.ok(fs.existsSync(okFile(p.root)));
});
test('Q2: fuera de un repo git approve funciona igual que antes (los tmp de los tests), con o sin --bootstrap, y sin constancia', () => {
  const p = makeProject(); const r = approve(p.root);
  assert.equal(r.status, 0, r.stdout); assert.doesNotMatch(r.stdout, /BOOTSTRAP/);
  const q = makeProject(); const s = approve(q.root, '--bootstrap'); assert.equal(s.status, 0, s.stdout); assert.doesNotMatch(s.stdout, /BOOTSTRAP/);
});
test('Q2: en la worktree de un job (rama factory/*) approve funciona sin flag, tanto con cwd como con --root', () => {
  const p = repo(); const wt = path.join(p.root, 'factory/worktrees/j');
  git(p.root, 'worktree', 'add', '-q', '-b', 'factory/j', wt);
  const viaRoot = approve(wt); assert.equal(viaRoot.status, 0, viaRoot.stdout); assert.doesNotMatch(viaRoot.stdout, /BOOTSTRAP/);
  assert.ok(fs.existsSync(okFile(wt))); assert.equal(fs.existsSync(okFile(p.root)), false, 'no debe escribir en el checkout principal');
  const wt2 = path.join(p.root, 'factory/worktrees/k'); git(p.root, 'worktree', 'add', '-q', '-b', 'factory/k', wt2);
  const viaCwd = run('node', [LINT, 'approve', ...ALL], { cwd: wt2, encoding: 'utf8' }); assert.equal(viaCwd.status, 0, viaCwd.stdout + viaCwd.stderr);
});
test('Q2: una rama que no es factory/* (feat/x) y un HEAD desacoplado tambien se niegan', () => {
  const p = repo(); git(p.root, 'switch', '-q', '-c', 'feat/x');
  assert.equal(approve(p.root).status, 1); assert.equal(fs.existsSync(okFile(p.root)), false);
  git(p.root, 'checkout', '-q', '--detach'); const d = approve(p.root); assert.equal(d.status, 1); assert.match(d.stdout, /desacoplado|detached/i);
  assert.equal(approve(p.root, '--bootstrap').status, 0);
});
test('Q2: la rama base sale de la config (base_branch) o de FACTORY_BASE; sin main/master ni base declarada no hay restriccion', () => {
  const t = repo({ branch: 'trunk', config: { base_branch: 'trunk' } });
  assert.equal(approve(t.root).status, 1, 'base_branch=trunk');
  const u = repo({ branch: 'trunk' }); assert.equal(approve(u.root).status, 0, 'sin main ni master ni config: no es un repo con rama base');
  const v = repo({ branch: 'trunk' }); const r = run('node', [LINT, 'approve', ...ALL, '--root', v.root], { encoding: 'utf8', env: { ...process.env, FACTORY_BASE: 'trunk' } });
  assert.equal(r.status, 1, 'FACTORY_BASE=trunk');
  const w = repo({ branch: 'master' }); assert.equal(approve(w.root).status, 1, 'master tambien es base');
});
test('Q2: una base solo remota (origin/main) cuenta como rama base', () => {
  const p = repo(); const o = path.join(p.root, '..', path.basename(p.root) + '-bare'); git(p.root, 'init', '-q', '--bare', '-b', 'main', o);
  git(p.root, 'remote', 'add', 'origin', o); git(p.root, 'push', '-q', 'origin', 'main'); git(p.root, 'switch', '-q', '-c', 'feat/y'); git(p.root, 'branch', '-q', '-D', 'main');
  assert.equal(approve(p.root).status, 1);
});
test('Q2: --bootstrap solo existe para approve; check, state y gate no cambian en main', () => {
  const p = repo();
  for (const c of ['check', 'state', 'gate']) { const r = run('node', [LINT, c, '--root', p.root], { encoding: 'utf8' }); assert.notEqual(r.status, 64, c); }
  assert.equal(run('node', [LINT, 'check', '--bootstrap', '--root', p.root], { encoding: 'utf8' }).status, 64);
  assert.equal(lintCli(p.root, 'check').status, 0);
});
test('Q2: la negativa no oculta los errores del documento: con --bootstrap sigue exigiendo que no haya errores', () => {
  const p = makeProject({ edit: { '01-requisitos': (t) => t.replace('[FUENTE: README.md#Alcance]', '[PENDIENTE]') } });
  git(p.root, 'init', '-q', '-b', 'main'); git(p.root, 'config', 'user.email', 't@t.t'); git(p.root, 'config', 'user.name', 't'); git(p.root, 'add', '-A'); git(p.root, 'commit', '-qm', 'b');
  const r = approve(p.root, '--bootstrap'); assert.equal(r.status, 1); assert.match(r.stdout, /PL033|PL034/); assert.doesNotMatch(r.stdout, /BOOTSTRAP/);
});
