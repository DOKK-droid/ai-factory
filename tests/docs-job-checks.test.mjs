// checks.sh en un job kind: docs (rama 6): mismo formato de gate.md (GATE / COMMIT / GATE_FAIL_STREAK), gate propio de documentacion,
// sin ejecutar los tests del proyecto. Un job de codigo (o un job.json antiguo sin kind) sigue pasando por el gate de siempre.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, run, write } from './helpers.mjs';
import { docsJob, ROW } from './docs-fixture.mjs';
import { fx } from './ns-fixture.mjs';

const CHECKS = path.join(REPO, '01-TOOLS/checks.sh');
const checks = (f, env = {}, id = f.id) => run('bash', [CHECKS, id], { cwd: f.wt, env: f.env(env) });
const gateMd = (f) => fs.readFileSync(path.join(f.job, 'gate.md'), 'utf8');
const REQ2 = ['debe listar los pedidos', 'debe listar y filtrar los pedidos'];
const ready = () => { const f = docsJob(); f.agentEdit('01-requisitos', ...REQ2); f.commitProject(); f.marcarDesactualizado('02-casos-de-uso'); f.commitProject(); return f; };

test('docs: gate PASS en el formato de siempre, sin runner de tests y sin ejecutar el del proyecto', () => {
  const f = ready(); const marca = path.join(f.repo, 'tests-ejecutados');
  const r = checks(f, { FACTORY_TEST_CMD: `touch ${marca}; exit 1` });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const g = gateMd(f); const l = g.split('\n');
  assert.equal(l[0], 'GATE: PASS'); assert.match(l[1], /^COMMIT: [0-9a-f]{40}$/); assert.equal(l[1], `COMMIT: ${f.head()}`); assert.equal(l[2], 'GATE_FAIL_STREAK: 0');
  assert.match(g, /=== Gate: PASS ===/); assert.match(g, /alcance: OK/);
  assert.equal(fs.existsSync(marca), false, 'un job docs no ejecuta los tests del proyecto');
  assert.doesNotMatch(g, /tests:|lint:|typecheck:/);
});
test('docs: un archivo fuera de la base => GATE: FAIL con FUERA_DE_ALCANCE y la racha de fallos sube; al corregir vuelve a PASS y la racha a 0', () => {
  const f = ready(); write(path.join(f.wt, 'src/x.js'), 'export {}\n');
  const r = checks(f); assert.equal(r.status, 1); assert.match(gateMd(f), /^GATE: FAIL\nCOMMIT: [0-9a-f]{40}\nGATE_FAIL_STREAK: 1\n/); assert.match(gateMd(f), /^FUERA_DE_ALCANCE\tsrc\/x\.js$/m);
  checks(f); assert.match(gateMd(f), /GATE_FAIL_STREAK: 2/);
  fs.rmSync(path.join(f.wt, 'src/x.js')); const ok = checks(f); assert.equal(ok.status, 0, ok.stdout); assert.match(gateMd(f), /^GATE: PASS\nCOMMIT: [0-9a-f]{40}\nGATE_FAIL_STREAK: 0\n/);
});
test('docs: lo que falla en el gate lo entiende docs-job state --phase fix (integracion gate.md -> dueño)', () => {
  const f = docsJob(); f.agentEdit('01-requisitos', ...REQ2); f.agentEdit('01-requisitos', 'debe listar y filtrar los pedidos.', 'debe listar y filtrar los pedidos de UC-99.'); f.commitProject();
  assert.equal(checks(f).status, 1);
  const r = f.docsState('fix'); assert.equal(r.first, 'WORK', r.raw); assert.equal(r.get('OWNER')[0], 'system-analyst'); assert.match(r.get('WHY').join(' '), /UC-99/);
  const g = docsJob({ approve: false }); g.agentEdit('01-requisitos', ...REQ2, { stale: false }); g.agentEdit('01-requisitos', '[FUENTE: discovery.md#Q-1]', '[PENDIENTE]', { stale: false }); g.commitProject();
  assert.equal(checks(g).status, 1); assert.equal(g.docsState('fix').first, 'HUMAN');
});
test('docs: un job.json con un kind raro o ilegible falla cerrado (GATE: FAIL), nunca se salta comprobaciones', () => {
  const f = ready(); const jf = path.join(f.job, 'job.json'); const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
  for (const kind of ['otro', 7, null, '']) { fs.writeFileSync(jf, JSON.stringify({ ...j, kind })); const r = checks(f, { FACTORY_TEST_CMD: 'true' }); assert.equal(r.status, 1, String(kind)); assert.match(gateMd(f), /^GATE: FAIL/); assert.match(gateMd(f), /kind/); }
  fs.writeFileSync(jf, '{ no es json'); assert.equal(checks(f, { FACTORY_TEST_CMD: 'true' }).status, 1);
});
test('code: un job de codigo (con kind: code o sin kind en job.json) sigue exigiendo y ejecutando los tests', () => {
  for (const withKind of [true, false]) {
    const f = fx({ tools: true }); f.newJob(); f.input(); f.spec(); f.confirm(); f.commit();
    const jf = path.join(f.job, 'job.json'); const j = JSON.parse(fs.readFileSync(jf, 'utf8')); assert.equal(j.kind, 'code');
    if (!withKind) { delete j.kind; fs.writeFileSync(jf, JSON.stringify(j)); }
    assert.equal(checks(f, { FACTORY_TEST_CMD: 'exit 1' }).status, 1, `kind=${withKind}`); assert.match(gateMd(f), /^GATE: FAIL/);
    assert.equal(checks(f, { FACTORY_TEST_CMD: 'true' }).status, 0, `kind=${withKind}`); assert.match(gateMd(f), /^GATE: PASS/);
    assert.match(gateMd(f), /tests: /);
  }
});
test('sin job-id el gate es el de codigo (no hay job.json que consultar)', () => {
  const f = fx({ tools: true }); f.newJob(); f.input(); f.spec(); f.commit();
  const r = run('bash', [CHECKS], { cwd: f.wt, env: f.env({ FACTORY_TEST_CMD: 'exit 1' }) }); assert.equal(r.status, 1);
});
test('docs: si node no logra decir el kind de job.json (no imprime nada) el gate falla cerrado, no asume codigo', () => {
  const f = ready();
  const real = run('bash', ['-c', 'command -v node'], { encoding: 'utf8' }).stdout.trim();
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'af-nodeshim-'));
  fs.writeFileSync(path.join(dir, 'node'), `#!/usr/bin/env bash\nif [ "$1" = "-p" ] && [[ "$*" == *job.json* ]]; then exit 0; fi\nexec "${real}" "$@"\n`); fs.chmodSync(path.join(dir, 'node'), 0o755);
  const r = run('bash', [CHECKS, f.id], { cwd: f.wt, env: f.env({ FACTORY_TEST_CMD: 'true', PATH: `${dir}:${process.env.PATH}` }) });
  assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(gateMd(f), /^GATE: FAIL/); assert.match(gateMd(f), /kind/);
});
