// next-step.sh (parche 8b): ids descriptivos, PHASE, perfil de spec full, y el Brain del job dentro del PR.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, git, run } from './helpers.mjs';
import { fx, fakeGh, drive, put, NEXT, SPEC_FULL } from './ns-fixture.mjs';
import { AGENT_BRANCH_RE } from '../factory/scripts/command-guard.mjs';

const newId = (...a) => run('bash', [NEXT, '--new-id', ...a], { cwd: REPO, env: { ...process.env } });
const FULL = { spec_profile: 'full', brain: { default: ['02-DOCS/wiki/index.md'], agents: { 'memory-curator': ['02-DOCS/wiki/sdd/methodology.md', '02-DOCS/wiki/sdd/job-page-template.md'] } } };
const stop = (r, code) => { assert.equal(r.kind, 'STOP', r.raw); assert.equal(r.value, code, r.raw); };
const delegate = (r, agent) => { assert.equal(r.kind, 'DELEGATE', r.raw); assert.match(r.value, new RegExp(`^@${agent} \\| `)); assert.equal(r.value.split(' | ').length, 3); };
const runCmd = (r, re) => { assert.equal(r.kind, 'RUN', r.raw); assert.match(r.value, re); };

// ---------------------------------------------------------------- ids descriptivos
test('--new-id "frase": slug determinista + fecha + 4 hex; sin tildes ni palabras vacias', () => {
  const id = newId('Crea la función clamp para números').stdout.trim();
  assert.match(id, /^clamp-numeros-\d{6}-[0-9a-f]{4}$/);
  assert.match(newId('Añadir validación de email en el formulario de registro').stdout.trim(), /^validacion-email-formulario-\d{6}-[0-9a-f]{4}$/);
  assert.notEqual(newId('algo').stdout, newId('algo').stdout); // el sufijo evita colisiones
});
test('--new-id: el id es siempre valido para new-job.sh, para next-step y para la rama factory/<id> del guard', () => {
  for (const frase of ['Arregla $(rm -rf /) ; \'x\' `id` "y"', '../../etc/passwd', 'ñandú ÁÉÍ üñ', 'a'.repeat(300), 'palabra '.repeat(40), '   ', 'la el de', 'x']) {
    const r = newId(frase); assert.equal(r.status, 0); const id = r.stdout.trim();
    assert.match(id, /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/, `${JSON.stringify(frase)} -> ${id}`); assert.ok(!id.includes('..'));
    assert.match('factory/' + id, AGENT_BRANCH_RE, id); assert.ok(id.length <= 61);
  }
});
test('--new-id sin frase (o vacia) conserva el formato antiguo job-<ms>-<8hex>', () => {
  assert.match(newId().stdout.trim(), /^job-\d{13}-[0-9a-f]{8}$/); assert.match(newId('').stdout.trim(), /^job-\d{13}-[0-9a-f]{8}$/);
});
test('un id descriptivo recorre el flujo: new-job.sh lo crea y la rama es factory/<id>', () => {
  const id = newId('funcion clamp numeros').stdout.trim(); const f = fx({ id });
  const r = f.ns(); runCmd(r, new RegExp(`^bash 01-TOOLS/new-job\\.sh ${id}$`)); f.newJob();
  assert.equal(git(f.wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), `factory/${id}`); delegate(f.ns(), 'intake');
});

// ---------------------------------------------------------------- PHASE
test('PHASE: cada estado dice su fase metodologica', () => {
  const f = fx(); const seen = [];
  const step = () => { const r = f.ns(); seen.push([r.state, r.phase]); return r; };
  step(); f.newJob(); step(); f.input(); step(); f.spec(); step(); f.confirm(); step(); f.commit(); step(); f.gate(); step(); f.reviews(1); step(); f.decision(); step(); f.human(); step(); f.trace(); step(); f.push(); step();
  assert.deepEqual(seen, [['0', 'Análisis'], ['1', 'Análisis'], ['2', 'Análisis y diseño'], ['3', 'Análisis y diseño'], ['4', 'Desarrollo'], ['5', 'Pruebas'], ['7', 'Pruebas'],
    ['8', 'Revisión'], ['10', 'Revisión'], ['11', 'Documentación'], ['12', 'Entrega'], ['13', 'Entrega']]);
  const g = fx().upTo('built'); g.gate(false); assert.equal(g.ns().phase, 'Desarrollo');
  const h = fx({ project: { human_review_surfaces: ['page'] } }); h.newJob(); h.input(); h.spec({ surface: 'page' }); h.confirm(); h.commit(); h.gate(); h.reviews(1); h.decision(); h.human(); h.trace();
  assert.equal(h.ns().phase, 'Revisión');
});
test('PHASE aparece junto a STATE tambien en STOP y DONE', () => {
  const f = fx().upTo('spec'); const r = f.ns(); assert.equal(r.kind, 'STOP'); assert.equal(r.phase, 'Análisis y diseño');
  const g = fx().upTo('pushed'); put(path.join(g.job, 'pr.url'), 'u\n'); const d = g.ns(); assert.equal(d.first, 'DONE'); assert.equal(d.phase, 'Entrega');
});

// ---------------------------------------------------------------- perfil full: estado 2
test('perfil full: un spec clasico se rechaza con el motivo exacto; el completo pasa', () => {
  const f = fx({ project: FULL }).upTo('input');
  put(path.join(f.job, 'spec.md'), '# S\nSurface: none\n\n1. algo\n\nAlcance:\n- src/**\n'); put(path.join(f.job, 'tasks.md'), '- t\n');
  const r = f.ns(); delegate(r, 'spec-writer'); assert.match(r.why.join(), /ADR/); assert.match(r.why.join(), /Actores/); assert.match(r.why.join(), /Requisitos funcionales/); assert.match(r.first, /spec-template\.md/);
  f.spec(); stop(f.ns(), 'HUMAN_CONFIRM_SPEC');
});
test('perfil full: el resumen para confirmar incluye actores, requisitos y el ADR a registrar', () => {
  const f = fx({ project: FULL }).upTo('input'); f.spec({ adr: 'Usar clamp central' }); const r = f.ns(); stop(r, 'HUMAN_CONFIRM_SPEC');
  assert.match(r.why.join('\n'), /Actores \(2\)/); assert.match(r.why.join('\n'), /Requisitos funcionales: 2/); assert.match(r.why.join('\n'), /ADR a registrar: Usar clamp central/);
});
test('perfil invalido en project.json => STOP PROJECT_INVALID', () => stop(fx({ project: { spec_profile: 'enorme' } }).ns(), 'PROJECT_INVALID'));

// ---------------------------------------------------------------- estado 11: Brain del job en el PR
const upToHuman = (project = FULL, specOpts) => { const f = fx({ project }); f.newJob(); f.input(); f.spec(specOpts); f.confirm(); f.commit(); f.gate(); f.reviews(1); f.decision(); f.human(); return f; };
test('11 full: sin trace/Brain => DELEGATE @memory-curator con los archivos concretos, READ y fase Documentación', () => {
  const f = upToHuman(); const r = f.ns(); delegate(r, 'memory-curator'); assert.equal(r.state, '11'); assert.equal(r.phase, 'Documentación');
  assert.match(r.first, new RegExp(`factory/jobs/job-1/trace\\.md,factory/worktrees/job-1/02-DOCS/wiki/jobs/job-1\\.md,factory/worktrees/job-1/02-DOCS/wiki/index\\.md$`));
  assert.match(r.read, /methodology\.md/); assert.match(r.read, /job-page-template\.md/);
});
test('11 full: la pagina del job es obligatoria, con sus 6 secciones y el commit del gate', () => {
  for (const [opts, re] of [[{ listJobPage: false }, /debe incluir 02-DOCS\/wiki\/jobs\/job-1\.md/], [{ skipHeading: 'Diseño' }, /sin la seccion '## Diseño'/],
    [{ skipHeading: 'Pruebas' }, /sin la seccion '## Pruebas'/], [{ gateSha: false }, /no cita el commit del gate/]]) {
    const f = upToHuman(); f.curate(opts); const r = f.ns(); delegate(r, 'memory-curator'); assert.match(r.why.join(), re, JSON.stringify(opts));
  }
  const ok = upToHuman(); ok.curate(); runCmd(ok.ns(), /^cd factory\/worktrees\/job-1 && bash 01-TOOLS\/commit-brain\.sh job-1$/);
});
test('11: "Brain: sin cambios" no vale en full, pero si en standard', () => {
  const f = upToHuman(); f.trace(); delegate(f.ns(), 'memory-curator');
  const g = fx().upTo('humanized'); g.trace('Brain: sin cambios'); assert.equal(g.ns().state, '12');
});
test('11: una pagina inventada, fuera de 02-DOCS/wiki o que el curator no puede escribir => se rechaza', () => {
  for (const [line, re] of [['Brain: 02-DOCS/wiki/jobs/job-1.md, 02-DOCS/wiki/jobs/no-existe.md', /no existe en la worktree/], ['Brain: ../../etc/passwd', /no es una pagina de 02-DOCS\/wiki/],
    ['Brain: src/feature.js', /no es una pagina de 02-DOCS\/wiki/], ['Brain: 02-DOCS/wiki/sdd/constitution.md', /el curator solo puede escribir/]]) {
    const f = upToHuman(); f.curate(); fs.writeFileSync(path.join(f.job, 'trace.md'), `# t\n${line}\n`); put(path.join(f.job, 'trace.md'), `# t\n${line}\n`);
    const r = f.ns(); delegate(r, 'memory-curator'); assert.match(r.why.join(), re, line);
  }
});
test('11: el curator no puede colar otras paginas del Brain: un archivo ajeno en la worktree es WORKTREE_DIRTY y commit-brain lo rechaza', () => {
  const f = upToHuman(); f.curate({ extraPage: '02-DOCS/wiki/sdd/constitution.md' }); stop(f.ns(), 'WORKTREE_DIRTY');
  const r = run('bash', [path.join(REPO, '01-TOOLS/commit-brain.sh'), 'job-1'], { cwd: f.wt, env: f.env() });
  assert.equal(r.status, 1); assert.match(r.stderr, /constitution\.md/); assert.equal(git(f.wt, 'log', '-1', '--format=%s').trim(), 'trabajo'); // no commiteo nada
});
test('11 ADR: si el spec declara ADR, decisions.md debe tener "## ADR-N: <titulo>"; el numero siguiente se calcula (007 -> 008)', () => {
  const f = upToHuman(FULL, { adr: 'Usar clamp central' }); f.curate(); fs.writeFileSync(path.join(f.wt, '02-DOCS/wiki/sdd/decisions.md'), '# decisiones\n\n## ADR-007: algo previo\n'); // sin el ADR nuevo
  let r = f.ns(); delegate(r, 'memory-curator'); assert.match(r.why.join(), /decisions\.md no tiene un '## ADR-N: Usar clamp central'/);
  assert.match(r.first, /decisions\.md$/); assert.match(r.first, /## ADR-008: Usar clamp central/);
  const g = upToHuman(FULL, { adr: 'Usar clamp central' }); g.curate({}); // el fixture lo escribe
  assert.match(fs.readFileSync(path.join(g.wt, '02-DOCS/wiki/sdd/decisions.md'), 'utf8'), /## ADR-008: Usar clamp central\nEstado: Propuesto/);
  runCmd(g.ns(), /commit-brain\.sh/);
  const h = upToHuman(FULL, { adr: 'Usar clamp central' }); h.curate(); put(path.join(h.job, 'trace.md'), '# t\nBrain: 02-DOCS/wiki/jobs/job-1.md, 02-DOCS/wiki/index.md\n');
  r = h.ns(); delegate(r, 'memory-curator'); assert.match(r.why.join(), /debe incluir 02-DOCS\/wiki\/sdd\/decisions\.md/);
});
test('11: sin ADR declarado, decisions.md no se exige', () => { const f = upToHuman(); f.curate(); runCmd(f.ns(), /commit-brain\.sh/); });

// ---------------------------------------------------------------- el Brain commiteado no invalida nada
test('tras commit-brain el job sigue vigente: gate y reviews no se rehacen y se pasa al push', () => {
  const f = upToHuman(); f.curate(); f.commitBrain();
  const r = f.ns(); runCmd(r, /^git push -u origin factory\/job-1$/); assert.equal(r.state, '12');
  assert.match(git(f.wt, 'log', '-1', '--format=%s').trim(), /^docs\(brain\): /);
  assert.deepEqual(git(f.wt, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort(), ['02-DOCS/wiki/index.md', '02-DOCS/wiki/jobs/job-1.md']);
});
test('pero un commit de CODIGO despues del Brain si invalida gate y reviews', () => {
  const f = upToHuman(); f.curate(); f.commitBrain(); f.commit('src/otro.js', 'export const o = 1;\n');
  runCmd(f.ns(), /checks\.sh/); f.gate(); runCmd(f.ns(), /launch-reviewers\.sh job-1 2$/);
});
test('un commit que mezcla codigo y Brain tambien invalida (no basta con que toque el Brain)', () => {
  const f = upToHuman(); f.curate(); write(path.join(f.wt, 'src/mezcla.js'), 'x\n'); git(f.wt, 'add', 'src/mezcla.js', '02-DOCS/wiki/jobs/job-1.md'); git(f.wt, 'commit', '-qm', 'mezcla');
  runCmd(f.ns(), /checks\.sh/);
});
test('commit del Brain que toca una pagina NO del curator tambien invalida', () => {
  const f = upToHuman(); write(path.join(f.wt, '02-DOCS/wiki/sdd/constitution.md'), 'cambio\n'); git(f.wt, 'add', '02-DOCS/wiki/sdd/constitution.md'); git(f.wt, 'commit', '-qm', 'toca la constitucion');
  runCmd(f.ns(), /checks\.sh/);
});
test('perfil full: el PR lleva codigo + Brain (el humano los revisa juntos)', () => {
  const f = fx({ project: FULL }); f.upTo('pushed'); const files = git(f.wt, 'diff', '--name-only', 'origin/main...HEAD').trim().split('\n').sort();
  assert.deepEqual(files, ['02-DOCS/wiki/index.md', '02-DOCS/wiki/jobs/job-1.md', 'src/feature.js']);
});

// ---------------------------------------------------------------- E2E del flujo completo (perfil full)
test('E2E full: analisis -> diseno -> desarrollo -> pruebas -> revision -> documentacion (con ADR) -> entrega', { timeout: 400000 }, () => {
  const f = fx({ tools: true, project: FULL, id: 'clamp-numeros-261104-ab12' }); const gh = fakeGh(); f.gh = gh.bin;
  const { actions, final } = drive(f, { humans: { HUMAN_CONFIRM_SPEC: () => f.confirm() }, agents: { 'spec-writer': () => f.spec({ adr: 'Usar clamp central' }) } });
  assert.equal(final.first, 'DONE', actions.map((a) => a.first.slice(0, 110)).join('\n'));
  const phases = [...new Set(actions.map((a) => a.phase))]; assert.deepEqual(phases, ['Análisis', 'Análisis y diseño', 'Desarrollo', 'Pruebas', 'Revisión', 'Documentación', 'Entrega']);
  assert.ok(actions.some((a) => /commit-brain\.sh/.test(a.first)), 'no se commiteo el Brain');
  const order = [/new-job/, /@intake/, /@spec-writer/, /HUMAN_CONFIRM_SPEC/, /@builder/, /checks\.sh/, /launch-reviewers/, /@approver/, /risk\.sh/, /@human-gate/, /@memory-curator/, /commit-brain/, /git push/, /gh pr create/, /^DONE/];
  let at = -1; for (const re of order) { const i = actions.findIndex((a, n) => n > at && re.test(a.first)); assert.ok(i > at, `falta o desordenado ${re}`); at = i; }
  assert.ok(gh.created()); const files = git(f.wt, 'diff', '--name-only', 'origin/main...HEAD').trim().split('\n').sort();
  assert.deepEqual(files, ['02-DOCS/wiki/index.md', '02-DOCS/wiki/jobs/clamp-numeros-261104-ab12.md', '02-DOCS/wiki/sdd/decisions.md', 'src/feature.js']);
  assert.match(fs.readFileSync(path.join(f.wt, '02-DOCS/wiki/sdd/decisions.md'), 'utf8'), /## ADR-008: Usar clamp central\nEstado: Propuesto/);
});
