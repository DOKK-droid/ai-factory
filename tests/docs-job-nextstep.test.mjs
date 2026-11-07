// El job de documentacion (kind: docs) en next-step.sh y lib.sh (rama 6), y BASE_DOCS_BEHIND para jobs de cualquier tipo.
//
// Estos tests dependen de un PARCHE a archivos protegidos (docs/propuestas/rama6-docs-job.patch, lo aplica el humano).
// Mientras no este aplicado se saltan con un motivo explicito; y un test exige que se aplique entero o nada.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, run, git, write } from './helpers.mjs';
import { fx, fakeGh, drive, put, parse as parseNs, NEXT } from './ns-fixture.mjs';
import { docsJob, ROW, PD } from './docs-fixture.mjs';
import { job as codeJob } from './trace-fixture.mjs';
import { classifyBash, classifyTool } from '../factory/scripts/command-guard.mjs';

const PATCH = 'docs/propuestas/rama6-docs-job.patch';
const LIB = path.join(REPO, '01-TOOLS/lib.sh');
const nsText = fs.readFileSync(NEXT, 'utf8');
const nsDocs = nsText.includes('docs-job.mjs');
const libDocs = fs.readFileSync(LIB, 'utf8').includes('FACTORY_JOB_KIND');
const miss = (ok) => (ok ? false : `falta aplicar ${PATCH}`);
const SK = miss(nsDocs && libDocs);
const REQ2 = ['debe listar los pedidos', 'debe listar y filtrar los pedidos'];

test('el parche se aplica entero o no se aplica: ni a medias', () => {
  assert.equal(nsDocs, libDocs, `parche a medias (next-step=${nsDocs}, lib=${libDocs}); aplica ${PATCH} completo`);
});
test('el parche existe, es un diff valido de next-step.sh y lib.sh y se aplica limpio o ya esta aplicado', () => {
  const p = path.join(REPO, PATCH); assert.ok(fs.existsSync(p), PATCH);
  const files = [...fs.readFileSync(p, 'utf8').matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(files, ['01-TOOLS/lib.sh', '01-TOOLS/next-step.sh']);
  // Ya aplicado, el parche no se puede revertir limpio en cuanto otro parche posterior toca las mismas lineas: solo se comprueba antes de aplicarlo.
  if (!nsDocs) { const ck = run('git', ['apply', '--check', p], { cwd: REPO }); assert.equal(ck.status, 0, ck.stderr); }
});

// ---- permisos de los agentes (mismo parser que pipeline-consistency.test.mjs)
function perms(agent) {
  const txt = fs.readFileSync(path.join(REPO, '.opencode/agent', agent + '.md'), 'utf8');
  const out = { edit: [], bash: [] }; let sec = null;
  for (const l of txt.split('\n---\n')[0].split('\n')) {
    let m = l.match(/^  (\w+):\s*(\w+)?$/); if (m) { sec = m[1]; continue; }
    m = l.match(/^    "([^"]+)":\s*(\w+)$/); if (m && (sec === 'edit' || sec === 'bash')) out[sec].push([m[1], m[2]]);
  }
  return out;
}
const rx = (pat) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 's');
const decide = (rules, value, fallback = 'ask') => rules.reduce((acc, [p, a]) => (rx(p).test(value) ? a : acc), fallback);

const stop = (r, code) => { assert.equal(r.kind, 'STOP', r.raw); assert.equal(r.value, code, r.raw); assert.equal(r.code, 2); };
const delegate = (r, agent) => { assert.equal(r.kind, 'DELEGATE', r.raw); assert.match(r.value, new RegExp(`^@${agent} \\| `)); assert.equal(r.value.split(' | ').length, 3, r.first); };
const runCmd = (f, cmd) => run('bash', ['-c', cmd], { cwd: f.repo, env: f.env({ FACTORY_TEST_CMD: 'true' }) });
const checks = (f) => run('bash', [path.join(REPO, '01-TOOLS/checks.sh'), f.id], { cwd: f.wt, env: f.env({ FACTORY_TEST_CMD: 'true' }) });

// ---------------------------------------------------------------- kind en job.json
test('kind: un job.json con un valor desconocido es JOB_INCONSISTENT; sin kind es un job de codigo', { skip: SK }, () => {
  const f = docsJob(); const jf = path.join(f.job, 'job.json'); const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
  for (const kind of ['otro', 'DOCS', 7, null, '', ['docs']]) { fs.writeFileSync(jf, JSON.stringify({ ...j, kind })); stop(f.ns(), 'JOB_INCONSISTENT'); assert.match(f.ns().why.join(' '), /kind/); }
  delete j.kind; fs.writeFileSync(jf, JSON.stringify(j)); const r = f.ns();
  assert.notEqual(r.value, 'JOB_INCONSISTENT'); assert.ok(r.state === '4' || r.state === 'project', `un job sin kind es de codigo: tomo el camino de siempre (${r.raw})`);
});

// ---------------------------------------------------------------- 1c: aprobacion de la base (y la correccion del CMD)
test('1c: el CMD de aprobacion se ejecuta en la worktree (antes aprobaba el checkout principal y el STOP no se resolvia nunca)', { skip: SK }, () => {
  const f = codeJob({ approve: false, confirm: false }); const r = f.ns();
  stop(r, 'HUMAN_CONFIRM_PROJECT'); assert.equal(r.cmd.length, 1);
  assert.equal(r.cmd[0], 'cd factory/worktrees/job-1 && node factory/scripts/project-lint.mjs approve 00-vision 01-requisitos 02-casos-de-uso 03-dominio 04-arquitectura 05-datos 06-despliegue');
  const ran = runCmd(f, r.cmd[0]); assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.ok(fs.existsSync(path.join(f.wt, PD, 'project.ok')), 'aprobado en la worktree'); assert.equal(fs.existsSync(path.join(f.repo, PD, 'project.ok')), false, 'el checkout principal no se toca');
  assert.notEqual(f.ns().value, 'HUMAN_CONFIRM_PROJECT');
});
test('1c: un job de documentacion NO se detiene en la base sin aprobar (la base es justo lo que cambia); uno de codigo si', { skip: SK }, () => {
  const d = docsJob({ approve: false, confirm: false }); const r = d.ns(); stop(r, 'HUMAN_CONFIRM_SPEC');
  const c = codeJob({ approve: false, confirm: false }); stop(c.ns(), 'HUMAN_CONFIRM_PROJECT');
});

// ---------------------------------------------------------------- estado 2 y 3: spec del job docs
test('estado 2: sin spec valido el que escribe es system-analyst, con el perfil docs aunque el proyecto use full', { skip: SK }, () => {
  const f = docsJob({ stage: 'input', project: { require_spec_ok: true, project_docs: 'required', spec_profile: 'full' } });
  let r = f.ns(); delegate(r, 'system-analyst'); assert.equal(r.state, '2'); assert.match(r.value, /spec\.md,factory\/jobs\/job-1\/tasks\.md$/); assert.match(r.value, /spec-docs-template\.md/); assert.match(r.why.join(' '), /spec\.md/);
  f.docsSpec(); put(path.join(f.job, 'spec.md'), fs.readFileSync(path.join(f.job, 'spec.md'), 'utf8').replace('Surface: none', 'Surface: page'));
  r = f.ns(); delegate(r, 'system-analyst'); assert.match(r.why.join(' '), /Surface/);
  f.docsSpec(); r = f.ns(); stop(r, 'HUMAN_CONFIRM_SPEC'); assert.equal(r.state, '3'); assert.match(r.why.join('\n'), /Documentos afectados \(1\): 01-requisitos \(system-analyst\)/);
  assert.deepEqual(r.cmd, ['touch factory/jobs/job-1/spec.ok']);
});
test('estado 3b: el spec de un job docs no cita Implementa:, asi que no hay stamp ni lock que esperar', { skip: SK }, () => {
  const f = docsJob(); const r = f.ns(); delegate(r, 'system-analyst'); assert.equal(r.state, '4'); assert.equal(fs.existsSync(path.join(f.job, 'implementa.lock')), false);
});

// ---------------------------------------------------------------- estado 4: los agentes dueños en lugar del builder
test('estado 4: delega en el dueño de cada documento (no en el builder), commitea con commit-brain --project y sigue al gate', { skip: SK }, () => {
  const f = docsJob(); let r = f.ns();
  delegate(r, 'system-analyst'); assert.equal(r.state, '4'); assert.equal(r.phase, 'Desarrollo'); assert.match(r.value, /factory\/worktrees\/job-1\/02-DOCS\/wiki\/project\/01-requisitos\.md$/);
  f.agentEdit('01-requisitos', ...REQ2); r = f.ns(); assert.equal(r.kind, 'RUN'); assert.equal(r.value, 'cd factory/worktrees/job-1 && bash 01-TOOLS/commit-brain.sh job-1 --project'); assert.equal(runCmd(f, r.value).status, 0);
  r = f.ns(); delegate(r, 'system-analyst'); assert.match(r.value, /02-casos-de-uso\.md$/); assert.match(r.why.join(' '), /PL051/);
  f.marcarDesactualizado('02-casos-de-uso'); assert.equal(runCmd(f, f.ns().value).status, 0);
  r = f.ns(); assert.equal(r.kind, 'RUN'); assert.equal(r.value, 'cd factory/worktrees/job-1 && bash 01-TOOLS/checks.sh job-1'); assert.equal(r.state, '5');
});
test('estado 4: un trabajo sin commits NO se confunde con "falta el builder": el builder no aparece nunca en un job docs', { skip: SK }, () => {
  const f = docsJob(); const r = f.ns(); assert.doesNotMatch(r.raw, /@builder/);
  const code = codeJob({ approve: true }); code.ns(); const rc = code.ns(); assert.ok(!/system-analyst/.test(rc.raw));
});

// ---------------------------------------------------------------- 5-9 sobre un job docs ya trabajado
function worked(opts) {
  const f = docsJob(opts); f.agentEdit('01-requisitos', ...REQ2); f.commitProject(); f.marcarDesactualizado('02-casos-de-uso'); f.commitProject();
  return f;
}
test('estado 6: gate en rojo => el humano si es de marcadores abiertos o ediciones fuera de alcance; el dueño si es un error de project-lint', { skip: SK }, () => {
  const f = worked({ approve: false }); f.agentEdit('01-requisitos', 'debe listar y filtrar los pedidos.', 'debe listar y filtrar los pedidos de UC-99.', { stale: false }); f.commitProject();
  assert.equal(checks(f).status, 1); let r = f.ns(); delegate(r, 'system-analyst'); assert.equal(r.state, '6'); assert.match(r.why.join(' '), /UC-99/); assert.match(r.value, /01-requisitos\.md$/);
  const g = worked(); write(path.join(g.wt, 'src/fuera.js'), 'x\n'); git(g.wt, 'add', 'src/fuera.js'); git(g.wt, 'commit', '-qm', 'fuera');
  assert.equal(checks(g).status, 1); r = g.ns(); stop(r, 'DOCS_NEED_HUMAN'); assert.equal(r.state, '6'); assert.match(r.why.join(' '), /src\/fuera\.js/);
  const h = worked({ approve: false }); h.agentEdit('01-requisitos', '[FUENTE: discovery.md#Q-1]', '[PENDIENTE]', { stale: false }); h.commitProject();
  assert.equal(checks(h).status, 1); r = h.ns(); stop(r, 'DOCS_NEED_HUMAN'); assert.match(r.why.join(' '), /\[PENDIENTE\]/);
});
test('estado 4: un error de project-lint en un documento ya aprobado se corrige antes del gate (ALIGN al dueño)', { skip: SK }, () => {
  const f = worked(); f.agentEdit('01-requisitos', 'debe listar y filtrar los pedidos.', 'debe listar y filtrar los pedidos de UC-99.'); f.commitProject();
  const r = f.ns(); delegate(r, 'system-analyst'); assert.equal(r.state, '4'); assert.match(r.why.join(' '), /UC-99/);
});
test('estado 6: las rondas siguen acotadas por max_rounds (GATE_FAIL_STREAK)', { skip: SK }, () => {
  const f = worked({ project: { ...{ require_spec_ok: true, project_docs: 'required' }, max_rounds: 1 } }); write(path.join(f.wt, 'src/f.js'), 'x\n'); git(f.wt, 'add', 'src/f.js'); git(f.wt, 'commit', '-qm', 'x');
  assert.equal(checks(f).status, 1); stop(f.ns(), 'MAX_ROUNDS');
});
test('estado 9: CHANGES vuelve al dueño del documento que nombra el approver, no al builder', { skip: SK }, () => {
  const f = worked(); assert.equal(checks(f).status, 0);
  f.reviews(1); f.decision('CHANGES'); fs.writeFileSync(path.join(f.job, 'decision.md'), 'CHANGES\n\nEl 02-casos-de-uso no menciona el filtro.\n'); put(path.join(f.job, 'decision.md'), fs.readFileSync(path.join(f.job, 'decision.md'), 'utf8'));
  const r = f.ns(); delegate(r, 'system-analyst'); assert.equal(r.state, '9'); assert.match(r.value, /02-casos-de-uso\.md$/); assert.doesNotMatch(r.raw, /builder/);
  fs.writeFileSync(path.join(f.job, 'decision.md'), 'CHANGES\n\nEl 03-dominio esta incompleto.\n'); put(path.join(f.job, 'decision.md'), fs.readFileSync(path.join(f.job, 'decision.md'), 'utf8'));
  delegate(f.ns(), 'domain-modeler');
});

// ---------------------------------------------------------------- frescura (lib.sh)
const fresh = (f, sha, env = {}) => run('bash', ['-c', `source "${LIB}"; factory_commit_fresh "${sha}" HEAD "${f.wt}"`], { cwd: f.repo, env: f.env(env) }).status === 0;
const commitFile = (f, rel, fn) => { const file = path.join(f.wt, rel); write(file, fn(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')); git(f.wt, 'add', rel); git(f.wt, 'commit', '-qm', `edita ${rel}`); };
test('lib.sh docs: editar un documento despues del gate lo invalida; project.ok, trazabilidad, la pagina del curator y el cambio de estado de la cabecera no', { skip: SK }, () => {
  const f = worked(); const sha = f.head(); const E = { FACTORY_JOB_KIND: 'docs' };
  assert.equal(fresh(f, sha, E), true);
  commitFile(f, `${PD}/project.ok`, (t) => t + '\n'); assert.equal(fresh(f, sha, E), true, 'project.ok');
  commitFile(f, `${PD}/trazabilidad.md`, () => '# t\n'); assert.equal(fresh(f, sha, E), true, 'trazabilidad.md');
  commitFile(f, '02-DOCS/wiki/jobs/job-1.md', () => '# job\n'); commitFile(f, '02-DOCS/wiki/index.md', (t) => t + 'x\n'); assert.equal(fresh(f, sha, E), true, 'curator');
  commitFile(f, `${PD}/01-requisitos.md`, (t) => t.replace(/^estado: \w+$/m, 'estado: aprobado')); assert.equal(fresh(f, sha, E), true, 'solo la linea estado de la cabecera');
  const body = f.head(); commitFile(f, `${PD}/01-requisitos.md`, (t) => t.replace('filtrar los pedidos', 'filtrar y ordenar los pedidos')); assert.equal(fresh(f, body, E), false, 'un cambio del cuerpo');
  assert.equal(fresh(f, sha, E), false);
});
test('lib.sh docs: estado y cuerpo juntos, version, otros documentos, decisions.md y codigo invalidan', { skip: SK }, () => {
  const E = { FACTORY_JOB_KIND: 'docs' };
  for (const [name, rel, fn] of [
    ['estado + cuerpo', `${PD}/01-requisitos.md`, (t) => t.replace(/^estado: \w+$/m, 'estado: aprobado').replace('filtrar', 'filtrar y')],
    ['version', `${PD}/01-requisitos.md`, (t) => t.replace(/^version: .*$/m, 'version: 9.9.9')],
    ['una linea estado en el cuerpo', `${PD}/01-requisitos.md`, (t) => t + '\nestado: aprobado\n'],
    ['decisions.md', '02-DOCS/wiki/sdd/decisions.md', (t) => t + '\n## ADR-002: x\n'],
    ['codigo', 'src/app.js', (t) => t + '//x\n'],
  ]) { const f = worked(); const sha = f.head(); commitFile(f, rel, fn); assert.equal(fresh(f, sha, E), false, name); }
});
test('lib.sh code: un job de codigo mantiene la regla de siempre (editar la base documental no invalida), con o sin FACTORY_JOB_KIND', { skip: SK }, () => {
  const f = codeJob(); f.commit(); const sha = f.head(); commitFile(f, `${PD}/01-requisitos.md`, (t) => t + '\ncambio\n'); commitFile(f, '02-DOCS/wiki/sdd/decisions.md', (t) => t + '\nx\n');
  assert.equal(fresh(f, sha, { FACTORY_JOB_KIND: 'code' }), true); assert.equal(fresh(f, sha), true);
  f.commit('src/z.js', 'export const z = 1;\n'); assert.equal(fresh(f, sha, { FACTORY_JOB_KIND: 'code' }), false);
});
test('lib.sh: sin FACTORY_JOB_KIND deduce el tipo de job.json de la rama factory/<id> (risk.sh y launch-reviewers lo usan asi)', { skip: SK }, () => {
  const f = worked(); const sha = f.head(); commitFile(f, `${PD}/01-requisitos.md`, (t) => t.replace('filtrar los pedidos', 'filtrar y ordenar los pedidos'));
  const jobsDir = path.join(f.repo, 'factory/jobs');
  assert.equal(fresh(f, sha, { FACTORY_JOBS_DIR: jobsDir }), false, 'job.json dice docs');
  const jf = path.join(f.job, 'job.json'); const j = JSON.parse(fs.readFileSync(jf, 'utf8')); fs.writeFileSync(jf, JSON.stringify({ ...j, kind: 'code' }));
  assert.equal(fresh(f, sha, { FACTORY_JOBS_DIR: jobsDir }), true, 'job.json dice code');
  delete j.kind; fs.writeFileSync(jf, JSON.stringify(j)); assert.equal(fresh(f, sha, { FACTORY_JOBS_DIR: jobsDir }), true, 'job.json antiguo sin kind');
});

// ---------------------------------------------------------------- BASE_DOCS_BEHIND
function pushToMain(f, rel, fn) {
  const c = tmp('af-clone-'); run('git', ['clone', '-q', f.origin, c]); git(c, 'config', 'user.email', 't@t.t'); git(c, 'config', 'user.name', 't'); git(c, 'config', 'commit.gpgsign', 'false');
  write(path.join(c, rel), fn(fs.existsSync(path.join(c, rel)) ? fs.readFileSync(path.join(c, rel), 'utf8') : '')); git(c, 'add', rel); git(c, 'commit', '-qm', 'main avanza'); git(c, 'push', '-q', 'origin', 'main');
  git(f.repo, 'fetch', '-q', 'origin');
}
test('BASE_DOCS_BEHIND: si origin/main cambio la base documental y la worktree no la tiene, el humano rebasa; aplica a jobs de codigo y de documentacion', { skip: SK }, () => {
  for (const f of [codeJob(), docsJob()]) {
    assert.notEqual(f.ns().value, 'BASE_DOCS_BEHIND');
    pushToMain(f, `${PD}/00-vision.md`, (t) => t + '\nmas vision\n');
    const r = f.ns(); stop(r, 'BASE_DOCS_BEHIND'); assert.deepEqual(r.cmd, ['git -C factory/worktrees/job-1 rebase origin/main']); assert.match(r.why.join(' '), /00-vision\.md|base documental/);
    const ran = runCmd(f, r.cmd[0]); assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    assert.notEqual(f.ns().value, 'BASE_DOCS_BEHIND');
  }
});
test('BASE_DOCS_BEHIND: lo que no es la base documental (codigo, decisions.md) no lo dispara', { skip: SK }, () => {
  const f = codeJob(); pushToMain(f, 'src/nuevo.js', () => 'export const n = 1;\n'); assert.notEqual(f.ns().value, 'BASE_DOCS_BEHIND');
  pushToMain(f, '02-DOCS/wiki/sdd/decisions.md', (t) => t + '\n## ADR-009: otra\n'); assert.notEqual(f.ns().value, 'BASE_DOCS_BEHIND');
});
test('BASE_DOCS_BEHIND: falla cerrado si no puede calcular el merge-base con la rama base', { skip: SK }, () => {
  const f = docsJob(); const empty = git(f.repo, 'hash-object', '-t', 'tree', '/dev/null').trim(); const orphan = git(f.repo, 'commit-tree', empty, '-m', 'huerfano').trim();
  const jf = path.join(f.job, 'job.json'); const j = JSON.parse(fs.readFileSync(jf, 'utf8')); fs.writeFileSync(jf, JSON.stringify({ ...j, base: orphan }));
  const r = f.ns(); stop(r, 'BASE_DOCS_BEHIND'); assert.match(r.why.join(' '), /no pude/);
});

// ---------------------------------------------------------------- fallar cerrado ante lo que docs-job.mjs conteste
/** next-step.sh de una copia de la fabrica cuyo docs-job.mjs contesta `out` en la fase `phase` (null = se cae) y el real en las demas. */
function stubbed(f, phase, out) {
  const d = tmp('af-stub-'); fs.cpSync(path.join(REPO, '01-TOOLS'), path.join(d, '01-TOOLS'), { recursive: true }); fs.cpSync(path.join(REPO, 'factory/scripts'), path.join(d, 'factory/scripts'), { recursive: true });
  const sc = path.join(d, 'factory/scripts'); fs.renameSync(path.join(sc, 'docs-job.mjs'), path.join(sc, 'docs-job-real.mjs'));
  write(path.join(sc, 'docs-job.mjs'), `import { state as real } from './docs-job-real.mjs';
export * from './docs-job-real.mjs';
const a = process.argv; const g = (k) => a[a.indexOf('--' + k) + 1];
if (a.includes('state')) {
  if (g('phase') === ${JSON.stringify(phase)}) { ${out === null ? "throw new Error('boom');" : `console.log(${JSON.stringify(out)}); process.exit(0);`} }
  console.log(real({ phase: g('phase'), jobDir: g('job-dir'), jobId: g('job-id'), worktree: g('worktree'), base: g('base') })); process.exit(0);
}`);
  return (extra = {}) => parseNs(run('bash', [path.join(d, '01-TOOLS/next-step.sh'), f.id], { cwd: f.repo, env: f.env(extra), timeout: 60000 }));
}
test('fallar cerrado (fase work): respuesta vacia, desconocida, incompleta, de otra fase o un crash de node => STOP, nunca se avanza', { skip: SK }, () => {
  const f = docsJob();
  for (const [out, code] of [['', 'DOCS_JOB_INVALID'], ['basura', 'DOCS_JOB_INVALID'], ['OK', 'DOCS_JOB_INVALID'], ['CONFIRM', 'DOCS_JOB_INVALID'], ['WORK\nOWNER: system-analyst', 'DOCS_JOB_INVALID'], ['WORK\nFILES: a\nWHAT: b', 'DOCS_JOB_INVALID'],
    ['COMMIT', 'DOCS_JOB_INVALID'], ['TRACE\nWHY: x', 'DOCS_JOB_INVALID'], ['INVALID\nWHY: roto', 'DOCS_JOB_INVALID'], ['HUMAN\nWHY: decide tu', 'DOCS_NEED_HUMAN'], [null, 'DOCS_JOB_INVALID']]) {
    const r = stubbed(f, 'work', out)(); stop(r, code); assert.equal(r.state, '4', String(out));
  }
  assert.match(stubbed(f, 'work', 'INVALID\nWHY: roto')().why.join(' '), /roto/); assert.match(stubbed(f, 'work', 'HUMAN\nWHY: decide tu')().why.join(' '), /decide tu/);
  const ok = stubbed(f, 'work', 'READY')(); assert.equal(ok.kind, 'RUN'); assert.match(ok.value, /checks\.sh/);
  const run1 = stubbed(f, 'work', 'COMMIT\nCMD: echo hola\nWHY: porque')(); assert.equal(run1.kind, 'RUN'); assert.equal(run1.value, 'echo hola');
  const del = stubbed(f, 'work', 'ALIGN\nOWNER: architect\nFILES: factory/worktrees/job-1/x.md\nWHAT: haz\nWHY: a\nWHY: b')(); delegate(del, 'architect'); assert.equal(del.value, '@architect | haz | factory/worktrees/job-1/x.md');
});
test('fallar cerrado (fases fix, changes y approve): una palabra que no es de su fase, vacia o un crash => STOP', { skip: SK }, () => {
  const g = worked(); write(path.join(g.wt, 'src/f.js'), 'x\n'); git(g.wt, 'add', 'src/f.js'); git(g.wt, 'commit', '-qm', 'x'); assert.equal(checks(g).status, 1);
  for (const out of ['', 'basura', 'READY', 'OK', null]) stop(stubbed(g, 'fix', out)(), 'DOCS_JOB_INVALID');
  const h = worked(); assert.equal(checks(h).status, 0); h.reviews(1); h.decision('CHANGES');
  for (const out of ['', 'basura', 'READY', 'OK', null]) stop(stubbed(h, 'changes', out)(), 'DOCS_JOB_INVALID');
  const a = worked(); assert.equal(checks(a).status, 0); a.reviews(1); a.decision('APPROVE'); a.human('NEEDS_HUMAN', true);
  for (const out of ['', 'basura', 'READY', 'WORK\nOWNER: x\nFILES: y\nWHAT: z', null]) stop(stubbed(a, 'approve', out)(), 'DOCS_JOB_INVALID');
  const okr = stubbed(a, 'approve', 'OK')(); delegate(okr, 'memory-curator');
  const conf = stubbed(a, 'approve', 'CONFIRM\nWHY: aprueba\nCMD: echo aprobar')(); stop(conf, 'HUMAN_CONFIRM_PROJECT'); assert.deepEqual(conf.cmd, ['echo aprobar']);
  const sinCmd = stubbed(a, 'approve', 'CONFIRM\nWHY: nada aprobable')(); stop(sinCmd, 'HUMAN_CONFIRM_PROJECT'); assert.deepEqual(sinCmd.cmd, []);
});

// ---------------------------------------------------------------- CA-I9.1: un job docs llega a PR sin builder
function analyst(f) {
  return (r) => {
    const files = r.value.split(' | ')[2];
    if (files.includes('spec.md')) return f.docsSpec();
    if (files.includes('01-requisitos.md')) return f.agentEdit('01-requisitos', ...REQ2);
    if (files.includes('02-casos-de-uso.md')) return f.marcarDesactualizado('02-casos-de-uso');
    throw new Error('system-analyst sin simular: ' + files);
  };
}
function curator(f) {
  return () => {
    const sha7 = fs.readFileSync(path.join(f.job, 'gate.md'), 'utf8').match(/^COMMIT: (\w{7})/m)[1];
    write(path.join(f.wt, '02-DOCS/wiki/jobs/job-1.md'), `# job job-1\n\nGate sobre el commit ${sha7}: GATE: PASS\n`);
    write(path.join(f.wt, '02-DOCS/wiki/index.md'), fs.readFileSync(path.join(f.wt, '02-DOCS/wiki/index.md'), 'utf8') + '| job job-1 | `02-DOCS/wiki/jobs/job-1.md` | doc |\n');
    put(path.join(f.job, 'trace.md'), '# trace\nBrain: 02-DOCS/wiki/jobs/job-1.md, 02-DOCS/wiki/index.md\n');
  };
}
test('CA-I9.1 E2E: input -> spec docs -> spec.ok -> agentes dueños -> gate -> 4 reviewers -> approver -> human-gate -> aprobacion humana -> curator -> push -> PR, sin builder', { skip: SK, timeout: 300000 }, () => {
  const f = docsJob({ stage: 'job' }); const gh = fakeGh(); f.gh = gh.bin; const before = git(f.repo, 'status', '--porcelain').trim();
  const { actions, final } = drive(f, { agents: { 'system-analyst': analyst(f), 'memory-curator': curator(f) },
    humans: { HUMAN_CONFIRM_SPEC: () => f.confirm(), HUMAN_CONFIRM_PROJECT: (r) => { const o = runCmd(f, r.cmd[0]); assert.equal(o.status, 0, o.stdout + o.stderr); } } });
  const trail = actions.map((a) => a.first).join('\n');
  assert.equal(final.first, 'DONE', trail);
  const agents = actions.filter((a) => a.kind === 'DELEGATE').map((a) => a.value.split(' | ')[0].slice(1));
  assert.ok(!agents.includes('builder'), 'un job docs no pasa por el builder'); assert.ok(!agents.includes('spec-writer'));
  for (const a of ['intake', 'system-analyst', 'approver', 'human-gate', 'memory-curator']) assert.ok(agents.includes(a), `${a}: ${trail}`);
  const runs = actions.filter((a) => a.kind === 'RUN').map((a) => a.value);
  assert.equal(runs.filter((c) => /checks\.sh/.test(c)).length, 1, 'el commit de aprobacion no repite el gate'); assert.equal(runs.filter((c) => /launch-reviewers\.sh/.test(c)).length, 1, 'ni los reviews');
  assert.ok(runs.some((c) => /commit-brain\.sh job-1 --project$/.test(c))); assert.ok(runs.some((c) => /^git push -u origin factory\/job-1$/.test(c))); assert.ok(runs.some((c) => /^gh pr create --draft/.test(c)));
  const idx = (pred) => actions.findIndex(pred);
  const iHuman = idx((a) => a.kind === 'DELEGATE' && /^@human-gate/.test(a.value)), iProj = idx((a) => a.kind === 'STOP' && a.value === 'HUMAN_CONFIRM_PROJECT'), iCur = idx((a) => a.kind === 'DELEGATE' && /^@memory-curator/.test(a.value)), iApp = idx((a) => a.kind === 'DELEGATE' && /^@approver/.test(a.value));
  assert.ok(iApp < iHuman && iHuman < iProj && iProj < iCur, `la aprobacion humana de la base va tras el human-gate y antes del curator: ${trail}`);
  const proj = actions[iProj]; assert.equal(proj.state, 'project'); assert.match(proj.cmd[0], /^cd factory\/worktrees\/job-1 && node factory\/scripts\/project-lint\.mjs approve 01-requisitos 02-casos-de-uso$/);
  assert.match(gh.created(), /--title docs: ajustar el listado --body/); assert.match(gh.created(), /--head factory\/job-1/);
  assert.match(fs.readFileSync(path.join(f.wt, PD, '01-requisitos.md'), 'utf8'), /^estado: aprobado$/m); assert.ok(JSON.parse(fs.readFileSync(path.join(f.wt, PD, 'project.ok'), 'utf8')).docs['01-requisitos']);
  assert.equal(git(f.repo, 'status', '--porcelain').trim(), before, 'el checkout principal queda como estaba');
  assert.equal(git(f.wt, 'status', '--porcelain').trim(), '');
  // cada DELEGATE puede escribir lo que dice (permisos del agente + guard) y cada RUN lo aceptan el guard y el orchestrator
  for (const a of actions.filter((x) => x.kind === 'DELEGATE')) {
    const [who, , files] = a.value.split(' | ').map((x) => x.trim()); const agent = who.slice(1);
    for (const file of files.split(',')) for (const v of [file, '/home/u/ai-factory/' + file]) {
      assert.equal(decide(perms(agent).edit, v, 'deny'), 'allow', `${agent} no puede escribir ${v}`); assert.equal(classifyTool('write', { filePath: v }).blocked, false, `el guard bloquea ${agent} -> ${v}`);
    }
  }
  for (const c of runs) { assert.equal(classifyBash(c).blocked, false, `el guard bloquea: ${c}`); assert.equal(decide(perms('orchestrator').bash, c), 'allow', `el orchestrator no tiene permiso para: ${c}`); }
  for (const a of actions.filter((x) => x.kind === 'STOP')) assert.ok(fs.readFileSync(path.join(REPO, '.opencode/agent/orchestrator.md'), 'utf8').includes(a.value), `el orchestrator no explica ${a.value}`);
});
test('E2E: el approver puede devolver CHANGES a los agentes de documentacion y el flujo se repite hasta APPROVE', { skip: SK, timeout: 300000 }, () => {
  const f = docsJob({ stage: 'job' }); f.gh = fakeGh().bin; let n = 0;
  const { actions, final } = drive(f, { agents: { 'system-analyst': analyst(f), 'memory-curator': curator(f), 'domain-modeler': (r) => (r.value.includes('03-dominio.md') ? f.agentEdit('03-dominio', 'número, fecha', 'número, fecha, estado') : f.marcarDesactualizado('05-datos')), architect: () => f.marcarDesactualizado('04-arquitectura'), approver: () => { if (++n === 1) { fs.writeFileSync(path.join(f.job, 'decision.md'), 'CHANGES\n\nEl 03-dominio debe guardar el estado del pedido (ENT-1).\n'); put(path.join(f.job, 'decision.md'), fs.readFileSync(path.join(f.job, 'decision.md'), 'utf8')); } else f.decision('APPROVE'); } },
    humans: { HUMAN_CONFIRM_SPEC: () => f.confirm(), HUMAN_CONFIRM_PROJECT: (r) => { const o = runCmd(f, r.cmd[0]); assert.equal(o.status, 0, o.stdout + o.stderr); } } });
  assert.equal(final.first, 'DONE', actions.map((a) => a.first).join('\n'));
  const agents = actions.filter((a) => a.kind === 'DELEGATE').map((a) => a.value.split(' | ')[0].slice(1));
  assert.ok(agents.includes('domain-modeler')); assert.ok(!agents.includes('builder')); assert.equal(agents.filter((a) => a === 'approver').length, 2);
  assert.equal(actions.filter((a) => a.kind === 'RUN' && /launch-reviewers/.test(a.value)).length, 2, 'una ronda nueva tras el cambio');
});

// ---------------------------------------------------------------- documentacion en el prompt del orchestrator (no depende del parche)
test('orchestrator.md explica los STOP del job docs y quien produce cada artefacto', () => {
  const orch = fs.readFileSync(path.join(REPO, '.opencode/agent/orchestrator.md'), 'utf8');
  for (const c of ['BASE_DOCS_BEHIND', 'DOCS_NEED_HUMAN', 'DOCS_JOB_INVALID']) assert.ok(orch.includes(c), c);
  assert.match(orch, /kind: docs/); assert.match(orch, /system-analyst/); assert.match(orch, /rebase/);
});
