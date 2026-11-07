// Realineacion del spec con la base (RF-I18) en next-step.sh, y el lock protegido en el guard.
//
// Estos tests dependen de un PARCHE a archivos protegidos (docs/propuestas/rama5-project-traceability.patch, lo aplica el humano).
// Mientras no este aplicado se saltan con un motivo explicito; y un test exige que se aplique entero o nada.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, run, git } from './helpers.mjs';
import { fx, fakeGh, drive, put, parse as parseNs, NEXT } from './ns-fixture.mjs';
import { job, POLICY, IMPL, seedProject } from './trace-fixture.mjs';
import { classifyBash, isProtectedPath } from '../factory/scripts/command-guard.mjs';

const PATCH = 'docs/propuestas/rama5-project-traceability.patch';
const nsText = fs.readFileSync(NEXT, 'utf8');
const nsRealign = nsText.includes('IMPLEMENTA_INVALID');
const nsPage = nsText.includes('"$SPEC_LINT" page');
const guardLock = isProtectedPath('factory/jobs/j/implementa.lock') !== undefined;
const miss = (ok) => (ok ? false : `falta aplicar ${PATCH}`);

test('el parche se aplica entero o no se aplica: ni a medias', () => {
  assert.deepEqual([nsRealign, nsPage, guardLock], [nsRealign, nsRealign, nsRealign], `parche a medias (next-step 3b=${nsRealign}, next-step brain_problem=${nsPage}, guard=${guardLock}); aplica ${PATCH} completo`);
});
test('el parche existe, es un diff válido de los 2 archivos protegidos y se aplica limpio o ya está aplicado', () => {
  const p = path.join(REPO, PATCH); assert.ok(fs.existsSync(p), PATCH);
  const files = [...fs.readFileSync(p, 'utf8').matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(files, ['01-TOOLS/next-step.sh', 'factory/scripts/command-guard.mjs']);
  // Ya aplicado, el parche no se puede revertir limpio en cuanto otro parche posterior toca las mismas lineas: solo se comprueba antes de aplicarlo.
  if (!nsRealign) { const ck = run('git', ['apply', '--check', p], { cwd: REPO }); assert.equal(ck.status, 0, ck.stderr); }
});

// ---------------------------------------------------------------- guard
test('guard: implementa.lock lo escribe stamp, no un agente; stamp y realign siguen siendo ejecutables', { skip: miss(guardLock) }, () => {
  for (const f of ['factory/jobs/j/implementa.lock', '/r/factory/jobs/j/implementa.lock', './factory/jobs/j/implementa.lock']) assert.ok(isProtectedPath(f), f);
  for (const c of ['echo {} > factory/jobs/j/implementa.lock', 'touch factory/jobs/j/implementa.lock', 'cp /dev/null /r/factory/jobs/j/implementa.lock', 'rm factory/jobs/j/implementa.lock']) assert.equal(classifyBash(c).blocked, true, c);
  for (const c of ['node factory/scripts/project-lint.mjs stamp job-1', 'node factory/scripts/project-lint.mjs realign job-1', 'cat factory/jobs/j/implementa.lock', 'node factory/scripts/project-status.mjs --json']) assert.equal(classifyBash(c).blocked, false, c);
  assert.equal(isProtectedPath('factory/jobs/j/implementa.lock.md'), undefined); assert.equal(isProtectedPath('factory/jobs/j/notas-implementa.lock'), undefined);
});

// ---------------------------------------------------------------- next-step 3b
const stop = (r, code) => { assert.equal(r.kind, 'STOP', r.raw); assert.equal(r.value, code, r.raw); assert.equal(r.code, 2); };
const delegate = (r, agent) => { assert.equal(r.kind, 'DELEGATE', r.raw); assert.match(r.value, new RegExp(`^@${agent} \\| `)); assert.equal(r.value.split(' | ').length, 3, r.first); };
const stamped = (f) => { const r = f.ns(); assert.equal(r.kind, 'RUN', r.raw); assert.equal(r.value, `node factory/scripts/project-lint.mjs stamp ${f.id}`); assert.equal(r.state, 'align'); assert.equal(r.phase, 'Análisis y diseño'); assert.equal(run('bash', ['-c', r.value], { cwd: f.repo, env: f.env() }).status, 0); };

test('next-step 3b: con el spec confirmado y citando la base pide el stamp; tras el stamp el flujo sigue (builder)', { skip: miss(nsRealign) }, () => {
  const f = job(); stamped(f); assert.ok(fs.existsSync(f.lock)); const r = f.ns(); delegate(r, 'builder'); assert.equal(r.state, '4');
});
test('CA-I18.1 next-step: cambiar un REQ citado tras la confirmación devuelve el job al spec-writer y exige un spec.ok nuevo', { skip: miss(nsRealign) }, () => {
  const f = job(); stamped(f); delegate(f.ns(), 'builder');
  f.changeReq('crear un [[Pedido]]', 'crear y cancelar un [[Pedido]]');
  let r = f.ns(); delegate(r, 'spec-writer'); assert.equal(r.state, 'align'); assert.equal(r.phase, 'Análisis y diseño'); assert.match(r.why.join(' '), /REQ-F-1 cambió/); assert.match(r.value, /spec\.md,factory\/jobs\/job-1\/tasks\.md$/); assert.match(r.value, /realinear el spec/);
  assert.equal(f.ns().kind, 'DELEGATE', 'si no toca spec.md el job sigue pidiendo la realineación (no avanza solo)');
  f.spec({ implementa: IMPL }); r = f.ns(); stop(r, 'HUMAN_CONFIRM_SPEC'); assert.equal(r.state, '3'); assert.deepEqual(r.cmd, ['touch factory/jobs/job-1/spec.ok']);
  f.confirm(); stamped(f); delegate(f.ns(), 'builder');
  assert.equal(f.readLock().ids['REQ-F-1'].length, 64);
});
test('CA-I18.2 next-step: cambiar un REQ que el spec no cita no toca el job', { skip: miss(nsRealign) }, () => {
  const f = job({ implementa: ['REQ-F-1', 'UC-2'] }); stamped(f);
  f.changeReq('debe listar los pedidos', 'debe listar y filtrar los pedidos'); delegate(f.ns(), 'builder');
});
test('next-step 3b: el builder no puede cobrar un spec obsoleto aunque ya haya commits (se evalúa en cada llamada)', { skip: miss(nsRealign) }, () => {
  const f = job(); stamped(f); f.commit(); f.gate(); f.reviews(1); f.decision(); f.human();
  delegate(f.ns(), 'memory-curator');   // sin cambios en la base el flujo avanza hasta la documentación
  f.changeReq('crear un [[Pedido]]', 'crear y cancelar un [[Pedido]]'); const r = f.ns(); delegate(r, 'spec-writer'); assert.equal(r.state, 'align');
});
test('next-step 3b falla cerrado: lock manipulado o respuesta inesperada de realign => STOP IMPLEMENTA_INVALID', { skip: miss(nsRealign) }, () => {
  const f = job(); stamped(f); const bueno = fs.readFileSync(f.lock, 'utf8');
  put(f.lock, '{no json'); const r = f.ns(); stop(r, 'IMPLEMENTA_INVALID'); assert.equal(r.state, 'align'); assert.match(r.why.join(' '), /ilegible/);
  put(f.lock, bueno); delegate(f.ns(), 'builder');
  const copy = tmp('af-ns-copy-'); fs.cpSync(path.join(REPO, '01-TOOLS'), path.join(copy, '01-TOOLS'), { recursive: true }); fs.cpSync(path.join(REPO, 'factory/scripts'), path.join(copy, 'factory/scripts'), { recursive: true });
  fs.renameSync(path.join(copy, 'factory/scripts/project-lint.mjs'), path.join(copy, 'factory/scripts/project-lint-real.mjs'));   // brain-request y spec-lint importan este módulo: el stub reexporta todo
  const stub = (body) => fs.writeFileSync(path.join(copy, 'factory/scripts/project-lint.mjs'), `export * from './project-lint-real.mjs';\nif (process.argv.includes('realign')) { ${body} }\n`);
  const g = fx({ tools: true, project: { spec_profile: 'full' } }).upTo('confirmed');   // sin project_docs: el gate de 1c no llama al stub
  const goG = () => parseNs(run('bash', [path.join(copy, '01-TOOLS/next-step.sh'), g.id], { cwd: g.repo, env: g.env() }));
  for (const body of ["console.log('QUIZAS')", "console.log('')", 'process.exit(3)', "throw new Error('x')", "console.log('STAMP')", "console.log('DRIFT\\nOWNER: spec-writer\\nFILES: x')", "console.log('INVALID')"]) {
    stub(body); const r = goG(); stop(r, 'IMPLEMENTA_INVALID'); assert.ok(r.why.length, body);
  }
  stub("console.log('NONE')"); delegate(goG(), 'builder'); stub("console.log('OK')"); delegate(goG(), 'builder');
});
test('next-step 3b: sin spec.ok exigido no hay confirmación a la que ligar; sin IDs en el spec tampoco', { skip: miss(nsRealign) }, () => {
  const a = job({ project: { ...POLICY, require_spec_ok: false } }); delegate(a.ns(), 'builder'); assert.ok(!fs.existsSync(a.lock));
  const b = job({ implementa: null }); delegate(b.ns(), 'spec-writer');   // project_docs=required y sin Implementa: lo reclama spec-lint (estado 2), no el bloque 3b
  const c = fx({ project: { spec_profile: 'full' } }).upTo('confirmed'); const r = c.ns(); delegate(r, 'builder'); assert.equal(r.state, '4');
});

const upToHuman = (o = {}) => { const f = job(o); stamped(f); f.commit(); f.gate(); f.reviews(1); f.decision(); f.human(); return f; };

// ---------------------------------------------------------------- un spec realineado invalida gate, reviews y decisión
/** Como un job real: la base cambia en la worktree, se commitea (commit-brain --project), el spec-writer realinea y el humano reconfirma. */
const realign = (f) => {
  f.changeReq('crear un [[Pedido]]', 'crear y cancelar un [[Pedido]]'); git(f.wt, 'add', '02-DOCS/wiki/project'); git(f.wt, 'commit', '-qm', 'docs: cambia REQ-F-1');
  delegate(f.ns(), 'spec-writer'); f.spec({ implementa: IMPL }); stop(f.ns(), 'HUMAN_CONFIRM_SPEC'); f.confirm(); stamped(f);
};
test('un spec realineado invalida gate, reviews y decisión: se repite gate -> 4 reviewers -> approver, que decide', { skip: miss(nsRealign) }, () => {
  const f = upToHuman(); delegate(f.ns(), 'memory-curator');   // sin realineación, lo anterior sigue vigente (el primer stamp no invalida nada)
  realign(f);
  let r = f.ns(); assert.equal(r.kind, 'RUN'); assert.match(r.value, /checks\.sh job-1$/); assert.equal(r.state, '5'); assert.match(r.why.join(), /anterior a implementa\.lock/);
  f.gate();
  r = f.ns(); assert.equal(r.kind, 'RUN'); assert.match(r.value, /launch-reviewers\.sh job-1 2$/); assert.equal(r.state, '7'); assert.match(r.why.join(), /ronda 1 son anteriores a implementa\.lock/);
  f.reviews(2);
  r = f.ns(); delegate(r, 'approver'); assert.equal(r.state, '8');   // la decision de la ronda 1 ya no vale
  f.decision('CHANGES'); r = f.ns(); delegate(r, 'builder'); assert.equal(r.state, '9');                       // el approver decide: no cumple => de nuevo al builder
  f.decision('ESCALATE'); stop(f.ns(), 'ESCALATED');                                                              // o lo escala al humano
  f.decision('APPROVE'); r = f.ns(); assert.equal(r.kind, 'RUN'); assert.match(r.value, /risk\.sh job-1$/);        // o sigue a push/PR
});
test('un spec realineado respeta max_rounds: sin rondas libres decide el humano', { skip: miss(nsRealign) }, () => {
  const f = upToHuman({ project: { ...POLICY, max_rounds: 1 } }); realign(f); f.gate();
  const r = f.ns(); stop(r, 'MAX_ROUNDS'); assert.match(r.why.join(), /ronda 2 y max_rounds=1/);
});
test('un spec realineado que no toca el código tampoco vuelve a pasar por alto el gate: la fecha del lock manda, no el commit', { skip: miss(nsRealign) }, () => {
  const f = upToHuman(); const head = f.head(); realign(f);
  const fresh = run('bash', ['-c', `source "${path.join(REPO, '01-TOOLS/lib.sh')}"; factory_commit_fresh "${head}" HEAD "${f.wt}"`]).status;
  assert.equal(fresh, 0, 'por commit el gate seguiría vigente (solo cambió documentación)'); assert.match(f.ns().value, /checks\.sh/);
});

// ---------------------------------------------------------------- brain_problem: la página del job
test('next-step 11: la página del job debe llevar Implementa con la unión exacta de los IDs del spec', { skip: miss(nsPage) }, () => {
  const f = upToHuman(); f.curate({ implementaLine: false }); let r = f.ns(); delegate(r, 'memory-curator'); assert.match(r.why.join(), /02-DOCS\/wiki\/jobs\/job-1\.md: la página del job está sin la línea 'Implementa: REQ-F-1, REQ-F-2, UC-2'/);
  const page = path.join(f.wt, '02-DOCS/wiki/jobs/job-1.md'); fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('# job job-1\n\n', '# job job-1\n\nImplementa: REQ-F-1\n\n'));
  r = f.ns(); delegate(r, 'memory-curator'); assert.match(r.why.join(), /le faltan: REQ-F-2, UC-2/);
  f.curate(); r = f.ns(); assert.equal(r.kind, 'RUN'); assert.match(r.value, /commit-brain\.sh job-1$/);
});
test('next-step 11: un spec sin IDs de la base no le exige nada a la página', { skip: miss(nsPage) }, () => {
  const f = fx({ project: { spec_profile: 'full' } }); f.upTo('humanized'); f.curate({ implementaLine: false }); const r = f.ns(); assert.equal(r.kind, 'RUN'); assert.match(r.value, /commit-brain\.sh/);
});

// ---------------------------------------------------------------- E2E
test('E2E: base aprobada -> spec con Implementa -> stamp -> código -> página con Implementa -> PR; project-status lo sigue', { skip: miss(nsRealign && nsPage), timeout: 400000 }, () => {
  const f = fx({ tools: true, project: POLICY, id: 'clamp-numeros-261104-ab12' }); seedProject(f); const gh = fakeGh(); f.gh = gh.bin;
  const { actions, final } = drive(f, { humans: { HUMAN_CONFIRM_SPEC: () => f.confirm() }, agents: { 'spec-writer': () => f.spec({ implementa: IMPL }) } });
  assert.equal(final.first, 'DONE', actions.map((a) => a.first.slice(0, 110)).join('\n'));
  const order = [/@spec-writer/, /HUMAN_CONFIRM_SPEC/, /project-lint\.mjs stamp/, /@builder/, /checks\.sh/, /launch-reviewers/, /@approver/, /@memory-curator/, /commit-brain/, /git push/, /gh pr create/, /^DONE/];
  let at = -1; for (const re of order) { const i = actions.findIndex((a, n) => n > at && re.test(a.first)); assert.ok(i > at, `falta o desordenado ${re}`); at = i; }
  assert.ok(fs.existsSync(path.join(f.job, 'implementa.lock')));
  const st = run('node', [path.join(REPO, 'factory/scripts/project-status.mjs'), '--json', '--root', f.repo, '--jobs-dir', path.join(f.repo, 'factory/jobs')], { cwd: f.repo });
  const items = Object.fromEntries(JSON.parse(st.stdout).items.map((i) => [i.id, i]));
  assert.equal(items['REQ-F-1'].estado, 'en curso', 'sin pr.url (ni página en main) el job aun no esta entregado'); assert.equal(items['REQ-F-1'].jobs[0].job, 'clamp-numeros-261104-ab12'); assert.equal(items['UC-1'].estado, 'sin job');
  put(path.join(f.job, 'pr.url'), 'https://github.com/o/r/pull/7\n');   // el humano registra el PR
  const st2 = run('node', [path.join(REPO, 'factory/scripts/project-status.mjs'), '--json', '--root', f.repo, '--jobs-dir', path.join(f.repo, 'factory/jobs')], { cwd: f.repo });
  const after = Object.fromEntries(JSON.parse(st2.stdout).items.map((i) => [i.id, i]));
  for (const id of ['REQ-F-1', 'REQ-F-2', 'UC-2']) assert.equal(after[id].estado, 'implementado', id);
  assert.equal(after['REQ-F-1'].jobs[0].pr, 'https://github.com/o/r/pull/7'); assert.equal(after['UC-1'].estado, 'sin job');
});
