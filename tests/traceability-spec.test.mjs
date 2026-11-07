// Trazabilidad (RF-I15): `Implementa:` en cada RF del spec, su deteccion desde la CLI y la linea de la pagina del job.
// La integracion con next-step.sh y el guard depende de un parche y vive en tests/traceability-patch.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { REPO, write, run } from './helpers.mjs';
import { fx, put, SPEC_FULL, TASKS_FULL } from './ns-fixture.mjs';
import { lint, implementaIds, pageProblems, summary } from '../factory/scripts/spec-lint.mjs';
import { IMPL, edit, POLICY, REQS, job } from './trace-fixture.mjs';

const SPEC_LINT = path.join(REPO, 'factory/scripts/spec-lint.mjs');
const has = (problems, re) => assert.ok(problems.some((p) => re.test(p)), `esperaba un problema /${re}/ en:\n${problems.join('\n')}`);
const none = (problems) => assert.deepEqual(problems, []);
const REQ = { required: true, defined: new Set(['REQ-F-1', 'REQ-F-2', 'REQ-NF-1', 'UC-1', 'UC-2', 'ENT-1', 'ENT-2']) };

test('Implementa: con la base exigida, cada RF debe citar lo que implementa y cada ID debe existir', () => {
  none(lint(SPEC_FULL({ implementa: IMPL }), TASKS_FULL, 'full', REQ));
  const sin = lint(SPEC_FULL({ implementa: ['REQ-F-1', null] }), TASKS_FULL, 'full', REQ);
  has(sin, /RF-2 sin 'Implementa:/); assert.equal(sin.length, 1, sin.join('\n'));
  has(lint(SPEC_FULL(), TASKS_FULL, 'full', REQ), /RF-1 sin 'Implementa:/);
  has(lint(SPEC_FULL({ implementa: ['REQ-F-9', 'UC-2'] }), TASKS_FULL, 'full', REQ), /RF-1 cita REQ-F-9 en Implementa, que no está definido en la base documental/);
  has(lint(SPEC_FULL({ implementa: ['REQ-F-1', 'UC-7'] }), TASKS_FULL, 'full', REQ), /RF-2 cita UC-7/);
});
test('Implementa: formato. IDs mal formados, listas vacías y variantes de escritura', () => {
  has(lint(SPEC_FULL({ implementa: ['REQ-3', 'UC-2'] }), TASKS_FULL, 'full', REQ), /RF-1: 'REQ-3' no es un ID de la base/);
  has(lint(SPEC_FULL({ implementa: ['REQ-F-x', 'UC-2'] }), TASKS_FULL, 'full', REQ), /'REQ-F-x' no es un ID/);
  has(lint(SPEC_FULL({ implementa: ['foo', 'UC-2'] }), TASKS_FULL, 'full', REQ), /'foo' no es un ID/);
  has(lint(SPEC_FULL({ implementa: ['', 'UC-2'] }).replace('min\n', 'min. Implementa:\n'), TASKS_FULL, 'full', REQ), /RF-1: 'Implementa:' está vacío/);
  none(lint(SPEC_FULL().replace('min\n', 'min. implementa: req-f-1 , uc-2\n').replace('max\n', 'max. Implementa: REQ-F-2;ENT-1\n'), TASKS_FULL, 'full', REQ));
});
test('Implementa: sin base exigida no se pide; si se escribe se comprueba el formato y, si hay base, la existencia', () => {
  none(lint(SPEC_FULL(), TASKS_FULL, 'full')); none(lint(SPEC_FULL(), TASKS_FULL, 'full', null)); none(lint(SPEC_FULL(), TASKS_FULL, 'full', { required: false, defined: new Set() }));
  none(lint(SPEC_FULL({ implementa: IMPL }), TASKS_FULL, 'full', { required: false, defined: new Set() }));          // sin base no hay contra qué comprobar
  has(lint(SPEC_FULL({ implementa: ['REQ-F-9', 'UC-2'] }), TASKS_FULL, 'full', { required: false, defined: REQ.defined }), /REQ-F-9/);
  has(lint(SPEC_FULL({ implementa: ['nope', 'UC-2'] }), TASKS_FULL, 'full', { required: false, defined: new Set() }), /'nope' no es un ID/);
});
test('Implementa: con la base exigida y vacía, ningún ID existe (falla cerrado)', () => {
  has(lint(SPEC_FULL({ implementa: IMPL }), TASKS_FULL, 'full', { required: true, defined: new Set() }), /RF-1 cita REQ-F-1 en Implementa, que no está definido/);
});
test('Implementa: el perfil standard no tiene RF, así que no se exige', () => {
  none(lint('# S\nSurface: none\n\n1. Hace X\n\nAlcance:\n- src/**\n', '- t\n', 'standard', REQ));
});
test('implementaIds: unión ordenada y sin repetidos de las líneas de los RF; ignora lo que no es un RF', () => {
  assert.deepEqual(implementaIds(SPEC_FULL({ implementa: ['UC-2, REQ-F-1', 'REQ-F-1, ENT-1'] })), ['ENT-1', 'REQ-F-1', 'UC-2']);
  assert.deepEqual(implementaIds(SPEC_FULL()), []);
  assert.deepEqual(implementaIds(SPEC_FULL({ implementa: IMPL, extra: '\n## Riesgos\n- Implementa: REQ-F-8 (esto no es un RF)\n' })), ['REQ-F-1', 'REQ-F-2', 'UC-2']);
  assert.deepEqual(implementaIds(SPEC_FULL({ implementa: ['req-f-1', 'basura, UC-2'] })), ['REQ-F-1', 'UC-2']);   // los inválidos no se ligan; los reporta lint
});
test('summary: el humano que confirma el spec ve a qué IDs de la base lo liga', () => {
  assert.match(summary(SPEC_FULL({ implementa: IMPL })).join('\n'), /Implementa \(3\): REQ-F-1, REQ-F-2, UC-2/);
  assert.doesNotMatch(summary(SPEC_FULL()).join('\n'), /Implementa/);
});
test('pageProblems: la página del job lleva la línea Implementa con la unión exacta de los IDs del spec', () => {
  const spec = SPEC_FULL({ implementa: IMPL });
  none(pageProblems(spec, '# job\n\nImplementa: REQ-F-1, REQ-F-2, UC-2\n\n## Resumen\n'));
  none(pageProblems(spec, '# job\n\n**Implementa:** UC-2, REQ-F-2, REQ-F-1\n'));
  has(pageProblems(spec, '# job\n\n## Resumen\n'), /sin la línea 'Implementa:/);
  has(pageProblems(spec, '# job\nImplementa: REQ-F-1, REQ-F-2\n'), /le faltan: UC-2/);
  has(pageProblems(spec, '# job\nImplementa: REQ-F-1, REQ-F-2, UC-2, UC-9\n'), /cita UC-9, que el spec no cita/);
  none(pageProblems(SPEC_FULL(), '# job sin Implementa\n'));   // un spec sin IDs (proyecto sin base) no exige nada a la página
});


// ---------------------------------------------------------------- CLI: la base se detecta sola
test('spec-lint (CLI) detecta solo si la base se exige: project_docs=required, o hay documentos aprobados', () => {
  const cli = (f, spec, ...a) => { put(path.join(f.job, 'spec.md'), spec); return run('node', [SPEC_LINT, 'check', path.join(f.job, 'spec.md'), path.join(f.job, 'tasks.md'), 'full', ...a], { cwd: f.repo, env: f.env() }); };
  const req = job({ confirm: false }); put(path.join(req.job, 'tasks.md'), TASKS_FULL);
  let r = cli(req, SPEC_FULL()); assert.equal(r.status, 1); assert.match(r.stdout, /RF-1 sin 'Implementa:/);
  r = cli(req, SPEC_FULL({ implementa: IMPL })); assert.equal(r.status, 0, r.stdout);
  r = cli(req, SPEC_FULL({ implementa: ['REQ-F-9', 'UC-2'] })); assert.equal(r.status, 1); assert.match(r.stdout, /REQ-F-9/);
  const off = job({ project: { ...POLICY, project_docs: 'off' }, confirm: false }); put(path.join(off.job, 'tasks.md'), TASKS_FULL);       // off + base aprobada: la base manda igual
  r = cli(off, SPEC_FULL()); assert.equal(r.status, 1); assert.match(r.stdout, /RF-1 sin 'Implementa:/);
  const offVacio = job({ project: { ...POLICY, project_docs: 'off' }, approve: false, confirm: false }); put(path.join(offVacio.job, 'tasks.md'), TASKS_FULL);   // off + base sin aprobar
  assert.equal(cli(offVacio, SPEC_FULL()).status, 0);
  const reqSinAprobar = job({ approve: false, confirm: false }); put(path.join(reqSinAprobar.job, 'tasks.md'), TASKS_FULL);   // required + base sin aprobar: la politica manda sola
  r = cli(reqSinAprobar, SPEC_FULL()); assert.equal(r.status, 1); assert.match(r.stdout, /RF-1 sin 'Implementa:/);
  assert.equal(cli(reqSinAprobar, SPEC_FULL({ implementa: IMPL })).status, 0);
  const sin = fx({ tools: true, project: { spec_profile: 'full' } }).upTo('input'); put(path.join(sin.job, 'tasks.md'), TASKS_FULL);      // sin base alguna
  assert.equal(cli(sin, SPEC_FULL()).status, 0);
});
test('spec-lint (CLI) comprueba contra la base de la WORKTREE del job: un REQ nuevo aprobado allí existe aunque main no lo tenga', () => {
  const f = job({ confirm: false }); put(path.join(f.job, 'tasks.md'), TASKS_FULL);
  edit(REQS(f), '## Requisitos no funcionales', '- REQ-F-3: el sistema debe cancelar pedidos. [FUENTE: discovery.md#Q-1]\n\n## Requisitos no funcionales');
  const r = (spec, ...a) => { put(path.join(f.job, 'spec.md'), spec); return run('node', [SPEC_LINT, 'check', path.join(f.job, 'spec.md'), path.join(f.job, 'tasks.md'), 'full', ...a], { cwd: f.repo, env: f.env() }); };
  assert.equal(r(SPEC_FULL({ implementa: ['REQ-F-3', 'UC-2'] })).status, 0);
  assert.equal(r(SPEC_FULL({ implementa: ['REQ-F-3', 'UC-2'] }), '--root', f.repo).status, 1);   // --root fuerza otra base: la del checkout principal no lo tiene
});
test('spec-lint (CLI): page comprueba la página del job contra el spec', () => {
  const f = job({ confirm: false }); const page = path.join(f.job, 'page.md'); const spec = path.join(f.job, 'spec.md');
  const cli = (p) => run('node', [SPEC_LINT, 'page', spec, p], { cwd: f.repo });
  write(page, '# job\nImplementa: REQ-F-1, REQ-F-2, UC-2\n'); assert.equal(cli(page).status, 0);
  write(page, '# job\n'); const r = cli(page); assert.equal(r.status, 1); assert.match(r.stdout, /sin la línea 'Implementa:/);
  assert.equal(cli(path.join(f.job, 'no-existe.md')).status, 1);   // página ilegible = problema, no OK
});

