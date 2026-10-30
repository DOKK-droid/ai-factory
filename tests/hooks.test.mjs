import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { REPO, tmp, write, run, git, makeRepo, commitAll } from './helpers.mjs';

const HOOKS = path.join(REPO, '.hooks');
const withHooks = (dir) => git(dir, 'config', 'core.hooksPath', path.join(HOOKS, 'git'));
const tryCommit = (dir, env = {}) => run('git', ['commit', '-qm', 'x'], { cwd: dir, env: { ...process.env, ...env } });

test('pre-commit: bloquea commit directo a main', () => {
  const d = makeRepo(); git(d, 'checkout', '-q', 'main'); withHooks(d);
  write(path.join(d, 'a.txt'), 'a'); git(d, 'add', '-A');
  assert.notEqual(tryCommit(d).status, 0);
});
test('pre-commit: humano con FACTORY_HUMAN=1 puede commitear a main', () => {
  const d = makeRepo(); git(d, 'checkout', '-q', 'main'); withHooks(d);
  write(path.join(d, 'a.txt'), 'a'); git(d, 'add', '-A');
  assert.equal(tryCommit(d, { FACTORY_HUMAN: '1' }).status, 0);
});
test('pre-commit: permite commit en rama de trabajo', () => {
  const d = makeRepo(); withHooks(d);
  write(path.join(d, 'a.txt'), 'a'); git(d, 'add', '-A');
  assert.equal(tryCommit(d).status, 0);
});
test('pre-commit: bloquea .env y secretos aunque sea humano', () => {
  const d = makeRepo(); withHooks(d);
  write(path.join(d, '.env'), 'A=1'); git(d, 'add', '-f', '.env');
  assert.notEqual(tryCommit(d, { FACTORY_HUMAN: '1' }).status, 0);
  git(d, 'rm', '-q', '--cached', '.env');
  write(path.join(d, 'k.txt'), 'token=ghp_' + 'a'.repeat(36)); git(d, 'add', '-A');
  assert.notEqual(tryCommit(d, { FACTORY_HUMAN: '1' }).status, 0);
});
test('pre-commit: permite .env.example', () => {
  const d = makeRepo(); withHooks(d);
  write(path.join(d, '.env.example'), 'A=changeme'); git(d, 'add', '-A');
  assert.equal(tryCommit(d).status, 0);
});
test('pre-push: bloquea refs/heads/main, permite ramas y humano', () => {
  const hook = path.join(HOOKS, 'git/pre-push');
  const push = (ref, env = {}) => run('bash', [hook], { input: `refs/heads/x sha ${ref} sha\n`, env: { ...process.env, ...env } });
  assert.notEqual(push('refs/heads/main').status, 0);
  assert.notEqual(push('refs/heads/master').status, 0);
  assert.equal(push('refs/heads/feat/x').status, 0);
  assert.equal(push('refs/heads/main', { FACTORY_HUMAN: '1' }).status, 0);
});

function job(files, cfg = { fast_path: { enabled: true } }) {
  const d = tmp('af-job-');
  for (const [f, t] of Object.entries(files)) write(path.join(d, 'jobs/j1', f), t);
  write(path.join(d, 'cfg.json'), JSON.stringify(cfg));
  return { FACTORY_JOBS_DIR: path.join(d, 'jobs'), FACTORY_CONFIG: path.join(d, 'cfg.json') };
}
const ship = (env) => run('bash', [path.join(HOOKS, 'ship-guard.sh'), 'j1'], { env: { ...process.env, ...env } });

test('ship-guard: solo FAST_PATH + APPROVE + fast_path ON', () => {
  assert.equal(ship(job({ 'human.md': 'FAST_PATH\n', 'decision.md': 'APPROVE\n' })).status, 0);
  assert.notEqual(ship(job({ 'human.md': 'NEEDS_HUMAN\n', 'decision.md': 'APPROVE\n' })).status, 0);
  assert.notEqual(ship(job({ 'human.md': 'FAST_PATH\n', 'decision.md': 'CHANGES\n' })).status, 0);
  assert.notEqual(ship(job({ 'human.md': 'FAST_PATH\n', 'decision.md': 'APPROVE\n' }, { fast_path: { enabled: false } })).status, 0);
  assert.notEqual(ship(job({ 'decision.md': 'APPROVE\n' })).status, 0);
});
test('spec-first-gate: exige Surface y criterios numerados', () => {
  const gate = (spec) => run('bash', [path.join(HOOKS, 'spec-first-gate.sh'), 'j1'], { env: { ...process.env, ...job(spec ? { 'spec.md': spec } : {}) } });
  assert.equal(gate('# s\nSurface: none\n1. criterio\n').status, 0);
  assert.notEqual(gate('# s\n1. criterio\n').status, 0);
  assert.notEqual(gate('# s\nSurface: none\nsin criterios\n').status, 0);
  assert.notEqual(gate(null).status, 0);
});
test('branch-guard: bloquea main/master', () => {
  const g = (b) => run('bash', [path.join(HOOKS, 'branch-guard.sh'), b]).status;
  assert.notEqual(g('main'), 0); assert.notEqual(g('master'), 0); assert.equal(g('feat/x'), 0);
});
test('worktree-reaper: no borra worktrees con cambios sin commitear', () => {
  const d = makeRepo(); git(d, 'checkout', '-q', 'main');
  const wt = path.join(tmp('af-wt-'), 'job-77'); git(d, 'worktree', 'add', '-q', '-b', 'job-77', wt);
  write(path.join(wt, 'dirty.txt'), 'x');
  run('bash', [path.join(HOOKS, 'worktree-reaper.sh'), 'job-77'], { cwd: d });
  assert.match(git(d, 'worktree', 'list'), /job-77/);
  run('bash', [path.join(HOOKS, 'worktree-reaper.sh'), 'job-77'], { cwd: d, env: { ...process.env, FACTORY_FORCE: '1' } });
  assert.doesNotMatch(git(d, 'worktree', 'list'), /job-77/);
});
