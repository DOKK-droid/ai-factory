// Peticiones de cambio al Brain normativo: brain-request.mjs (estado derivado de archivos y de git), commit-brain.sh --project,
// permisos de los agentes y la integracion con next-step.sh / guard / scope / lib.sh.
//
// Los tests de integracion dependen de un PARCHE a archivos protegidos (docs/propuestas/rama2-brain-requests.patch, lo aplica
// el humano). Mientras no este aplicado se saltan con un motivo explicito; y un test exige que se aplique entero o nada.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, git, run } from './helpers.mjs';
import { fx, put, parse as parseNs, NEXT, COMMIT_BRAIN } from './ns-fixture.mjs';
import { makeProject, DOC_NAMES } from './project-fixture.mjs';
import { parse as parseBr } from '../factory/scripts/brain-request.mjs';
import { classifyBash, isProtectedPath } from '../factory/scripts/command-guard.mjs';
import { checkScope } from '../factory/scripts/scope-check.mjs';

const BR_MJS = path.join(REPO, 'factory/scripts/brain-request.mjs');
const LINT = path.join(REPO, 'factory/scripts/project-lint.mjs');
const PATCH = 'docs/propuestas/rama2-brain-requests.patch';

const BLOCK = (n = 1, o = {}) => `## BR-${n}
Documento: ${o.doc ?? '01-requisitos'}
Ids: ${o.ids ?? 'REQ-F-2'}
Solicitante: ${o.who ?? 'builder'}
Cita: ${o.cita ?? 'src/feature.js#L1'}
Motivo: ${o.motivo ?? 'el código lista y filtra, el requisito solo lista'}
Cambio propuesto: ${o.cambio ?? 'REQ-F-2 debe decir listar y filtrar los pedidos'}
`;
const HEADER = '# Peticiones de cambio al Brain\n\n';

/** Job con worktree real (fabrica instalada: 01-TOOLS y factory/scripts), listo para `state`. */
function job(opts = {}) {
  const f = fx({ tools: true, ...opts }).upTo('job');
  f.base = JSON.parse(fs.readFileSync(path.join(f.job, 'job.json'), 'utf8')).base;
  f.request = (text) => put(path.join(f.job, 'brain-request.md'), text);
  f.ok = () => put(path.join(f.job, 'brain.ok'), '');
  f.st = () => {
    const r = run('node', [BR_MJS, 'state', '--job-dir', f.job, '--job-id', f.id, '--worktree', f.wt, '--base', f.base], { cwd: f.repo });
    const lines = r.stdout.split('\n').filter(Boolean);
    const get = (k) => lines.filter((l) => l.startsWith(k + ': ')).map((l) => l.slice(k.length + 2));
    return { code: r.status, first: lines[0] || '', kind: (lines[0] || '').split(' ')[0], get, raw: r.stdout, why: get('WHY'), stderr: r.stderr };
  };
  f.cbp = (...a) => run('bash', [COMMIT_BRAIN, f.id, ...a], { cwd: f.wt, env: f.env() });
  return f;
}
/** Copia la base documental valida (project-fixture) a la raiz de `f` y la deja commiteada en main y en origin. */
function seedProject(f, { approve = true } = {}) {
  const p = makeProject();
  for (const rel of ['README.md', ...DOC_NAMES.map((d) => `02-DOCS/wiki/project/${d}.md`), '02-DOCS/wiki/project/discovery.md', '02-DOCS/wiki/sdd/decisions.md']) {
    write(path.join(f.repo, rel), fs.readFileSync(path.join(p.root, rel), 'utf8'));
  }
  if (approve) { const docs = Array.isArray(approve) ? approve : DOC_NAMES; const r = run('node', [LINT, 'approve', ...docs, '--root', f.repo, '--bootstrap']); assert.equal(r.status, 0, r.stdout); }
  git(f.repo, 'add', '-A'); git(f.repo, 'commit', '-qm', 'base documental'); git(f.repo, 'push', '-q', 'origin', 'main');
}
const edit = (file, from, to) => { const t = fs.readFileSync(file, 'utf8'); assert.ok(t.includes(from), `no contiene: ${from}`); fs.writeFileSync(file, t.replace(from, to)); };

// ---------------------------------------------------------------- formato
test('parse: un bloque valido no da problemas y los campos multilinea se unen', () => {
  const r = parseBr(HEADER + BLOCK(1, { motivo: 'primera línea\n  segunda línea' }));
  assert.deepEqual(r.problems, []); assert.equal(r.blocks[0].fields.Motivo, 'primera línea segunda línea');
});
test('parse: campos que faltan, documento/ids/solicitante inválidos, ids ajenos al documento, repetidos y archivo sin bloques', () => {
  const p = (t) => parseBr(t).problems.join('\n');
  assert.match(p(HEADER), /ningún bloque/); assert.match(p(''), /ningún bloque/);
  assert.match(p(BLOCK(1).replace(/^Motivo:.*\n/m, '')), /falta el campo Motivo/);
  assert.match(p(BLOCK(1).replace(/^Cambio propuesto:.*\n/m, '')), /falta el campo Cambio propuesto/);
  assert.match(p(BLOCK(1, { doc: '07-otro' })), /Documento debe ser/);
  assert.match(p(BLOCK(1, { ids: 'REQ-F-x' })), /no es un ID válido/);
  assert.match(p(BLOCK(1, { ids: 'UC-1' })), /UC-1 no se define en 01-requisitos/);
  assert.match(p(BLOCK(1, { doc: 'decisions', ids: 'REQ-F-1' })), /solo caben ADR/);
  assert.equal(p(BLOCK(1, { doc: 'decisions', ids: 'ADR-003' })), '');
  assert.equal(p(BLOCK(1, { ids: '-' })), '');
  assert.match(p(BLOCK(1, { who: 'Builder 2' })), /Solicitante/);
  assert.match(p(BLOCK(1) + BLOCK(1)), /repetido/);
});
test('check (CLI): 0 si es válido, 1 con problemas, 1 si no existe, 64 sin argumentos', () => {
  const d = tmp('af-br-'); write(path.join(d, 'ok.md'), HEADER + BLOCK(1)); write(path.join(d, 'mal.md'), HEADER + BLOCK(1, { ids: 'x' }));
  assert.equal(run('node', [BR_MJS, 'check', path.join(d, 'ok.md')]).status, 0);
  const bad = run('node', [BR_MJS, 'check', path.join(d, 'mal.md')]); assert.equal(bad.status, 1); assert.match(bad.stdout, /ID válido/);
  assert.equal(run('node', [BR_MJS, 'check', path.join(d, 'no.md')]).status, 1); assert.equal(run('node', [BR_MJS, 'check']).status, 64);
});
test('los prompts de builder, spec-writer y approver piden exactamente los campos que el parser exige', () => {
  for (const a of ['builder', 'spec-writer', 'approver']) {
    const t = fs.readFileSync(path.join(REPO, `.opencode/agent/${a}.md`), 'utf8');
    assert.match(t, /## BR-<n>\nDocumento:[^\n]*\nIds:[^\n]*\nSolicitante:[^\n]*\nCita:[^\n]*\nMotivo:[^\n]*\nCambio propuesto:[^\n]*\n/, a);
    assert.match(t, /brain-request\.md/); assert.match(t, /brain\.ok/);
  }
});

// ---------------------------------------------------------------- estado
test('state: sin brain-request.md => NONE', () => { const r = job().st(); assert.equal(r.first, 'NONE'); assert.equal(r.code, 0); });
test('state: archivo inválido (vacío, sin bloques, campo que falta) => INVALID con el porqué, aunque exista brain.ok', () => {
  const f = job(); f.request(''); f.ok(); let r = f.st(); assert.equal(r.kind, 'INVALID'); assert.match(r.why.join(' '), /ningún bloque/);
  f.request(HEADER + BLOCK(1).replace(/^Cita:.*\n/m, '')); f.ok(); r = f.st(); assert.equal(r.kind, 'INVALID'); assert.match(r.why.join('\n'), /falta el campo Cita/);
});
test('state: petición válida sin brain.ok, o con brain.ok MÁS ANTIGUO, => CONFIRM con el CMD para el humano', () => {
  const f = job(); f.request(HEADER + BLOCK(1));
  let r = f.st(); assert.equal(r.kind, 'CONFIRM'); assert.deepEqual(r.get('CMD'), [`touch factory/jobs/${f.id}/brain.ok`]); assert.match(r.why.join('\n'), /BR-1 01-requisitos REQ-F-2 \(builder\)/);
  f.ok(); f.request(HEADER + BLOCK(1));   // la petición se reescribe DESPUÉS de la confirmación
  assert.equal(f.st().kind, 'CONFIRM');
});
test('state: con brain.ok más nuevo => APPLY al propietario del documento, sobre la ruta de la worktree y sin "|" en WHAT', () => {
  const f = job(); f.request(HEADER + BLOCK(1, { cambio: 'a | b' })); f.ok();
  const r = f.st(); assert.equal(r.first, 'APPLY BR-1'); assert.deepEqual(r.get('OWNER'), ['system-analyst']);
  assert.deepEqual(r.get('FILES'), [`factory/worktrees/${f.id}/02-DOCS/wiki/project/01-requisitos.md`]); assert.doesNotMatch(r.get('WHAT')[0], /\|/);
  const d = job(); d.request(HEADER + BLOCK(1, { doc: 'decisions', ids: 'ADR-007' })); d.ok();
  const s = d.st(); assert.deepEqual(s.get('OWNER'), ['architect']); assert.deepEqual(s.get('FILES'), [`factory/worktrees/${d.id}/02-DOCS/wiki/sdd/decisions.md`]);
});
test('state: propietarios por documento', () => {
  const owners = { '00-vision': 'system-analyst', '03-dominio': 'domain-modeler', '04-arquitectura': 'architect', '05-datos': 'domain-modeler', '06-despliegue': 'deployment-planner' };
  for (const [doc, who] of Object.entries(owners)) { const f = job(); f.request(HEADER + BLOCK(1, { doc, ids: '-' })); f.ok(); assert.deepEqual(f.st().get('OWNER'), [who], doc); }
});
test('state: el agente editó el documento => COMMIT BR-n; commit-brain --project deja la línea Brain-Request y la petición pasa a aplicada', () => {
  const f = job(); f.request(HEADER + BLOCK(1)); f.ok();
  write(path.join(f.wt, '02-DOCS/wiki/project/01-requisitos.md'), '# Requisitos\nREQ-F-2 listar y filtrar\n');
  const r = f.st(); assert.equal(r.kind, 'COMMIT'); assert.deepEqual(r.get('BR'), ['BR-1']); assert.deepEqual(r.get('CMD'), [`cd factory/worktrees/${f.id} && bash 01-TOOLS/commit-brain.sh ${f.id} --project BR-1`]);
  const c = f.cbp('--project', 'BR-1'); assert.equal(c.status, 0, c.stdout + c.stderr);
  assert.match(git(f.wt, 'log', '-1', '--format=%B'), /^docs\(project\): aplica la peticion BR-1 del job .*\n\nBrain-Request: BR-1\n/);
  assert.equal(f.st().first, 'DONE');   // sin base aprobada, no hay nada más que alinear
});
test('state: una segunda petición posterior a brain.ok vuelve a pedir confirmación, y solo lista la nueva', () => {
  const f = job(); f.request(HEADER + BLOCK(1)); f.ok();
  write(path.join(f.wt, '02-DOCS/wiki/project/01-requisitos.md'), '# R\n'); assert.equal(f.cbp('--project', 'BR-1').status, 0);
  f.request(HEADER + BLOCK(1) + '\n' + BLOCK(2, { doc: '03-dominio', ids: '-' }));
  const r = f.st(); assert.equal(r.kind, 'CONFIRM'); assert.match(r.why.join('\n'), /BR-2/); assert.doesNotMatch(r.why.join('\n'), /BR-1 /);
});
test('state: una petición aplicada en OTRO job (misma numeración en la historia de la base) no cuenta', () => {
  const f = job(); f.request(HEADER + BLOCK(1)); f.ok();
  git(f.repo, 'commit', '-q', '--allow-empty', '-m', 'docs(project): otra\n\nBrain-Request: BR-1'); git(f.repo, 'push', '-q', 'origin', 'main');
  assert.equal(f.st().first, 'APPLY BR-1');   // el commit está en main, no en base..HEAD de la rama del job
});
test('state: base documental aprobada => ALIGN al dueño del documento afectado, luego REAPPROVE para el humano, luego COMMIT y DONE', () => {
  const f = fx({ tools: true }); seedProject(f); f.upTo('job'); f.base = JSON.parse(fs.readFileSync(path.join(f.job, 'job.json'), 'utf8')).base;
  f.cbp = (...a) => run('bash', [COMMIT_BRAIN, f.id, ...a], { cwd: f.wt, env: f.env() });
  const st = () => { const r = run('node', [BR_MJS, 'state', '--job-dir', f.job, '--job-id', f.id, '--worktree', f.wt, '--base', f.base], { cwd: f.repo }); const l = r.stdout.split('\n').filter(Boolean); return { first: l[0], kind: l[0].split(' ')[0], get: (k) => l.filter((x) => x.startsWith(k + ': ')).map((x) => x.slice(k.length + 2)), raw: r.stdout }; };
  put(path.join(f.job, 'brain-request.md'), HEADER + BLOCK(1)); put(path.join(f.job, 'brain.ok'), '');
  const req = path.join(f.wt, '02-DOCS/wiki/project/01-requisitos.md');
  edit(req, 'listar los pedidos.', 'listar y filtrar los pedidos.'); edit(req, 'estado: aprobado', 'estado: desactualizado'); edit(req, 'version: 0.1.0', 'version: 0.2.0');
  assert.equal(st().kind, 'COMMIT'); assert.equal(f.cbp('--project', 'BR-1').status, 0);
  // 02-casos-de-uso cita REQ-F-2, que cambió, y sigue marcado aprobado => hay que alinearlo
  let r = st(); assert.equal(r.kind, 'ALIGN', r.raw); assert.deepEqual(r.get('OWNER'), ['system-analyst']); assert.match(r.get('FILES')[0], /02-casos-de-uso\.md$/); assert.match(r.get('WHY').join(' '), /PL051/);
  const uc = path.join(f.wt, '02-DOCS/wiki/project/02-casos-de-uso.md'); edit(uc, 'estado: aprobado', 'estado: desactualizado');
  assert.equal(st().kind, 'COMMIT'); assert.deepEqual(st().get('BR'), ['-']); assert.equal(f.cbp('--project').status, 0);
  r = st(); assert.equal(r.kind, 'REAPPROVE', r.raw); assert.deepEqual(r.get('DOCS'), ['01-requisitos 02-casos-de-uso']);
  assert.match(r.get('CMD')[0], /node factory\/scripts\/project-lint\.mjs approve 01-requisitos 02-casos-de-uso$/);
  const a = run('node', [LINT, 'approve', '01-requisitos', '02-casos-de-uso', '--root', f.wt]); assert.equal(a.status, 0, a.stdout);
  assert.equal(st().kind, 'COMMIT'); assert.equal(f.cbp('--project').status, 0);
  assert.equal(st().first, 'DONE', st().raw);
  assert.equal(run('node', [LINT, 'gate', '--root', f.wt]).status, 0);
});
test('state: un error en un documento que aún no está aprobado no es motivo de ALIGN (solo se vigila la base ya aprobada)', () => {
  const f = fx({ tools: true }); seedProject(f, { approve: ['00-vision'] });
  write(path.join(f.repo, '02-DOCS/wiki/project/04-arquitectura.md'), fs.readFileSync(path.join(f.repo, '02-DOCS/wiki/project/04-arquitectura.md'), 'utf8') + 'Cubre REQ-NF-99.\n');
  git(f.repo, 'add', '-A'); git(f.repo, 'commit', '-qm', 'borrador con error'); git(f.repo, 'push', '-q', 'origin', 'main');
  f.upTo('job'); f.base = JSON.parse(fs.readFileSync(path.join(f.job, 'job.json'), 'utf8')).base; f.cbp = (...a) => run('bash', [COMMIT_BRAIN, f.id, ...a], { cwd: f.wt, env: f.env() });
  put(path.join(f.job, 'brain-request.md'), HEADER + BLOCK(1, { doc: '03-dominio', ids: '-' })); put(path.join(f.job, 'brain.ok'), '');
  assert.match(run('node', [LINT, 'check', '--root', f.wt]).stdout, /PL020 E 04-arquitectura.*REQ-NF-99/);   // el error existe...
  fs.appendFileSync(path.join(f.wt, '02-DOCS/wiki/project/03-dominio.md'), '\nNota. [FUENTE: README.md#Alcance]\n'); assert.equal(f.cbp('--project', 'BR-1').status, 0);
  const r = run('node', [BR_MJS, 'state', '--job-dir', f.job, '--job-id', f.id, '--worktree', f.wt, '--base', f.base], { cwd: f.repo });
  assert.equal(r.stdout.split('\n')[0], 'DONE', r.stdout);   // ...pero no pertenece a la base aprobada
});
test('state falla cerrado: base git ilegible, argumentos que faltan o job-id inválido => INVALID, nunca NONE/DONE', () => {
  const f = job(); f.request(HEADER + BLOCK(1)); f.ok();
  const bad = run('node', [BR_MJS, 'state', '--job-dir', f.job, '--job-id', f.id, '--worktree', f.wt, '--base', 'no-existe'], { cwd: f.repo }); assert.equal(bad.stdout.split('\n')[0], 'INVALID');
  assert.equal(run('node', [BR_MJS, 'state', '--job-dir', f.job]).stdout.split('\n')[0], 'INVALID');
  assert.equal(run('node', [BR_MJS, 'state', '--job-dir', f.job, '--job-id', '../x', '--worktree', f.wt, '--base', f.base]).stdout.split('\n')[0], 'INVALID');
  assert.equal(run('node', [BR_MJS, 'bogus']).status, 64);
});

// ---------------------------------------------------------------- commit-brain --project
test('commit-brain --project: solo la base documental y decisions.md; el modo normal no los acepta; argumentos validados', () => {
  const f = job();
  write(path.join(f.wt, 'src/otro.js'), 'x\n'); write(path.join(f.wt, '02-DOCS/wiki/project/00-vision.md'), '# v\n');
  const r = f.cbp('--project', 'BR-1'); assert.equal(r.status, 1); assert.match(r.stderr, /fuera de la base documental/); assert.match(r.stderr, /src\/otro\.js/);
  fs.rmSync(path.join(f.wt, 'src/otro.js'));
  assert.equal(f.cbp().status, 1);   // modo curator: la base documental NO es del curator
  assert.match(f.cbp().stderr, /fuera de la documentacion del curator/);
  assert.equal(f.cbp('--project', 'BR-x').status, 1); assert.equal(f.cbp('--proyecto').status, 1); assert.equal(f.cbp('--project', 'BR-1', 'extra').status, 1);
  assert.equal(f.cbp('--project').status, 0);   // sin BR: commit de alineación, sin línea Brain-Request
  const msg = git(f.wt, 'log', '-1', '--format=%B'); assert.match(msg, /alinea y aprueba la base documental/); assert.doesNotMatch(msg, /Brain-Request/);
});
test('commit-brain: el modo normal del curator sigue igual (jobs/, index.md, decisions.md)', () => {
  const f = job(); write(path.join(f.wt, '02-DOCS/wiki/jobs/x.md'), '# x\n'); write(path.join(f.wt, '02-DOCS/wiki/sdd/decisions.md'), '# d\n');
  assert.equal(f.cbp().status, 0); assert.match(git(f.wt, 'log', '-1', '--format=%s'), /^docs\(brain\): documentacion del job /);
  assert.match(f.cbp().stdout, /Nada que commitear/);
});

// ---------------------------------------------------------------- permisos de los agentes
function perms(agent) {
  const fm = fs.readFileSync(path.join(REPO, '.opencode/agent', agent + '.md'), 'utf8').split('\n---\n')[0].split('\n');
  const out = { edit: [], flat: {} }; let sec = null;
  for (const l of fm) { let m = l.match(/^  (\w+):\s*(\w+)?$/); if (m) { sec = m[1]; if (m[2]) out.flat[sec] = m[2]; continue; } m = l.match(/^    "([^"]+)":\s*(\w+)$/); if (m && sec === 'edit') out.edit.push([m[1], m[2]]); }
  return out;
}
const rx = (pat) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 's');
const canEdit = (agent, file) => { const p = perms(agent); if (p.flat.edit) return p.flat.edit; return p.edit.reduce((acc, [pat, a]) => (rx(pat).test(file) ? a : acc), 'ask'); };
const AGENTS = ['orchestrator', 'intake', 'spec-writer', 'builder', 'reviewer-security', 'reviewer-ux', 'reviewer-ui', 'reviewer-code', 'approver', 'human-gate', 'memory-curator'];
test('solo builder, spec-writer y approver pueden escribir brain-request.md; ninguno puede crear brain.ok', () => {
  const req = '/r/factory/jobs/job-1/brain-request.md', ok = '/r/factory/jobs/job-1/brain.ok';
  for (const a of AGENTS) {
    assert.equal(canEdit(a, req) === 'allow', ['spec-writer', 'builder', 'approver'].includes(a), `${a} sobre brain-request.md`);
    assert.notEqual(canEdit(a, ok), 'allow', `${a} no puede crear brain.ok`);
  }
});
test('ningún agente de la fábrica puede escribir el Brain normativo (02-DOCS/wiki/project/, project.ok)', () => {
  for (const a of AGENTS) for (const f of ['/r/factory/worktrees/j/02-DOCS/wiki/project/01-requisitos.md', '/r/factory/worktrees/j/02-DOCS/wiki/project/project.ok', '/r/02-DOCS/wiki/project/04-arquitectura.md']) assert.notEqual(canEdit(a, f), 'allow', `${a} -> ${f}`);
});
test('el builder sigue pudiendo escribir código y tests (la denegación es solo del Brain normativo)', () => {
  assert.equal(canEdit('builder', '/r/factory/worktrees/j/src/feature.js'), 'allow'); assert.equal(canEdit('builder', '/r/factory/worktrees/j/tests/a.test.mjs'), 'allow');
});

// ---------------------------------------------------------------- parche a archivos protegidos
const nsPatched = fs.readFileSync(NEXT, 'utf8').includes('brain-request.mjs');
const guardPatched = isProtectedPath('factory/jobs/j/brain.ok') !== undefined;
const nsDocsPatched = fs.readFileSync(NEXT, 'utf8').includes('docs-job.mjs');   // parche de la rama 6 (docs/propuestas/rama6-docs-job.patch)
const scopePatched = checkScope(['src/**'], [{ status: 'M', path: '02-DOCS/wiki/project/01-requisitos.md' }]).out.length === 0;
const libPatched = /FACTORY_PROJECT_DOC_PATHS/.test(fs.readFileSync(path.join(REPO, '01-TOOLS/lib.sh'), 'utf8'));
const miss = (ok) => (ok ? false : `falta aplicar ${PATCH}`);

test('el parche se aplica entero o no se aplica: ni a medias', () => {
  assert.deepEqual([nsPatched, guardPatched, scopePatched, libPatched], [nsPatched, nsPatched, nsPatched, nsPatched], `parche a medias (next-step=${nsPatched}, guard=${guardPatched}, scope=${scopePatched}, lib=${libPatched}); aplica ${PATCH} completo`);
});
test('el parche existe, es un diff válido de los 4 archivos protegidos y se aplica limpio o ya está aplicado', () => {
  const p = path.join(REPO, PATCH); assert.ok(fs.existsSync(p), PATCH);
  const files = [...fs.readFileSync(p, 'utf8').matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(files, ['01-TOOLS/lib.sh', '01-TOOLS/next-step.sh', 'factory/scripts/command-guard.mjs', 'factory/scripts/scope-check.mjs']);
  // Ya aplicado, el parche no se puede revertir limpio en cuanto otro parche posterior toca las mismas lineas: solo se comprueba antes de aplicarlo.
  if (!nsPatched) { const ck = run('git', ['apply', '--check', p], { cwd: REPO }); assert.equal(ck.status, 0, ck.stderr); }
});

test('guard: brain.ok y project.ok los crea el humano; project-lint approve no lo ejecuta un agente', { skip: miss(guardPatched) }, () => {
  for (const f of ['factory/jobs/j/brain.ok', '/r/factory/jobs/j/brain.ok', './factory/jobs/j/brain.ok', '02-DOCS/wiki/project/project.ok', '/r/factory/worktrees/j/02-DOCS/wiki/project/project.ok']) assert.ok(isProtectedPath(f), f);
  for (const c of ['touch factory/jobs/j/brain.ok', 'echo > factory/jobs/j/brain.ok', 'cp /dev/null /r/factory/jobs/j/brain.ok', 'echo x > 02-DOCS/wiki/project/project.ok',
    'node factory/scripts/project-lint.mjs approve 01-requisitos', 'node factory/scripts/project-lint.mjs --root . approve 01-requisitos 02-casos-de-uso', 'cd factory/worktrees/j && node factory/scripts/project-lint.mjs approve 00-vision']) assert.equal(classifyBash(c).blocked, true, c);
  for (const c of ['node factory/scripts/project-lint.mjs check', 'node factory/scripts/project-lint.mjs state', 'node factory/scripts/project-lint.mjs impact REQ-F-1', 'cat 02-DOCS/wiki/project/project.ok', 'cat factory/jobs/j/brain-request.md']) assert.equal(classifyBash(c).blocked, false, c);
  assert.equal(classifyBash('node factory/scripts/project-lint.mjs approve 00-vision', { allowProtected: true }).blocked, false);   // el humano (factory-maint)
  assert.equal(isProtectedPath('factory/jobs/j/brain-request.md'), undefined);   // esa SÍ la escriben los agentes
});
test('scope: la base documental no tiene que figurar en Alcance; el resto de docs sí', { skip: miss(scopePatched) }, () => {
  const c = (p) => [{ status: 'M', path: p }];
  assert.deepEqual(checkScope(['src/**'], c('02-DOCS/wiki/project/04-arquitectura.md')).out, []);
  assert.deepEqual(checkScope(['src/**'], c('02-DOCS/wiki/project/project.ok')).out, []);
  assert.deepEqual(checkScope(['src/**'], c('02-DOCS/wiki/context.md')).out, ['02-DOCS/wiki/context.md']);
  assert.deepEqual(checkScope(['src/**'], c('02-DOCS/wiki/projectx/a.md')).out, ['02-DOCS/wiki/projectx/a.md']);
});
test('lib.sh: los commits que solo tocan la base documental no invalidan gate ni reviews; los de código sí', { skip: miss(libPatched) }, () => {
  const f = job(); f.commit(); const sha = f.head();
  write(path.join(f.wt, '02-DOCS/wiki/project/01-requisitos.md'), '# r\n'); git(f.wt, 'add', '02-DOCS/wiki/project/01-requisitos.md'); git(f.wt, 'commit', '-qm', 'docs');
  const fresh = (s) => run('bash', ['-c', `source "${path.join(REPO, '01-TOOLS/lib.sh')}"; factory_commit_fresh "${s}" HEAD "${f.wt}"`]).status === 0;
  assert.equal(fresh(sha), true); f.commit('src/otro.js', 'export const z = 1;\n'); assert.equal(fresh(sha), false);
});
test('scope-check.mjs y lib.sh declaran la misma lista de base documental', { skip: miss(scopePatched && libPatched) }, async () => {
  const { PROJECT_DOC_PATHS } = await import('../factory/scripts/scope-check.mjs');
  const out = run('bash', ['-c', `source "${path.join(REPO, '01-TOOLS/lib.sh')}"; printf '%s\\n' "\${FACTORY_PROJECT_DOC_PATHS[@]}"`]).stdout.trim().split('\n');
  assert.deepEqual(out, PROJECT_DOC_PATHS);
});

// ---- next-step.sh
const full = (extra = {}) => ({ require_spec_ok: true, spec_profile: 'full', ...extra });
// Con la base aprobada (seed) el spec debe citarla en Implementa: (RF-I15), como exige spec-lint. Cita REQ-F-1 y UC-1; los tests cambian REQ-F-2.
const nsJob = (stage, o = {}) => {
  const f = fx({ tools: true, project: full(o.project || {}), ...(o.fx || {}) });
  if (o.seed) { seedProject(f, o.seed === true ? {} : o.seed); const spec = f.spec; f.spec = (x) => spec({ implementa: ['REQ-F-1', 'UC-1'], ...x }); }
  f.upTo(stage);
  // Con el spec confirmado y citando la base, el orchestrator ejecuta `project-lint stamp` (bloque 3b de next-step, si esta aplicado).
  if (o.seed && fs.existsSync(path.join(f.job, 'spec.ok'))) assert.equal(run('node', [LINT, 'stamp', f.id, '--jobs-dir', path.join(f.repo, 'factory/jobs')], { cwd: f.repo, env: f.env() }).status, 0);
  return f;
};
test('next-step 1b: petición inválida => STOP BRAIN_REQUEST_INVALID, antes de spec.ok y del builder', { skip: miss(nsPatched) }, () => {
  const f = nsJob('confirmed'); f.request = (t) => put(path.join(f.job, 'brain-request.md'), t);
  f.request('basura\n'); const r = f.ns(); assert.equal(r.kind, 'STOP'); assert.equal(r.value, 'BRAIN_REQUEST_INVALID'); assert.equal(r.code, 2); assert.equal(r.state, 'brain'); assert.match(r.why.join(' '), /ningún bloque/);
});
test('next-step 1b: sin brain.ok => STOP HUMAN_CONFIRM_BRAIN con el CMD exacto; con brain.ok => DELEGATE al dueño con 3 campos', { skip: miss(nsPatched) }, () => {
  const f = nsJob('confirmed'); put(path.join(f.job, 'brain-request.md'), HEADER + BLOCK(1));
  let r = f.ns(); assert.equal(r.value, 'HUMAN_CONFIRM_BRAIN'); assert.equal(r.code, 2); assert.deepEqual(r.cmd, [`touch factory/jobs/${f.id}/brain.ok`]); assert.match(r.why.join('\n'), /BR-1 01-requisitos REQ-F-2/);
  put(path.join(f.job, 'brain.ok'), '');
  r = f.ns(); assert.equal(r.kind, 'DELEGATE'); assert.equal(r.code, 0); assert.equal(r.value.split(' | ').length, 3, r.first); assert.match(r.value, /^@system-analyst \| aplicar la petición BR-1 .* \| factory\/worktrees\/job-1\/02-DOCS\/wiki\/project\/01-requisitos\.md$/);
});
test('next-step 1b: con cambios sin commitear en la base documental => RUN commit-brain --project BR-n; un commit solo de documentación no cuenta como trabajo del builder', { skip: miss(nsPatched) }, () => {
  const f = nsJob('confirmed'); put(path.join(f.job, 'brain-request.md'), HEADER + BLOCK(1)); put(path.join(f.job, 'brain.ok'), '');
  write(path.join(f.wt, '02-DOCS/wiki/project/01-requisitos.md'), '# R\n');
  let r = f.ns(); assert.equal(r.kind, 'RUN'); assert.equal(r.value, `cd factory/worktrees/${f.id} && bash 01-TOOLS/commit-brain.sh ${f.id} --project BR-1`);
  const x = run('bash', ['-c', r.value], { cwd: f.repo, env: f.env() }); assert.equal(x.status, 0, x.stdout + x.stderr);
  r = f.ns(); assert.equal(r.kind, 'DELEGATE'); assert.match(r.value, /^@builder \|/);   // spec confirmado y sin código: el flujo normal continúa
});
test('next-step: el approver no llega a APPROVE ni al push con una petición pendiente', { skip: miss(nsPatched) }, () => {
  const f = nsJob('humanized'); assert.equal(f.ns().kind, 'DELEGATE');   // sin petición, el flujo normal sigue (aquí pide trace)
  put(path.join(f.job, 'brain-request.md'), HEADER + BLOCK(1)); const r = f.ns(); assert.equal(r.value, 'HUMAN_CONFIRM_BRAIN');
  assert.doesNotMatch(r.raw, /git push/);
});
test('next-step 1b: tras aplicar una petición sobre una base aprobada => DELEGATE de alineación y STOP HUMAN_CONFIRM_PROJECT con el CMD de aprobación', { skip: miss(nsPatched) }, () => {
  const f = nsJob('confirmed', { seed: true }); put(path.join(f.job, 'brain-request.md'), HEADER + BLOCK(1)); put(path.join(f.job, 'brain.ok'), '');
  const req = path.join(f.wt, '02-DOCS/wiki/project/01-requisitos.md');
  edit(req, 'listar los pedidos.', 'listar y filtrar los pedidos.'); edit(req, 'estado: aprobado', 'estado: desactualizado'); edit(req, 'version: 0.1.0', 'version: 0.2.0');
  const cb = (...a) => run('bash', [COMMIT_BRAIN, f.id, ...a], { cwd: f.wt, env: f.env() });
  let r = f.ns(); assert.equal(r.kind, 'RUN'); assert.match(r.value, /commit-brain\.sh job-1 --project BR-1$/); assert.equal(cb('--project', 'BR-1').status, 0);
  r = f.ns(); assert.equal(r.kind, 'DELEGATE'); assert.equal(r.value.split(' | ').length, 3, r.first); assert.match(r.value, /^@system-analyst \| alinear 02-casos-de-uso .* \| factory\/worktrees\/job-1\/02-DOCS\/wiki\/project\/02-casos-de-uso\.md$/); assert.match(r.why.join(' '), /PL051/);
  edit(path.join(f.wt, '02-DOCS/wiki/project/02-casos-de-uso.md'), 'estado: aprobado', 'estado: desactualizado'); assert.equal(f.ns().kind, 'RUN'); assert.equal(cb('--project').status, 0);
  r = f.ns(); assert.equal(r.kind, 'STOP'); assert.equal(r.value, 'HUMAN_CONFIRM_PROJECT'); assert.equal(r.code, 2); assert.deepEqual(r.cmd, ['cd factory/worktrees/job-1 && node factory/scripts/project-lint.mjs approve 01-requisitos 02-casos-de-uso']);
  assert.equal(run('node', [LINT, 'approve', '01-requisitos', '02-casos-de-uso', '--root', f.wt]).status, 0); assert.equal(f.ns().kind, 'RUN'); assert.equal(cb('--project').status, 0);
  r = f.ns(); assert.equal(r.kind, 'DELEGATE'); assert.match(r.value, /^@builder/);   // todo alineado y aprobado: el flujo normal sigue
});
test('next-step 1b falla cerrado: una salida inesperada de brain-request.mjs es un STOP', { skip: miss(nsPatched) }, () => {
  const f = nsJob('confirmed'); const copy = tmp('af-ns-copy-'); fs.cpSync(path.join(REPO, '01-TOOLS'), path.join(copy, '01-TOOLS'), { recursive: true }); fs.cpSync(path.join(REPO, 'factory/scripts'), path.join(copy, 'factory/scripts'), { recursive: true });
  const stub = (body) => fs.writeFileSync(path.join(copy, 'factory/scripts/brain-request.mjs'), body);
  const go = () => parseNs(run('bash', [path.join(copy, '01-TOOLS/next-step.sh'), f.id], { cwd: f.repo, env: f.env() }));
  for (const body of ["console.log('QUIZAS')", "console.log('')", 'process.exit(3)', "throw new Error('x')", "console.log('APPLY BR-1')", "console.log('APPLY BR-1\\nOWNER: builder')", "console.log('ALIGN\\nOWNER: architect\\nFILES: x')"]) {
    stub(body); const r = go(); assert.equal(r.kind, 'STOP', body); assert.equal(r.value, 'BRAIN_REQUEST_INVALID', body); assert.equal(r.code, 2);
  }
  stub("console.log('NONE')"); const r = go(); assert.equal(r.kind, 'DELEGATE'); assert.match(r.value, /^@builder/);
});
test('next-step project_docs: valor inválido => PROJECT_INVALID; off/ausente no cambia el flujo', { skip: miss(nsPatched) }, () => {
  const bad = nsJob('job', { project: { project_docs: 'siempre' } }); const r = bad.ns(); assert.equal(r.value, 'PROJECT_INVALID'); assert.match(r.why.join(' '), /project_docs debe ser off o required/);
  const off = nsJob('job', { project: { project_docs: 'off' } }); assert.equal(off.ns().kind, 'DELEGATE');
});
test('next-step project_docs=required: sin base aprobada => STOP HUMAN_CONFIRM_PROJECT antes del spec; aprobada => el spec-writer', { skip: miss(nsPatched) }, () => {
  const none = nsJob('input', { project: { project_docs: 'required' } }); let r = none.ns();
  assert.equal(r.kind, 'STOP'); assert.equal(r.value, 'HUMAN_CONFIRM_PROJECT'); assert.equal(r.code, 2); assert.equal(r.state, 'project'); assert.match(r.why.join('\n'), /GATE 00-vision: AUSENTE/); assert.deepEqual(r.cmd, []);
  const listo = nsJob('input', { project: { project_docs: 'required' }, seed: { approve: false } }); r = listo.ns();
  assert.equal(r.value, 'HUMAN_CONFIRM_PROJECT'); assert.deepEqual(r.cmd, [`${nsDocsPatched ? 'cd factory/worktrees/job-1 && ' : ''}node factory/scripts/project-lint.mjs approve 00-vision 01-requisitos 02-casos-de-uso 03-dominio 04-arquitectura 05-datos 06-despliegue`]);   // rama 6: el CMD se ejecuta en la worktree (antes aprobaba el checkout principal)
  const ok = nsJob('input', { project: { project_docs: 'required' }, seed: true }); r = ok.ns(); assert.equal(r.kind, 'DELEGATE'); assert.match(r.value, /^@spec-writer/);
});
test('next-step project_docs=required: un documento editado después de aprobarse vuelve a bloquear', { skip: miss(nsPatched) }, () => {
  const f = nsJob('input', { project: { project_docs: 'required' }, seed: true }); assert.equal(f.ns().kind, 'DELEGATE');
  fs.appendFileSync(path.join(f.wt, '02-DOCS/wiki/project/00-vision.md'), '\nOtra frase. [FUENTE: README.md#Alcance]\n');
  const r = f.ns(); assert.equal(r.value, 'HUMAN_CONFIRM_PROJECT'); assert.match(r.why.join('\n'), /PL050|GATE 00-vision/);
});
