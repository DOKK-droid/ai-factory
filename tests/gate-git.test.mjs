import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, run, git, makeRepo, commitAll } from './helpers.mjs';

const CHECKS = path.join(REPO, '01-TOOLS/checks.sh');
const SPEC = '# Spec\nSurface: none\n\nAlcance:\n- src/**\n- tests/**\n\n1. criterio\n';

/** Repo + job con spec. `mutate` cambia el repo (en la rama feat) antes de ejecutar el gate. */
function gate({ mutate = () => {}, spec = SPEC, env = {}, extra = {}, job = 'job1', cwdWorktree = false } = {}) {
  const base = { 'package.json': '{"name":"t","scripts":{"test":"exit 0"}}\n', '.gitignore': 'factory/jobs/\nfactory/worktrees/\njobs/\n', ...extra };
  const repo = makeRepo(base);
  if (spec !== null) write(path.join(repo, 'jobs', job, 'spec.md'), spec);
  let cwd = repo;
  if (cwdWorktree) { cwd = path.join(repo, 'factory/worktrees/w1'); git(repo, 'worktree', 'add', '-q', '-b', 'factory/w1', cwd, 'main'); }
  mutate(cwd);
  const r = run('bash', [CHECKS, job], { cwd, env: { ...process.env, FACTORY_BASE: 'main', FACTORY_JOBS_DIR: path.join(repo, 'jobs'), ...env } });
  const gateMd = fs.existsSync(path.join(repo, 'jobs', job, 'gate.md')) ? fs.readFileSync(path.join(repo, 'jobs', job, 'gate.md'), 'utf8') : '';
  return { ...r, gateMd, repo };
}
const first = (g) => g.gateMd.split('\n')[0];

test('REPRODUCE el job e2e: backticks con barra invertida + test que importa expect de node:test => FAIL', () => {
  const g = gate({ mutate: (d) => {
    write(path.join(d, 'src/formatAttempts.js'), 'export function formatAttempts(a, max = 5) {\n  return \\`${Math.min(a, max)}/${max}\\`;\n}\n');
    write(path.join(d, 'tests/formatAttempts.test.js'), "import { describe, it, expect } from 'node:test';\nimport { formatAttempts } from '../src/formatAttempts.js';\ndescribe('x', () => { it('y', () => { expect(formatAttempts(2)).toBe('2/5'); }); });\n");
    commitAll(d, 'job');
  } });
  assert.notEqual(g.status, 0); assert.equal(first(g), 'GATE: FAIL'); assert.match(g.gateMd, /SINTAXIS src\/formatAttempts\.js/);
});
test('codigo y test validos con node:test => PASS y los casos SE EJECUTAN', () => {
  const g = gate({ mutate: (d) => {
    write(path.join(d, 'src/f.js'), 'export const f = (a) => `${a}/5`;\n');
    write(path.join(d, 'tests/f.test.js'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { f } from '../src/f.js';\ntest('f', () => assert.equal(f(2), '2/5'));\n");
    commitAll(d, 'job');
  } });
  assert.equal(g.status, 0, g.stdout); assert.equal(first(g), 'GATE: PASS'); assert.match(g.gateMd, /1 casos ejecutados/);
});
test('un test cambiado que FALLA hace fallar el gate aunque la suite global pase', () => {
  const g = gate({ mutate: (d) => {
    write(path.join(d, 'tests/bad.test.js'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('bad', () => assert.equal(1, 2));\n");
    commitAll(d, 'job');
  } });
  assert.notEqual(g.status, 0); assert.equal(first(g), 'GATE: FAIL');
});
test('test de otro framework sin runner => PASS pero marcado UNVERIFIED_TESTS (nunca verde silencioso)', () => {
  const g = gate({ mutate: (d) => { write(path.join(d, 'tests/j.test.js'), "describe('a', () => { it('b', () => { expect(1).toBe(1); }); });\n"); commitAll(d, 'job'); } });
  assert.equal(g.status, 0); assert.equal(first(g), 'GATE: PASS'); assert.match(g.gateMd, /^UNVERIFIED_TESTS: tests\/j\.test\.js$/m);
});
test('alcance: cambio fuera de alcance y borrado ajeno => FAIL (el commit contaminado del job e2e)', () => {
  const g = gate({ extra: { '.agents/skills/code-review/SKILL.md': '# skill\n' }, mutate: (d) => {
    write(path.join(d, 'src/ok.js'), 'export const ok = 1;\n');
    git(d, 'rm', '-q', '.agents/skills/code-review/SKILL.md'); commitAll(d, 'job');
  } });
  assert.notEqual(g.status, 0); assert.match(g.gateMd, /BORRADO_FUERA_DE_ALCANCE\t\.agents\/skills\/code-review\/SKILL\.md/);
});
test('alcance: un archivo modificado fuera de la lista => FAIL; spec ausente o sin Alcance => FAIL', () => {
  assert.notEqual(gate({ mutate: (d) => { write(path.join(d, 'README.md'), 'x'); commitAll(d, 'j'); } }).status, 0);
  assert.notEqual(gate({ spec: null, mutate: (d) => { write(path.join(d, 'src/a.js'), 'export const a = 1;\n'); commitAll(d, 'j'); } }).status, 0);
  assert.notEqual(gate({ spec: '# Spec\nSurface: none\n', mutate: (d) => { write(path.join(d, 'src/a.js'), 'export const a = 1;\n'); commitAll(d, 'j'); } }).status, 0);
});
test('sintaxis: JSON y shell invalidos cambiados => FAIL', () => {
  const sp = '# s\nAlcance:\n- src/**\n- tests/**\n- cfg.json\n- run.sh\n';
  assert.notEqual(gate({ spec: sp, mutate: (d) => { write(path.join(d, 'cfg.json'), '{no json'); commitAll(d, 'j'); } }).status, 0);
  assert.notEqual(gate({ spec: sp, mutate: (d) => { write(path.join(d, 'run.sh'), 'if then fi\n'); commitAll(d, 'j'); } }).status, 0);
});
test('dentro de una worktree anidada: gate.md se escribe en la carpeta de jobs del checkout principal', () => {
  const g = gate({ cwdWorktree: true, mutate: (d) => { write(path.join(d, 'src/w.js'), 'export const w = 1;\n'); commitAll(d, 'j'); } });
  assert.equal(g.status, 0, g.stdout); assert.equal(first(g), 'GATE: PASS');
});

// ---- parche 8: gate.md atado al commit y racha de fallos ----
test('gate.md: linea 1 GATE:, luego COMMIT: <sha de HEAD> y GATE_FAIL_STREAK: 0', () => {
  const g = gate({ mutate: (d) => { write(path.join(d, 'src/a.js'), 'export const b = 2;\n'); commitAll(d, 'job'); } });
  const head = git(g.repo, 'rev-parse', 'HEAD').trim();
  assert.equal(g.status, 0, g.stdout);
  assert.deepEqual(g.gateMd.split('\n').slice(0, 3), ['GATE: PASS', `COMMIT: ${head}`, 'GATE_FAIL_STREAK: 0']);
});
test('gate.md con tests sin ejecutar: UNVERIFIED_TESTS sigue en el archivo y la linea 1 no se mueve', () => {
  const g = gate({ extra: { 'package.json': '{"name":"t","scripts":{"test":"exit 0"}}\n' }, mutate: (d) => { write(path.join(d, 'tests/x.test.ts'), 'export {};\n'); commitAll(d, 'job'); } });
  assert.equal(first(g), 'GATE: PASS'); assert.match(g.gateMd, /^COMMIT: [0-9a-f]{40}$/m); assert.match(g.gateMd, /^UNVERIFIED_TESTS: /m);
});
test('GATE_FAIL_STREAK cuenta FAIL seguidos y un PASS lo reinicia; el COMMIT sigue a HEAD', () => {
  const repo = makeRepo({ 'package.json': '{"name":"t","scripts":{"test":"exit 0"}}\n', '.gitignore': 'jobs/\n' });
  write(path.join(repo, 'jobs/j/spec.md'), SPEC);
  const go = (cmd) => { run('bash', [CHECKS, 'j'], { cwd: repo, env: { ...process.env, FACTORY_BASE: 'main', FACTORY_JOBS_DIR: path.join(repo, 'jobs'), FACTORY_TEST_CMD: cmd } });
    return fs.readFileSync(path.join(repo, 'jobs/j/gate.md'), 'utf8').split('\n').slice(0, 3); };
  assert.equal(go('exit 1')[2], 'GATE_FAIL_STREAK: 1'); assert.equal(go('exit 1')[2], 'GATE_FAIL_STREAK: 2');
  write(path.join(repo, 'src/n.js'), 'export const n = 1;\n'); commitAll(repo, 'n');
  const l = go('exit 1'); assert.equal(l[2], 'GATE_FAIL_STREAK: 3'); assert.equal(l[1], `COMMIT: ${git(repo, 'rev-parse', 'HEAD').trim()}`);
  const ok = go('true'); assert.deepEqual([ok[0], ok[2]], ['GATE: PASS', 'GATE_FAIL_STREAK: 0']); assert.equal(go('exit 1')[2], 'GATE_FAIL_STREAK: 1');
});
