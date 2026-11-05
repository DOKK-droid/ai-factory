// Falsos positivos reales del guard (reporte del e2e): leer/ejecutar rutas protegidas con 2>&1 no es escribirlas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBash, redirectTargets, tokenize } from '../factory/scripts/command-guard.mjs';

const ALLOWED = [
  'bash 01-TOOLS/new-job.sh job-prueba-001 2>&1',
  'bash 01-TOOLS/checks.sh job-x 2>&1 | tail -20',
  'bash 01-TOOLS/launch-reviewers.sh job-x 1 2>&1',
  'node 01-TOOLS/intake.js --issue 12 2>/dev/null',
  'node factory/scripts/validate-models.mjs 2>&1',
  'cat factory/config.json 2>&1',
  'ls .hooks/ 2>&1',
  'ls .opencode/plugins/ 2>/dev/null',
  'ls -la .opencode/agent/ &> /dev/null',
  'cat factory/logs/blocked.log',
  'bash .hooks/spec-first-gate.sh >&2',
  'grep -n "git push" factory/templates/managed-opencode.json 2>&1',
  'diff factory/config.json /tmp/x > /tmp/out.txt',
  'bash 01-TOOLS/risk.sh job-x > factory/jobs/job-x/risk.txt 2>&1',
  'echo hola > factory/jobs/job-x/notes.md',
];
const BLOCKED = [
  'echo x > opencode.json',
  'echo x >> factory/config.json',
  'echo x>factory/config.json',
  'echo x >| factory/config.json',
  'echo x &> .hooks/pre-commit',
  'echo x 2> 01-TOOLS/checks.sh',
  'cat a | tee .opencode/plugins/factory-guard.js',
  'cp /tmp/x factory/scripts/command-guard.mjs',
  'mv /tmp/x 01-TOOLS/risk.sh',
  'rm 01-TOOLS/checks.sh',
  'rm -r .hooks',
  'sed -i s/a/b/ factory/config.json',
  'dd if=/tmp/x of=opencode.json',
  'touch factory/logs/RESET',
  'rm factory/logs/BLOCKED.md',
  'git checkout -- factory/config.json',
  'git restore .opencode/agent/builder.md',
  'bash -c "echo x > opencode.json"',
  'echo x > factory/logs/blocked.log',
];

for (const c of ALLOWED) test(`permitido: ${c}`, () => assert.equal(classifyBash(c).blocked, false, JSON.stringify(classifyBash(c))));
for (const c of BLOCKED) test(`bloqueado: ${c}`, () => {
  const r = classifyBash(c);
  assert.equal(r.blocked, true);
  assert.equal(r.kind, 'grave');
});

test('redirectTargets ignora duplicados de descriptor y encuentra destinos', () => {
  assert.deepEqual(redirectTargets(tokenize('cmd 2>&1')), []);
  assert.deepEqual(redirectTargets(tokenize('cmd >&2')), []);
  assert.deepEqual(redirectTargets(tokenize('cmd > a 2>&1')), ['a']);
  assert.deepEqual(redirectTargets(tokenize('cmd >>a')), ['a']);
  assert.deepEqual(redirectTargets(tokenize('cmd &>a')), ['a']);
  assert.deepEqual(redirectTargets(tokenize('cmd 2>b')), ['b']);
});

test('los errores de forma son kind=policy; main/force/rodeos son kind=grave', () => {
  assert.equal(classifyBash('git push origin main').kind, 'grave');
  assert.equal(classifyBash('git push -u origin factory/j --force').kind, 'grave');
  assert.equal(classifyBash('git push origin').kind, 'policy');
  assert.equal(classifyBash('git checkout main').kind, 'policy');
  assert.equal(classifyBash('gh pr create --title x').kind, 'policy');
  assert.equal(classifyBash('echo FACTORY_HUMAN=1').kind, 'grave');
});

test('gate.md y los reviews de un job solo los escriben los scripts: ningun agente, ni por edit ni por bash', async () => {
  const { classifyTool } = await import('../factory/scripts/command-guard.mjs');
  for (const f of ['factory/jobs/j1/gate.md', '/home/u/ai-factory/factory/jobs/j1/gate.md', 'factory/jobs/j1/round-1/review-code.md']) {
    assert.equal(classifyTool('write', { filePath: f }).blocked, true, f);
    assert.equal(classifyBash(`echo x > ${f}`).blocked, true, f);
    assert.equal(classifyBash(`tee ${f}`).blocked, true, f);
  }
  // leer y ejecutar los scripts que los producen sigue permitido; decision/human/spec los escriben sus agentes
  assert.equal(classifyBash('cat factory/jobs/j1/gate.md').blocked, false);
  assert.equal(classifyBash('cd factory/worktrees/j1 && bash 01-TOOLS/checks.sh j1 2>&1').blocked, false);
  for (const f of ['spec.md', 'tasks.md', 'decision.md', 'human.md', 'input.md', 'trace.md'])
    assert.equal(classifyTool('write', { filePath: `factory/jobs/j1/${f}` }).blocked, false, f);
});
