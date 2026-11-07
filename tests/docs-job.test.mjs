// docs-job.mjs (rama 6): la logica del job de documentacion (kind: docs). next-step.sh solo traduce la primera palabra de `state`.
// Aqui se prueba esa logica con worktrees reales y los scripts reales (project-lint, commit-brain.sh).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, run, git, write } from './helpers.mjs';
import { docsJob, ROW, PD, DOCS_JOB, docsSpecText } from './docs-fixture.mjs';
import { LINT } from './project-fixture.mjs';

const REQ2 = ['debe listar los pedidos', 'debe listar y filtrar los pedidos'];
const WT = (id, rel) => `factory/worktrees/${id}/${rel}`;
const gateMd = (f, body, l1 = 'GATE: FAIL') => write(path.join(f.job, 'gate.md'), `${l1}\nCOMMIT: ${f.head()}\nGATE_FAIL_STREAK: 1\n\n=== Gate de documentacion ===\n${body}\n`);

// ---------------------------------------------------------------- state --phase work
test('work: un documento afectado sin cambios => WORK al agente dueño, con la ruta de la worktree y el contexto', () => {
  const f = docsJob(); const r = f.docsState();
  assert.equal(r.first, 'WORK', r.raw); assert.equal(r.get('OWNER')[0], 'system-analyst');
  assert.equal(r.get('FILES')[0], WT('job-1', `${PD}/01-requisitos.md`));
  assert.match(r.get('WHAT')[0], /spec\.md/); assert.match(r.get('WHAT')[0], /REQ-F-2/); assert.match(r.get('WHAT')[0], /desactualizado/); assert.match(r.get('WHAT')[0], /nunca .*aprobado/i);
  assert.equal(r.code, 0);
});
test('work: con varios documentos afectados sigue el orden de dependencia de la base, uno por vez, y la cascada va despues de todos ellos', () => {
  const rows = [ROW('nuevo', '06-despliegue', 'deployment-planner'), ROW('ENT-1', '03-dominio', 'domain-modeler'), ROW('REQ-F-2', '01-requisitos', 'system-analyst')];
  const f = docsJob({ rows }); let r = f.docsState();
  assert.equal(r.first, 'WORK'); assert.equal(r.get('OWNER')[0], 'system-analyst'); assert.match(r.get('FILES')[0], /01-requisitos\.md$/);
  f.agentEdit('01-requisitos', ...REQ2); f.commitProject();
  r = f.docsState(); assert.equal(r.first, 'WORK'); assert.equal(r.get('OWNER')[0], 'domain-modeler'); assert.match(r.get('FILES')[0], /03-dominio\.md$/);
  f.agentEdit('03-dominio', 'número, fecha', 'número, fecha, estado'); f.commitProject();
  r = f.docsState(); assert.equal(r.first, 'WORK'); assert.equal(r.get('OWNER')[0], 'deployment-planner'); assert.match(r.get('FILES')[0], /06-despliegue\.md$/);
  f.agentEdit('06-despliegue', 'REQ-NF-1 se vigila', 'REQ-NF-1 se vigila ahora'); f.commitProject();
  r = f.docsState(); assert.equal(r.first, 'ALIGN', r.raw); assert.match(r.get('FILES')[0], /(02-casos-de-uso|05-datos)\.md$/);
});
test('work: un cambio sin commitear en la base => COMMIT con el comando de commit-brain --project; tras el commit sigue el flujo', () => {
  const f = docsJob(); f.agentEdit('01-requisitos', ...REQ2);
  const r = f.docsState(); assert.equal(r.first, 'COMMIT', r.raw);
  assert.equal(r.get('CMD')[0], 'cd factory/worktrees/job-1 && bash 01-TOOLS/commit-brain.sh job-1 --project');
  const ran = run('bash', ['-c', r.get('CMD')[0]], { cwd: f.repo, env: f.env() }); assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.equal(git(f.wt, 'status', '--porcelain').trim(), ''); assert.notEqual(f.docsState().first, 'COMMIT');
});
test('work: cambiar un REQ aprobado deja en ALIGN al dueño de cada documento que lo cita; alineado, queda READY', () => {
  const f = docsJob(); f.agentEdit('01-requisitos', ...REQ2); f.commitProject();
  let r = f.docsState(); assert.equal(r.first, 'ALIGN', r.raw); assert.equal(r.get('OWNER')[0], 'system-analyst');
  assert.equal(r.get('FILES')[0], WT('job-1', `${PD}/02-casos-de-uso.md`)); assert.match(r.get('WHY').join(' '), /PL051/); assert.match(r.get('WHY').join(' '), /REQ-F-2/);
  f.marcarDesactualizado('02-casos-de-uso'); f.commitProject();
  r = f.docsState(); assert.equal(r.first, 'READY', r.raw); assert.equal(r.code, 0);
});
test('work: cambiar una entidad alinea a los documentos que la citan', () => {
  const f = docsJob({ rows: [ROW('ENT-2', '03-dominio', 'domain-modeler')] });
  f.agentEdit('03-dominio', '- Atributos: nombre', '- Atributos: nombre, correo'); f.commitProject();
  assert.equal(f.docsState().first, 'ALIGN', 'ENT-2 lo citan 02 (Usa) y otros: esos documentos se alinean');
});
test('work: con trazabilidad.md presente y desfasada pide regenerarla (TRACE) y no la crea si no existe', () => {
  const f = docsJob({ rows: [ROW('UC-2', '02-casos-de-uso', 'system-analyst')] });
  assert.equal(run('node', [LINT, 'trace', '--write', '--root', f.wt]).status, 0); f.commitProject();
  f.agentEdit('02-casos-de-uso', '- Cubre: REQ-F-2', '- Cubre: REQ-F-2, REQ-F-1'); f.commitProject();
  const r = f.docsState(); assert.equal(r.first, 'TRACE', r.raw); assert.equal(r.get('CMD')[0], 'cd factory/worktrees/job-1 && node factory/scripts/project-lint.mjs trace --write');
  assert.equal(run('bash', ['-c', r.get('CMD')[0]], { cwd: f.repo, env: f.env() }).status, 0);
  assert.equal(f.docsState().first, 'COMMIT'); f.commitProject(); assert.equal(f.docsState().first, 'READY');
  const g = docsJob({ rows: [ROW('UC-2', '02-casos-de-uso', 'system-analyst')] });
  g.agentEdit('02-casos-de-uso', '- Cubre: REQ-F-2', '- Cubre: REQ-F-2, REQ-F-1'); g.commitProject();
  assert.equal(g.docsState().first, 'READY'); assert.equal(fs.existsSync(path.join(g.wt, PD, 'trazabilidad.md')), false);
});
test('work: un documento afectado que sigue siendo plantilla (RELLENAR) vuelve a su dueño aunque ya tenga commits', () => {
  const f = docsJob({ approve: false, rows: [ROW('nuevo', '03-dominio', 'domain-modeler')] });
  fs.copyFileSync(path.join(REPO, 'factory/templates/project/03-dominio.md'), f.file('03-dominio')); f.commitProject();
  const r = f.docsState(); assert.equal(r.first, 'WORK', r.raw); assert.equal(r.get('OWNER')[0], 'domain-modeler'); assert.match(r.get('WHY').join(' '), /plantilla|RELLENAR/i);
});
test('work: un ADR declarado exige que el architect escriba decisions.md, con el numero siguiente y el estado que fija el flujo', () => {
  const rows = [ROW('nuevo', 'decisions', 'architect')];
  const f = docsJob({ rows, adr: 'Indice por fecha', alcance: [`${PD}/**`, '02-DOCS/wiki/sdd/decisions.md'] }); const r = f.docsState();
  assert.equal(r.first, 'WORK', r.raw); assert.equal(r.get('OWNER')[0], 'architect'); assert.equal(r.get('FILES')[0], WT('job-1', '02-DOCS/wiki/sdd/decisions.md'));
  assert.match(r.get('WHAT')[0], /ADR-002: Indice por fecha/); assert.match(r.get('WHAT')[0], /Estado: Aprobado/);
  const g = docsJob({ rows, adr: 'Indice por fecha', alcance: [`${PD}/**`, '02-DOCS/wiki/sdd/decisions.md'], confirm: false });
  assert.match(g.docsState().get('WHAT')[0], /Estado: Propuesto/);
  f.agentEdit('decisions', '## ADR-001: Indice', '## ADR-001: Indice\n\n## ADR-002: Indice por fecha\nEstado: Aprobado', { stale: false }); f.commitProject();
  assert.equal(f.docsState().first, 'READY');
});
test('work: falla cerrado — spec ilegible o sin tabla, worktree inexistente, argumentos que faltan o fase desconocida => INVALID', () => {
  const f = docsJob(); fs.writeFileSync(path.join(f.job, 'spec.md'), '# Spec — Cambio documental: x\nSurface: none\n'); assert.equal(f.docsState().first, 'INVALID');
  fs.rmSync(path.join(f.job, 'spec.md')); assert.equal(f.docsState().first, 'INVALID');
  const g = docsJob(); assert.equal(g.docsState('otra').first, 'INVALID');
  const bad = run('node', [DOCS_JOB, 'state', '--phase', 'work', '--job-dir', g.job, '--job-id', 'job-1', '--worktree', path.join(g.repo, 'no-existe'), '--base', 'origin/main'], { cwd: g.repo, env: g.env() });
  assert.equal(bad.stdout.split('\n')[0], 'INVALID', bad.stdout);
  for (const args of [[], ['state'], ['state', '--phase', 'work'], ['state', '--phase', 'work', '--job-dir', g.job, '--job-id', '../x', '--worktree', g.wt, '--base', 'origin/main'], ['nada']]) {
    const r = run('node', [DOCS_JOB, ...args], { cwd: g.repo, env: g.env() });
    if (args[0] === 'state') assert.equal(r.stdout.split('\n')[0], 'INVALID', args.join(' ')); else assert.notEqual(r.status, 0, args.join(' '));
  }
  const h = docsJob(); const sinGit = run('node', [DOCS_JOB, 'state', '--phase', 'work', '--job-dir', h.job, '--job-id', 'job-1', '--worktree', h.wt, '--base', 'no-existe-ref'], { cwd: h.repo, env: h.env() });
  assert.equal(sinGit.stdout.split('\n')[0], 'INVALID', 'sin poder calcular el diff contra la base no se adivina');
});

// ---------------------------------------------------------------- state --phase fix (gate en rojo)
test('fix: los errores de project-lint del gate vuelven al dueño del primer documento afectado (orden de la base)', () => {
  const f = docsJob(); gateMd(f, 'PL021 E 01-requisitos.md:12 REQ-F-2 no lo cubre ningún caso de uso\nPL010 E 03-dominio.md:4 ID mal formado: ENT-x');
  const r = f.docsState('fix'); assert.equal(r.first, 'WORK', r.raw); assert.equal(r.get('OWNER')[0], 'system-analyst'); assert.equal(r.get('FILES')[0], WT('job-1', `${PD}/01-requisitos.md`));
  assert.match(r.get('WHY').join(' '), /PL021/); assert.doesNotMatch(r.get('WHY').join(' '), /PL010/, 'solo lo del documento que se delega');
});
test('fix: marcadores abiertos o ediciones fuera de alcance son del humano, no de un agente', () => {
  const f = docsJob(); gateMd(f, 'ABIERTO 01-requisitos.md:12 [PENDIENTE] ¿cuánto tarda?\nPL021 E 01-requisitos.md:12 algo');
  let r = f.docsState('fix'); assert.equal(r.first, 'HUMAN', r.raw); assert.match(r.get('WHY').join(' '), /\[PENDIENTE\]/); assert.match(r.get('WHY').join(' '), /01-requisitos\.md:12/);
  gateMd(f, 'FUERA_DE_ALCANCE\tsrc/app.js'); r = f.docsState('fix'); assert.equal(r.first, 'HUMAN'); assert.match(r.get('WHY').join(' '), /src\/app\.js/);
});
test('fix: si solo falla la trazabilidad generada se regenera (TRACE); un gate ilegible o sin motivo reconocible es INVALID', () => {
  const f = docsJob(); gateMd(f, 'PL061 E trazabilidad.md:1 no coincide con lo generado');
  assert.equal(f.docsState('fix').first, 'TRACE');
  gateMd(f, 'algo raro que no entiendo'); assert.equal(f.docsState('fix').first, 'INVALID');
  fs.rmSync(path.join(f.job, 'gate.md')); assert.equal(f.docsState('fix').first, 'INVALID');
});

// ---------------------------------------------------------------- state --phase changes (decision CHANGES)
test('changes: el dueño sale del documento que nombra decision.md; sin nombre, del primer documento afectado', () => {
  const f = docsJob({ rows: [ROW('REQ-F-2', '01-requisitos', 'system-analyst'), ROW('ENT-1', '03-dominio', 'domain-modeler')] });
  const dec = (t) => write(path.join(f.job, 'decision.md'), `CHANGES\n\n${t}\n`);
  dec('El 03-dominio no define el estado de ENT-1.'); let r = f.docsState('changes'); assert.equal(r.first, 'WORK', r.raw); assert.equal(r.get('OWNER')[0], 'domain-modeler'); assert.match(r.get('FILES')[0], /03-dominio\.md$/);
  dec('Revisa 03-dominio y 01-requisitos.'); r = f.docsState('changes'); assert.equal(r.get('OWNER')[0], 'system-analyst', 'el primero en orden de dependencia');
  dec('Faltan criterios.'); r = f.docsState('changes'); assert.equal(r.get('OWNER')[0], 'system-analyst'); assert.match(r.get('FILES')[0], /01-requisitos\.md$/);
  dec('El ADR no justifica la alternativa: decisions.'); r = f.docsState('changes'); assert.equal(r.get('OWNER')[0], 'architect'); assert.match(r.get('FILES')[0], /decisions\.md$/);
  fs.rmSync(path.join(f.job, 'decision.md')); assert.equal(f.docsState('changes').first, 'INVALID');
});

// ---------------------------------------------------------------- state --phase approve
test('approve: base ya aprobada y fresca => OK; documentos por aprobar => CONFIRM con el CMD desde la worktree; tras aprobar => OK', () => {
  const f = docsJob(); assert.equal(f.docsState('approve').first, 'OK');
  f.agentEdit('01-requisitos', ...REQ2); f.commitProject(); f.marcarDesactualizado('02-casos-de-uso'); f.commitProject();
  const r = f.docsState('approve'); assert.equal(r.first, 'CONFIRM', r.raw);
  assert.equal(r.get('CMD')[0], 'cd factory/worktrees/job-1 && node factory/scripts/project-lint.mjs approve 01-requisitos 02-casos-de-uso');
  assert.match(r.get('WHY').join(' '), /01-requisitos/);
  const ran = run('bash', ['-c', r.get('CMD')[0]], { cwd: f.repo, env: f.env() }); assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.equal(git(f.repo, 'status', '--porcelain', '--', PD).trim(), '', 'aprobar desde la worktree no toca el checkout principal');
  assert.equal(f.docsState('approve').first, 'OK');
  assert.equal(f.docsState().first, 'COMMIT', 'lo aprobado en la worktree se commitea con commit-brain --project');
});
test('approve: un documento con errores (no aprobable) => CONFIRM sin CMD y con el motivo', () => {
  const f = docsJob({ approve: false });
  f.agentEdit('01-requisitos', '[FUENTE: discovery.md#Q-1]', '[PENDIENTE]', { stale: false }); f.commitProject();
  const r = f.docsState('approve'); assert.equal(r.first, 'CONFIRM', r.raw); assert.match(r.get('WHY').join(' '), /01-requisitos/); assert.match(r.get('WHY').join(' '), /PENDIENTE/);
  assert.doesNotMatch(r.get('CMD').join(' '), /approve [^ ]*01-requisitos/, 'no ofrece aprobar un documento con [PENDIENTE]');
});

// ---------------------------------------------------------------- gate
const gate = (f) => f.docsGate();
test('gate: cambios solo en los documentos del alcance y sin errores => PASS (la base entera, sin tests de codigo)', () => {
  const f = docsJob(); f.agentEdit('01-requisitos', ...REQ2); f.commitProject(); f.marcarDesactualizado('02-casos-de-uso'); f.commitProject();
  const g = gate(f); assert.equal(g.code, 0, g.out + g.stderr); assert.match(g.out, /alcance: OK/); assert.match(g.out, /project-lint check --strict: OK/); assert.doesNotMatch(g.out, /FALLO/);
});
test('gate: un archivo fuera de la base, o de lo que declara el Alcance del spec, es FUERA_DE_ALCANCE', () => {
  const f = docsJob(); f.agentEdit('01-requisitos', ...REQ2); write(path.join(f.wt, 'src/otro.js'), 'export {}\n'); git(f.wt, 'add', 'src/otro.js'); git(f.wt, 'commit', '-qm', 'x');
  let g = gate(f); assert.equal(g.code, 1); assert.match(g.out, /^FUERA_DE_ALCANCE\tsrc\/otro\.js$/m);
  const h = docsJob({ alcance: [`${PD}/01-requisitos.md`] }); h.agentEdit('01-requisitos', ...REQ2); h.agentEdit('03-dominio', 'número, fecha', 'número, fecha, estado'); h.commitProject();
  g = gate(h); assert.equal(g.code, 1); assert.match(g.out, /^FUERA_DE_ALCANCE\t02-DOCS\/wiki\/project\/03-dominio\.md$/m); assert.doesNotMatch(g.out, /FUERA_DE_ALCANCE\t02-DOCS\/wiki\/project\/01-requisitos/);
});
test('gate: decisions.md solo cuenta dentro del alcance si hay ADR; project.ok, trazabilidad.md y la pagina del curator no cuentan como fuera', () => {
  const f = docsJob(); f.agentEdit('01-requisitos', ...REQ2); f.agentEdit('decisions', '## ADR-001: Indice', '## ADR-001: Indice\nx', { stale: false }); f.commitProject();
  assert.match(gate(f).out, /^FUERA_DE_ALCANCE\t02-DOCS\/wiki\/sdd\/decisions\.md$/m);
  const g = docsJob(); g.agentEdit('01-requisitos', ...REQ2); g.commitProject(); g.marcarDesactualizado('02-casos-de-uso'); g.commitProject();
  assert.equal(run('node', [LINT, 'trace', '--write', '--root', g.wt]).status, 0);
  write(path.join(g.wt, '02-DOCS/wiki/jobs/job-1.md'), '# job\n'); write(path.join(g.wt, '02-DOCS/wiki/index.md'), '# Brain\nx\n');
  const r = gate(g); assert.equal(r.code, 0, r.out); assert.doesNotMatch(r.out, /FUERA_DE_ALCANCE/);
});
test('gate: errores de project-lint (E) y plantillas sin rellenar suspenden; los avisos (W) no', () => {
  const f = docsJob(); f.agentEdit('01-requisitos', ...REQ2); f.agentEdit('01-requisitos', 'debe listar y filtrar los pedidos.', 'debe listar y filtrar los pedidos de UC-99.'); f.commitProject();
  let g = gate(f); assert.equal(g.code, 1); assert.match(g.out, /^PL020 E 01-requisitos\.md:\d+ UC-99/m);
  const h = docsJob({ approve: false, rows: [ROW('nuevo', '03-dominio', 'domain-modeler')] });
  fs.copyFileSync(path.join(REPO, 'factory/templates/project/03-dominio.md'), h.file('03-dominio')); h.commitProject();
  g = gate(h); assert.equal(g.code, 1); assert.match(g.out, /^PLANTILLA 03-dominio\.md/m);
});
test('gate: [PENDIENTE], [PROPUESTO] e [INFERIDO] en un documento tocado suspenden (ABIERTO, con documento y linea); en uno no tocado o en un bloque de codigo no', () => {
  const f = docsJob({ approve: false });
  f.agentEdit('01-requisitos', ...REQ2, { stale: false });
  f.agentEdit('01-requisitos', '- REQ-F-2: el sistema debe listar y filtrar los pedidos. [FUENTE: discovery.md#Q-1]', '- REQ-F-2: el sistema debe listar y filtrar los pedidos. [FUENTE: discovery.md#Q-1] [PROPUESTO]\n- REQ-F-3: algo [INFERIDO]\n- REQ-F-4: otro [PENDIENTE]', { stale: false });
  f.agentEdit('02-casos-de-uso', '### UC-2: Listar pedidos', '### UC-2: Listar pedidos\n```\n[PENDIENTE] dentro de codigo\n```', { stale: false });
  f.commitProject(); const g = gate(f); assert.equal(g.code, 1);
  const abiertos = g.out.split('\n').filter((l) => l.startsWith('ABIERTO '));
  assert.deepEqual(abiertos.map((l) => l.match(/\[(\w+)\]/)[1]).sort(), ['INFERIDO', 'PENDIENTE', 'PROPUESTO']);
  assert.ok(abiertos.every((l) => /^ABIERTO 01-requisitos\.md:\d+ /.test(l)), abiertos.join('\n'));
  const h = docsJob({ approve: false }); write(path.join(h.wt, PD, 'discovery.md'), fs.readFileSync(path.join(h.wt, PD, 'discovery.md'), 'utf8') + '\n- Q-9 [PENDIENTE]: abierta\n'); h.agentEdit('01-requisitos', ...REQ2, { stale: false }); h.commitProject();
  assert.doesNotMatch(gate(h).out, /ABIERTO/, 'discovery.md no es uno de los siete documentos');
});
test('gate: usa lo que hay en la worktree aunque no este commiteado, y falla cerrado sin argumentos o con un merge-base inexistente', () => {
  const f = docsJob(); f.agentEdit('01-requisitos', ...REQ2); write(path.join(f.wt, 'fuera.txt'), 'x\n');
  assert.match(gate(f).out, /^FUERA_DE_ALCANCE\tfuera\.txt$/m);
  assert.notEqual(run('node', [DOCS_JOB, 'gate'], { cwd: f.wt, env: f.env() }).status, 0);
  const r = run('node', [DOCS_JOB, 'gate', '--job-dir', f.job, '--merge-base', 'deadbeef'.repeat(5)], { cwd: f.wt, env: f.env() }); assert.notEqual(r.status, 0);
  assert.notEqual(run('node', [DOCS_JOB, 'gate', '--job-dir', path.join(f.repo, 'no-existe'), '--merge-base', 'HEAD'], { cwd: f.wt, env: f.env() }).status, 0);
});
test('el spec de la fixture es el que valida spec-lint docs (la fixture no se desvia del perfil)', () => {
  const f = docsJob({ confirm: false });
  const r = run('node', [path.join(REPO, 'factory/scripts/spec-lint.mjs'), 'check', path.join(f.job, 'spec.md'), path.join(f.job, 'tasks.md'), 'docs'], { cwd: f.repo, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  assert.match(docsSpecText(), /Cambio documental/);
});
