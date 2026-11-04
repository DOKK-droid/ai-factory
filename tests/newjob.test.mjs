import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, write, run, git, makeRepo } from './helpers.mjs';

const NEW = path.join(REPO, '01-TOOLS/new-job.sh');
const mk = () => { const d = makeRepo({ '.gitignore': 'factory/jobs/\nfactory/worktrees/\n' }); git(d, 'checkout', '-q', 'main'); return d; };
const nj = (d, id, env = {}) => run('bash', [NEW, id], { cwd: d, env: { ...process.env, ...env } });

test('crea rama factory/<id>, worktree ignorada y job.json', () => {
  const d = mk(); const r = nj(d, 'job-1');
  assert.equal(r.status, 0, r.stderr);
  const wt = path.join(d, 'factory/worktrees/job-1');
  assert.ok(fs.existsSync(path.join(wt, 'src/app.js')));
  assert.equal(git(wt, 'branch', '--show-current').trim(), 'factory/job-1');
  const j = JSON.parse(fs.readFileSync(path.join(d, 'factory/jobs/job-1/job.json'), 'utf8'));
  assert.equal(j.branch, 'factory/job-1'); assert.equal(j.worktree, wt);
  assert.equal(git(d, 'status', '--porcelain').trim(), '');          // worktree y jobs no ensucian el checkout principal
});
test('lo que hay sin commitear en el checkout principal NO pasa al job (la causa del commit contaminado)', () => {
  const d = mk();
  fs.rmSync(path.join(d, 'tests/app.test.js'));                       // borrado pendiente, como la limpieza de duplicados
  write(path.join(d, 'src/app.js'), 'export const a = 999;\n');       // modificacion pendiente
  const r = nj(d, 'job-2');
  assert.equal(r.status, 0); assert.match(r.stdout, /AVISO: tu checkout principal tiene cambios sin commitear/);
  const wt = path.join(d, 'factory/worktrees/job-2');
  assert.ok(fs.existsSync(path.join(wt, 'tests/app.test.js')));
  assert.equal(fs.readFileSync(path.join(wt, 'src/app.js'), 'utf8'), 'export const a = 1;\n');
});
test('rechaza ids invalidos, duplicados y ejecucion desde una worktree', () => {
  const d = mk();
  for (const bad of ['../x', 'a b', '-x', 'a/b', '', 'x'.repeat(70)]) assert.notEqual(nj(d, bad).status, 0, `id ${bad}`);
  assert.equal(nj(d, 'ok-1').status, 0); assert.notEqual(nj(d, 'ok-1').status, 0);
  const r = run('bash', [NEW, 'otro'], { cwd: path.join(d, 'factory/worktrees/ok-1') });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /checkout principal/);
});
test('sin rama base => error claro', () => {
  const d = mk(); assert.notEqual(nj(d, 'j3', { FACTORY_BASE: 'no-existe' }).status, 0);
});
