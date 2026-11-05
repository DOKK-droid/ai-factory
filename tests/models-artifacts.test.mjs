import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, run } from './helpers.mjs';
import { parseModelsOutput, agentModels } from '../factory/scripts/validate-models.mjs';

const VM = path.join(REPO, 'factory/scripts/validate-models.mjs');
const VA = path.join(REPO, '01-TOOLS/validate-artifacts.sh');

test('parseModelsOutput: ignora cabeceras, colores y lineas que no son provider/modelo', () => {
  const ids = parseModelsOutput('\x1b[32mModelos disponibles\x1b[0m\nopencode/glm-5.3-flash-free\n  opencode-go/gpt-5.6-luna  \n\nTotal: 2\n');
  assert.deepEqual([...ids].sort(), ['opencode-go/gpt-5.6-luna', 'opencode/glm-5.3-flash-free']);
});
function modelsProject(models, agents) {
  const d = tmp('af-vm-');
  for (const [n, m] of Object.entries(agents)) write(path.join(d, `.opencode/agent/${n}.md`), `---\nmodel: ${m}\n---\nx\n`);
  write(path.join(d, 'models.txt'), models.join('\n') + '\n');
  return d;
}
const vm = (d, args = [], env = {}) => run('node', [VM, ...args], { cwd: d, env: { ...process.env, FACTORY_MODELS_FILE: path.join(d, 'models.txt'), ...env } });
test('validate-models: todos existen => 0; uno inexistente => 1 con el ID', () => {
  assert.equal(vm(modelsProject(['a/x', 'b/y'], { one: 'a/x', two: 'b/y' })).status, 0);
  const r = vm(modelsProject(['a/x'], { one: 'a/x', two: 'opencode/deepseek-v4-flash-free' }));
  assert.equal(r.status, 1); assert.match(r.stderr, /NO EXISTE: agente two usa "opencode\/deepseek-v4-flash-free"/);
});
test('validate-models: --agents limita; agente sin model: es error; lista no disponible => 3 (nunca se asume)', () => {
  const d = modelsProject(['a/x'], { one: 'a/x', two: 'zz/zz' });
  assert.equal(vm(d, ['--agents', 'one']).status, 0);
  write(path.join(d, '.opencode/agent/three.md'), '---\ndescription: sin modelo\n---\nx\n');
  assert.equal(vm(d, ['--agents', 'three']).status, 1);
  const r = run('node', [VM], { cwd: d, env: { ...process.env, FACTORY_MODELS_FILE: '', OPENCODE_BIN: '/no/existe/opencode' } });
  assert.equal(r.status, 3);
});
// ---- opencode falso: cuenta llamadas y puede dormir; TMPDIR propio para no tocar la cache real ----
function fakeOpencode(d, { sleep = 0, out = 'a/x\nb/y\n' } = {}) {
  const bin = path.join(d, 'fake-opencode');
  write(bin, `#!/bin/sh\necho x >> "${d}/calls"\n${sleep ? `sleep ${sleep}\n` : ''}printf '${out.replace(/\n/g, '\\n')}'\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}
const calls = (d) => (fs.existsSync(path.join(d, 'calls')) ? fs.readFileSync(path.join(d, 'calls'), 'utf8').trim().split('\n').length : 0);
const vmLive = (d, bin, env = {}) => run('node', [VM], { cwd: d, env: { ...process.env, FACTORY_MODELS_FILE: '', OPENCODE_BIN: bin, TMPDIR: path.join(d, 'tmpdir'), ...env } });
const liveProject = (opts) => { const d = modelsProject(['a/x', 'b/y'], { one: 'a/x', two: 'b/y' }); fs.mkdirSync(path.join(d, 'tmpdir')); return { d, bin: fakeOpencode(d, opts) }; };

test('validate-models: timeout de opencode models => 3 con mensaje de timeout y como subir el limite', () => {
  const { d, bin } = liveProject({ sleep: 2 });
  const r = vmLive(d, bin, { FACTORY_MODELS_TIMEOUT_MS: '200' });
  assert.equal(r.status, 3); assert.match(r.stderr, /timeout/i); assert.match(r.stderr, /FACTORY_MODELS_TIMEOUT_MS/);
  assert.doesNotMatch(r.stderr, /no esta instalado/);
});
test('validate-models: no instalado y salida vacia dan mensajes distintos al timeout', () => {
  const { d } = liveProject();
  const r1 = vmLive(d, '/no/existe/opencode'); assert.equal(r1.status, 3); assert.match(r1.stderr, /no esta instalado/); assert.doesNotMatch(r1.stderr, /timeout/i);
  const empty = liveProject({ out: 'sin modelos aqui\n' });
  const r2 = vmLive(empty.d, empty.bin); assert.equal(r2.status, 3); assert.match(r2.stderr, /vacia|inesperado/); assert.doesNotMatch(r2.stderr, /timeout/i);
});
test('validate-models: FACTORY_MODELS_TIMEOUT_MS invalido => se usa el defecto (300 s), no 0 ni NaN', () => {
  const { d, bin } = liveProject({ sleep: 1 });
  for (const v of ['abc', '-5', '0', '']) assert.equal(vmLive(d, bin, { FACTORY_MODELS_TIMEOUT_MS: v, FACTORY_MODELS_CACHE_TTL_S: '0' }).status, 0, `valor "${v}"`);
});
test('validate-models: cache activa => dos ejecuciones llaman a opencode una vez; TTL=0 => dos', () => {
  const a = liveProject();
  assert.equal(vmLive(a.d, a.bin).status, 0); assert.equal(vmLive(a.d, a.bin).status, 0); assert.equal(calls(a.d), 1);
  const b = liveProject();
  assert.equal(vmLive(b.d, b.bin, { FACTORY_MODELS_CACHE_TTL_S: '0' }).status, 0); assert.equal(vmLive(b.d, b.bin, { FACTORY_MODELS_CACHE_TTL_S: '0' }).status, 0); assert.equal(calls(b.d), 2);
  assert.deepEqual(fs.readdirSync(path.join(b.d, 'tmpdir')), [], 'con TTL=0 no se escribe cache');
});
test('validate-models: cache caducada vuelve a llamar; el archivo de cache es 600', () => {
  const { d, bin } = liveProject();
  vmLive(d, bin);
  const [f] = fs.readdirSync(path.join(d, 'tmpdir')); const p = path.join(d, 'tmpdir', f);
  assert.equal(fs.statSync(p).mode & 0o777, 0o600);
  const old = new Date(Date.now() - 3600 * 1000); fs.utimesSync(p, old, old);
  vmLive(d, bin); assert.equal(calls(d), 2);
});
test('validate-models: una cache vigente pero vacia o corrupta se ignora', () => {
  const { d, bin } = liveProject();
  vmLive(d, bin);
  const [f] = fs.readdirSync(path.join(d, 'tmpdir')); fs.writeFileSync(path.join(d, 'tmpdir', f), 'basura\n');
  assert.equal(vmLive(d, bin).status, 0); assert.equal(calls(d), 2);
});
test('validate-models: NO EXISTE con la lista en cache avisa de FACTORY_MODELS_CACHE_TTL_S=0; con lista fresca no', () => {
  const { d, bin } = liveProject();
  assert.equal(vmLive(d, bin).status, 0);
  write(path.join(d, '.opencode/agent/two.md'), '---\nmodel: c/z\n---\nx\n');
  const r = vmLive(d, bin); assert.equal(r.status, 1); assert.match(r.stderr, /NO EXISTE.*c\/z/); assert.match(r.stderr, /FACTORY_MODELS_CACHE_TTL_S=0/);
  const f = vmLive(d, bin, { FACTORY_MODELS_CACHE_TTL_S: '0' });
  assert.equal(f.status, 1); assert.match(f.stderr, /NO EXISTE.*c\/z/); assert.doesNotMatch(f.stderr, /cache/i);
});
test('validate-models: una salida vacia o invalida nunca se cachea', () => {
  const { d, bin } = liveProject({ out: 'basura\n' });
  vmLive(d, bin); vmLive(d, bin);
  assert.equal(calls(d), 2); assert.deepEqual(fs.readdirSync(path.join(d, 'tmpdir')), []);
});
test('los agentes reales: cada uno declara un modelo', () => {
  const m = agentModels(path.join(REPO, '.opencode/agent'));
  assert.ok(Object.keys(m).length >= 11); for (const [n, id] of Object.entries(m)) assert.match(id || '', /^[\w.-]+\/[\w.:+-]+$/, n);
});
test('reviewers sin herramientas de escritura: edit y bash denegados por completo (el modelo ni las ve)', () => {
  for (const r of ['security', 'ux', 'ui', 'code']) {
    const fm = fs.readFileSync(path.join(REPO, `.opencode/agent/reviewer-${r}.md`), 'utf8').match(/^---\n([\s\S]*?)\n---/)[1];
    assert.match(fm, /^permission:\n {2}edit: deny\n {2}bash: deny\n {2}webfetch: deny$/m, r);
  }
});

function job(files) {
  const d = tmp('af-va-');
  for (const [f, t] of Object.entries(files)) write(path.join(d, 'jobs/j1', f), t);
  return { d, env: { ...process.env, FACTORY_JOBS_DIR: path.join(d, 'jobs') } };
}
const GOOD = 'VERDICT: PASS\nSCORE: 0.9\n\nok\n';
const all = (round, t = GOOD) => Object.fromEntries(['security', 'ux', 'ui', 'code'].map((r) => [`round-${round}/review-${r}.md`, t]));
test('validate-artifacts: formato correcto => 0 y usa el ULTIMO round', () => {
  const { d, env } = job({ ...all(1, 'LGTM\n'), ...all(2) });
  assert.equal(run('bash', [VA, 'j1'], { cwd: d, env }).status, 0);
  assert.notEqual(run('bash', [VA, 'j1', '1'], { cwd: d, env }).status, 0);
});
test('validate-artifacts: SCORE fuera de 0..1, VERDICT raro o falta de review => 1 y sin "OK" engañoso', () => {
  for (const bad of ['VERDICT: PASS\nSCORE: 7\n', 'VERDICT: LGTM\nSCORE: 0.5\n', 'VERDICT: PASS\n']) {
    const { d, env } = job({ ...all(1), 'round-1/review-ui.md': bad });
    const r = run('bash', [VA, 'j1'], { cwd: d, env });
    assert.equal(r.status, 1); assert.doesNotMatch(r.stdout, /OK: .*review-ui\.md/);
  }
  const { d, env } = job({ 'round-1/review-code.md': GOOD });
  assert.match(run('bash', [VA, 'j1'], { cwd: d, env }).stdout, /FAIL: falta .*review-security/);
});
test('validate-artifacts: decision.md valida APPROVE/CHANGES/ESCALATE', () => {
  const ok = job({ ...all(1), 'decision.md': 'APPROVE\n' }); assert.equal(run('bash', [VA, 'j1'], { cwd: ok.d, env: ok.env }).status, 0);
  const bad = job({ ...all(1), 'decision.md': 'Aprobado\n' }); assert.equal(run('bash', [VA, 'j1'], { cwd: bad.d, env: bad.env }).status, 1);
});

// ---- parche 8: validate-artifacts con .commit, lineas extra y VALIDATE_REVIEWS_ONLY ----
test('validate-artifacts: ignora .commit y las lineas extra del gate; VALIDATE_REVIEWS_ONLY omite decision.md', () => {
  const d = tmp('af-va8-'); const job = path.join(d, 'jobs/j');
  for (const r of ['security', 'ux', 'ui', 'code']) write(path.join(job, `round-1/review-${r}.md`), 'VERDICT: PASS\nSCORE: 0.9\n\nok\n');
  write(path.join(job, 'round-1/.commit'), 'a'.repeat(40) + '\n'); write(path.join(job, 'gate.md'), 'GATE: PASS\nCOMMIT: ' + 'a'.repeat(40) + '\nGATE_FAIL_STREAK: 0\n');
  const env = { ...process.env, FACTORY_JOBS_DIR: path.join(d, 'jobs') };
  assert.equal(run('bash', [VA, 'j', '1'], { cwd: d, env }).status, 0);
  write(path.join(job, 'decision.md'), 'quizas\n');
  assert.equal(run('bash', [VA, 'j', '1'], { cwd: d, env }).status, 1);                                     // decision invalida
  assert.equal(run('bash', [VA, 'j', '1'], { cwd: d, env: { ...env, VALIDATE_REVIEWS_ONLY: '1' } }).status, 0); // solo reviews
  write(path.join(job, 'round-1/review-ux.md'), 'Todo bien\n');
  assert.equal(run('bash', [VA, 'j', '1'], { cwd: d, env: { ...env, VALIDATE_REVIEWS_ONLY: '1' } }).status, 1); // un review malo sigue fallando
});
