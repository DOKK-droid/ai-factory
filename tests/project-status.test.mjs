// project-status.mjs: estado de cada REQ y UC derivado de los jobs (solo lectura).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, write, run } from './helpers.mjs';
import { SPEC_FULL } from './ns-fixture.mjs';
import { makeProject, DOC_NAMES, LINT } from './project-fixture.mjs';
import { edit, hashOf } from './trace-fixture.mjs';

const STATUS = path.join(REPO, 'factory/scripts/project-status.mjs');

function statusRoot() {
  const p = makeProject(); const r = run('node', [LINT, 'approve', ...DOC_NAMES, '--root', p.root]); assert.equal(r.status, 0, r.stdout);
  p.jobs = path.join(p.root, 'factory/jobs'); p.page = (id, text) => write(path.join(p.root, '02-DOCS/wiki/jobs', `${id}.md`), text);
  p.job = (id, { impl = ['REQ-F-1'], gate = null, pr = null, lock = null, sha = 'a'.repeat(40), tests = 12 } = {}) => {
    write(path.join(p.jobs, id, 'spec.md'), SPEC_FULL({ implementa: [impl.join(', '), null] }));
    if (gate) write(path.join(p.jobs, id, 'gate.md'), `GATE: ${gate}\nCOMMIT: ${sha}\nGATE_FAIL_STREAK: 0\n\n-> tests cambiados (node:test): tests/a.test.mjs\n   OK: ${tests} casos ejecutados de los archivos cambiados\n=== Gate: ${gate} ===\n`);
    if (pr) write(path.join(p.jobs, id, 'pr.url'), `${pr}\n`);
    if (lock) write(path.join(p.jobs, id, 'implementa.lock'), JSON.stringify({ version: 1, ids: Object.fromEntries(lock.map((i) => [i, hashOf(p.root, i)])) }));
  };
  p.st = (...a) => run('node', [STATUS, '--root', p.root, ...a], { cwd: p.root });
  p.json = () => { const r = p.st('--json'); assert.equal(r.status, 0, r.stderr); return Object.fromEntries(JSON.parse(r.stdout).items.map((i) => [i.id, i])); };
  return p;
}
test('project-status: sin jobs, todo REQ y UC figura «sin job»; las entidades no se listan', () => {
  const p = statusRoot(); const j = p.json();
  assert.deepEqual(Object.keys(j), ['REQ-F-1', 'REQ-F-2', 'REQ-NF-1', 'UC-1', 'UC-2']);
  for (const i of Object.values(j)) { assert.equal(i.estado, 'sin job'); assert.deepEqual(i.jobs, []); }
  const t = p.st(); assert.equal(t.status, 0); assert.match(t.stdout, /^REQ-F-1\s+sin job/m); assert.doesNotMatch(t.stdout, /ENT-/);
});
test('CA-I15.2: el estado de un REQ cambia al aparecer su job: en curso -> implementado', () => {
  const p = statusRoot(); p.job('j1', { impl: ['REQ-F-1', 'UC-1'] });
  let j = p.json(); assert.equal(j['REQ-F-1'].estado, 'en curso'); assert.equal(j['UC-1'].estado, 'en curso'); assert.equal(j['REQ-F-2'].estado, 'sin job'); assert.equal(j['REQ-F-1'].jobs[0].job, 'j1');
  p.job('j1', { impl: ['REQ-F-1', 'UC-1'], gate: 'PASS' }); assert.equal(p.json()['REQ-F-1'].estado, 'en curso', 'gate PASS sin PR ni página no es entregado');
  p.job('j1', { impl: ['REQ-F-1', 'UC-1'], gate: 'FAIL', pr: 'https://github.com/o/r/pull/7' }); assert.equal(p.json()['REQ-F-1'].estado, 'en curso', 'gate FAIL no es implementado');
  p.job('j1', { impl: ['REQ-F-1', 'UC-1'], gate: 'PASS', pr: 'https://github.com/o/r/pull/7', tests: 12 });
  j = p.json(); const x = j['REQ-F-1']; assert.equal(x.estado, 'implementado'); assert.equal(x.jobs[0].pr, 'https://github.com/o/r/pull/7'); assert.equal(x.jobs[0].commit, 'a'.repeat(7)); assert.equal(x.jobs[0].gate, 'PASS'); assert.equal(x.jobs[0].tests, 12); assert.equal(x.jobs[0].verificable, true);
  assert.match(p.st().stdout, /^REQ-F-1\s+implementado\s+job j1 \(PR https:\/\/github\.com\/o\/r\/pull\/7, commit aaaaaaa, gate PASS, 12 tests\)/m);
});
test('project-status: la página del job (versionada) basta fuera del equipo local, y se marca «no verificable aquí»', () => {
  const p = statusRoot(); p.page('viejo', '# viejo\n\nImplementa: REQ-F-2, UC-2\n\n## Pruebas\nGate sobre el commit `bbbbbbb`: GATE: PASS\n');
  const j = p.json(); assert.equal(j['REQ-F-2'].estado, 'implementado'); const x = j['REQ-F-2'].jobs[0];
  assert.equal(x.job, 'viejo'); assert.equal(x.commit, 'bbbbbbb'); assert.equal(x.verificable, false); assert.equal(x.pr, null); assert.equal(x.gate, null);
  assert.match(p.st().stdout, /^REQ-F-2\s+implementado\s+job viejo \(commit bbbbbbb, no verificable aquí: sin gate\.md\)/m);
  p.job('viejo', { impl: ['REQ-F-2', 'UC-2'], gate: 'PASS', sha: 'c'.repeat(40) }); assert.equal(p.json()['REQ-F-2'].jobs[0].verificable, true, 'con gate.md local sí se verifica');
});
test('project-status: un job en curso prima sobre uno entregado; un job entregado que ya no es vigente sale «requiere revisión»', () => {
  const p = statusRoot(); p.job('a', { impl: ['REQ-F-1', 'UC-1'], gate: 'PASS', pr: 'u', lock: ['REQ-F-1', 'UC-1'] }); assert.equal(p.json()['REQ-F-1'].estado, 'implementado');
  p.job('b', { impl: ['REQ-F-1'] }); const j = p.json(); assert.equal(j['REQ-F-1'].estado, 'en curso'); assert.deepEqual(j['REQ-F-1'].jobs.map((x) => x.job).sort(), ['a', 'b']);
  fs.rmSync(path.join(p.jobs, 'b'), { recursive: true });
  edit(path.join(p.root, '02-DOCS/wiki/project/01-requisitos.md'), 'crear un [[Pedido]]', 'crear y cancelar un [[Pedido]]');   // REQ-F-1 cambia tras el job
  const k = p.json(); assert.equal(k['REQ-F-1'].estado, 'requiere revisión'); assert.deepEqual(k['REQ-F-1'].jobs[0].cambiados, ['REQ-F-1']);
  assert.equal(k['UC-1'].estado, 'implementado', 'UC-1 no cambió'); assert.match(p.st().stdout, /^REQ-F-1\s+requiere revisión\s+job a .*REQ-F-1 cambió/m);
  edit(path.join(p.root, '02-DOCS/wiki/project/01-requisitos.md'), 'crear y cancelar un [[Pedido]]', 'crear un [[Pedido]]'); assert.equal(p.json()['REQ-F-1'].estado, 'implementado');
});
test('project-status: es de solo lectura, tolera jobs ilegibles y sin base no inventa nada', () => {
  const p = statusRoot(); p.job('a', { gate: 'PASS', pr: 'u', lock: ['REQ-F-1'] }); write(path.join(p.jobs, 'roto/spec.md'), '\0\0basura'); write(path.join(p.jobs, 'roto/implementa.lock'), '{no json'); write(path.join(p.jobs, 'job.json'), '{}');
  const snap = () => run('bash', ['-c', `cd "${p.root}" && find . -type f -printf '%p %T@ %s\\n' | sort`]).stdout;
  const antes = snap(); assert.equal(p.st().status, 0); assert.equal(p.st('--json').status, 0); assert.equal(snap(), antes, 'project-status escribió algo');
  assert.equal(p.json()['REQ-F-1'].estado, 'implementado');
  const vacio = statusRoot(); fs.rmSync(path.join(vacio.root, '02-DOCS/wiki/project'), { recursive: true }); const r = vacio.st(); assert.equal(r.status, 0); assert.match(r.stdout, /no hay base documental/i);
  assert.deepEqual(JSON.parse(vacio.st('--json').stdout).items, []);
  assert.equal(p.st('--nope').status, 64);
});
test('project-status: los jobs se leen de --jobs-dir / FACTORY_JOBS_DIR', () => {
  const p = statusRoot(); const otro = path.join(p.root, 'otros'); write(path.join(otro, 'z/spec.md'), SPEC_FULL({ implementa: ['REQ-F-2', null] }));
  assert.equal(p.json()['REQ-F-2'].estado, 'sin job');
  const a = run('node', [STATUS, '--root', p.root, '--json', '--jobs-dir', otro], { cwd: p.root }); assert.equal(JSON.parse(a.stdout).items.find((i) => i.id === 'REQ-F-2').estado, 'en curso');
  const b = run('node', [STATUS, '--root', p.root, '--json'], { cwd: p.root, env: { ...process.env, FACTORY_JOBS_DIR: otro } }); assert.equal(JSON.parse(b.stdout).items.find((i) => i.id === 'REQ-F-2').estado, 'en curso');
});

