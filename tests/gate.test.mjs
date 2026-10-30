import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, run } from './helpers.mjs';

const CHECKS = path.join(REPO, '01-TOOLS/checks.sh');
const gate = (pkg, env = {}, args = []) => {
  const dir = tmp('af-gate-');
  write(path.join(dir, 'package.json'), JSON.stringify(pkg));
  const r = run('bash', [CHECKS, ...args], { cwd: dir, env: { ...process.env, FACTORY_JOBS_DIR: path.join(dir, 'jobs'), ...env } });
  return { ...r, dir };
};

test('gate FALLA si los tests fallan (antes devolvia siempre 0)', () => {
  assert.notEqual(gate({ scripts: { test: 'exit 1' } }).status, 0);
});
test('gate pasa si los tests pasan', () => {
  assert.equal(gate({ scripts: { test: 'exit 0' } }).status, 0);
});
test('gate FALLA si no hay tests (TDD)', () => {
  assert.notEqual(gate({}).status, 0);
  assert.notEqual(gate({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }).status, 0);
});
test('FACTORY_ALLOW_NO_TESTS=1 permite proyectos sin tests', () => {
  assert.equal(gate({}, { FACTORY_ALLOW_NO_TESTS: '1' }).status, 0);
});
test('FACTORY_TEST_CMD tiene prioridad', () => {
  assert.notEqual(gate({ scripts: { test: 'exit 0' } }, { FACTORY_TEST_CMD: 'exit 3' }).status, 0);
});
test('escribe gate.md con GATE: PASS/FAIL en la primera linea', () => {
  const ok = gate({ scripts: { test: 'exit 0' } }, {}, ['j1']);
  assert.match(fs.readFileSync(path.join(ok.dir, 'jobs/j1/gate.md'), 'utf8'), /^GATE: PASS/);
  const bad = gate({ scripts: { test: 'exit 1' } }, {}, ['j2']);
  assert.match(fs.readFileSync(path.join(bad.dir, 'jobs/j2/gate.md'), 'utf8'), /^GATE: FAIL/);
});
