// next-step.sh: la maquina de estados del flujo. Un caso por fila de la tabla, orden, obsolescencia, rondas,
// ambiguedad => STOP, idempotencia/solo lectura y un recorrido completo con los scripts reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { REPO, tmp, write, git, run } from './helpers.mjs';
import { fx, fakeGh, drive, put, stamp, NEXT, SPEC } from './ns-fixture.mjs';

const expectDelegate = (r, agent, state) => {
  assert.equal(r.kind, 'DELEGATE', r.raw); assert.equal(r.code, 0);
  assert.equal(r.value.split(' | ').length, 3, `DELEGATE debe tener 3 campos: ${r.first}`);
  assert.match(r.value, new RegExp(`^@${agent} \\| `)); if (state !== undefined) assert.equal(r.state, String(state));
};
const expectRun = (r, re, state) => {
  assert.equal(r.kind, 'RUN', r.raw); assert.equal(r.code, 0); assert.match(r.value, re); if (state !== undefined) assert.equal(r.state, String(state));
};
const expectStop = (r, code) => { assert.equal(r.kind, 'STOP', r.raw); assert.equal(r.code, 2); assert.equal(r.value, code, r.raw); assert.ok(r.why.length, 'STOP sin WHY'); };

// ---------------------------------------------------------------- uso
test('uso: sin id o con id invalido => exit 1; --new-id imprime un id valido y no escribe nada', () => {
  const f = fx();
  assert.equal(f.ns({}, f.repo, []).code, 1);
  assert.equal(f.ns({}, f.repo, ['../x']).code, 1);
  assert.equal(f.ns({}, f.repo, ['a b']).code, 1);
  const r = run('bash', [NEXT, '--new-id'], { cwd: f.repo, env: f.env() });
  assert.equal(r.status, 0); assert.match(r.stdout.trim(), /^job-\d{13}-[0-9a-f]{8}$/);
  assert.equal(git(f.repo, 'status', '--porcelain').trim(), '');
});

// ---------------------------------------------------------------- tabla de estados
test('0: sin job => RUN new-job.sh', () => expectRun(fx().ns(), /^bash 01-TOOLS\/new-job\.sh job-1$/, 0));
test('0: job a medias (carpeta sin worktree, o worktree sin job.json) => STOP JOB_INCONSISTENT, nunca new-job', () => {
  const a = fx(); fs.mkdirSync(a.job, { recursive: true }); expectStop(a.ns(), 'JOB_INCONSISTENT');
  const b = fx().upTo('job'); fs.rmSync(path.join(b.job, 'job.json')); expectStop(b.ns(), 'JOB_INCONSISTENT');
});
test('0: job.json de otro id o ilegible => STOP JOB_INCONSISTENT', () => {
  const f = fx().upTo('job'); put(path.join(f.job, 'job.json'), '{no es json'); expectStop(f.ns(), 'JOB_INCONSISTENT');
});
test('1: falta input.md (o vacio) => DELEGATE @intake', () => {
  const f = fx().upTo('job'); expectDelegate(f.ns(), 'intake', 1);
  put(path.join(f.job, 'input.md'), '  \n'); expectDelegate(f.ns(), 'intake', 1);
});
test('2: falta spec.md => DELEGATE @spec-writer', () => { const f = fx().upTo('input'); const r = f.ns(); expectDelegate(r, 'spec-writer', 2); assert.match(r.first, /spec\.md,factory\/jobs\/job-1\/tasks\.md$|spec\.md/); });
for (const [name, mutate] of [
  ['sin Surface', (f) => put(path.join(f.job, 'spec.md'), SPEC().replace(/^Surface:.*\n/m, ''))],
  ['Surface invalida', (f) => put(path.join(f.job, 'spec.md'), SPEC({ surface: 'mobile' }))],
  ['sin criterios numerados', (f) => put(path.join(f.job, 'spec.md'), SPEC({ criteria: '- algo\n- otro' }))],
  ['sin Alcance', (f) => put(path.join(f.job, 'spec.md'), SPEC().replace(/Alcance:\n- src\/\*\*\n/, ''))],
  ['Alcance vacio', (f) => put(path.join(f.job, 'spec.md'), SPEC({ alcance: '' }))],
  ['sin tasks.md', (f) => fs.rmSync(path.join(f.job, 'tasks.md'))],
]) {
  test(`2: spec invalido (${name}) => DELEGATE @spec-writer`, () => { const f = fx().upTo('spec'); mutate(f); expectDelegate(f.ns(), 'spec-writer', 2); });
}
test('3: spec valido sin spec.ok => STOP HUMAN_CONFIRM_SPEC con resumen y CMD touch', () => {
  const f = fx().upTo('spec'); const r = f.ns(); expectStop(r, 'HUMAN_CONFIRM_SPEC'); assert.equal(r.state, '3');
  assert.deepEqual(r.cmd, ['touch factory/jobs/job-1/spec.ok']); assert.match(r.why.join('\n'), /Surface: none \| criterios: 2/); assert.match(r.why.join('\n'), /Alcance: src\/\*\*/);
});
test('3: spec.ok mas antiguo que spec.md (el spec cambio) => vuelve a pedir confirmacion', () => {
  const f = fx().upTo('confirmed'); expectDelegate(f.ns(), 'builder', 4);
  put(path.join(f.job, 'spec.md'), SPEC({ criteria: '1. otro' })); expectStop(f.ns(), 'HUMAN_CONFIRM_SPEC');
  f.confirm(); expectDelegate(f.ns(), 'builder', 4);
});
test('3: desactivable por job con FACTORY_REQUIRE_SPEC_OK=0 y por proyecto con require_spec_ok:false', () => {
  const f = fx().upTo('spec'); expectStop(f.ns(), 'HUMAN_CONFIRM_SPEC');
  expectDelegate(f.ns({ FACTORY_REQUIRE_SPEC_OK: '0' }), 'builder', 4);
  const g = fx({ project: { require_spec_ok: false } }).upTo('spec'); expectDelegate(g.ns(), 'builder', 4);
});
test('4: spec confirmado y worktree sin commits => DELEGATE @builder (con ruta de la worktree)', () => {
  const f = fx().upTo('confirmed'); const r = f.ns(); expectDelegate(r, 'builder', 4); assert.match(r.first, /factory\/worktrees\/job-1\/$/);
});
test('4->5: worktree con cambios sin commitear => STOP WORKTREE_DIRTY (el gate veria codigo que no se subiria)', () => {
  const f = fx().upTo('built'); write(path.join(f.wt, 'src/suelto.js'), 'x\n');
  const r = f.ns(); expectStop(r, 'WORKTREE_DIRTY'); assert.match(r.why.join('\n'), /suelto\.js/);
});
test('5: commits sin gate.md => RUN checks.sh en la worktree', () => {
  expectRun(fx().upTo('built').ns(), /^cd factory\/worktrees\/job-1 && bash 01-TOOLS\/checks\.sh job-1$/, 5);
});
test('5: gate.md sin linea COMMIT, ilegible u obsoleto => RUN checks.sh', () => {
  const f = fx().upTo('gated'); expectRun(f.ns().kind === 'RUN' ? { ...f.ns() } : f.ns(), /launch-reviewers/); // gate vigente => siguiente paso
  put(path.join(f.job, 'gate.md'), 'GATE: PASS\n'); expectRun(f.ns(), /checks\.sh/, 5);
  put(path.join(f.job, 'gate.md'), 'GATE: PASS\nCOMMIT: ' + 'a'.repeat(40) + '\n'); expectRun(f.ns(), /checks\.sh/, 5);
  put(path.join(f.job, 'gate.md'), 'quizas bien\n'); expectRun(f.ns(), /checks\.sh/, 5);
});
test('6: GATE: FAIL con rondas disponibles => DELEGATE @builder con gate.md', () => {
  const f = fx().upTo('built'); f.gate(false); const r = f.ns(); expectDelegate(r, 'builder', 6); assert.match(r.why.join(), /gate\.md/);
});
test('6: GATE: FAIL seguidos hasta max_rounds => STOP MAX_ROUNDS; tambien si ya se gastaron las rondas', () => {
  const f = fx({ project: { max_rounds: 2 } }).upTo('built');
  f.gate(false); expectDelegate(f.ns(), 'builder'); f.commit(); f.gate(false); expectStop(f.ns(), 'MAX_ROUNDS');
  const g = fx({ project: { max_rounds: 1 } }).upTo('reviewed'); g.decision('CHANGES'); g.commit(); g.gate(false);
  expectStop(g.ns(), 'MAX_ROUNDS');
});
test('6: un gate PASS reinicia la racha de FAIL', () => {
  const f = fx({ project: { max_rounds: 2 } }).upTo('built'); f.gate(false); f.commit(); f.gate(true); f.commit(); f.gate(false);
  expectDelegate(f.ns(), 'builder', 6);
});
test('7: gate PASS sin reviews => RUN launch-reviewers.sh ronda 1', () => {
  expectRun(fx().upTo('gated').ns(), /^cd factory\/worktrees\/job-1 && bash 01-TOOLS\/launch-reviewers\.sh job-1 1$/, 7);
});
test('7: reviews de otro commit => ronda nueva; ronda sin .commit o con review invalido => se repite la misma', () => {
  const f = fx().upTo('reviewed'); f.commit(); f.gate(); expectRun(f.ns(), /launch-reviewers\.sh job-1 2$/, 7);
  const g = fx().upTo('gated'); g.reviews(1, { withCommit: false }); expectRun(g.ns(), /launch-reviewers\.sh job-1 1$/, 7);
  const h = fx().upTo('gated'); h.reviews(1); put(path.join(h.job, 'round-1/review-ux.md'), 'Todo bien\n'); expectRun(h.ns(), /launch-reviewers\.sh job-1 1$/, 7);
  const i = fx().upTo('gated'); i.reviews(1); fs.rmSync(path.join(i.job, 'round-1/review-ui.md')); expectRun(i.ns(), /launch-reviewers\.sh job-1 1$/, 7);
});
test('7: una ronda mas alla de max_rounds => STOP MAX_ROUNDS', () => {
  const f = fx({ project: { max_rounds: 1 } }).upTo('reviewed'); f.commit(); f.gate(); expectStop(f.ns(), 'MAX_ROUNDS');
});
test('7: un reviewer que fallo (REVIEWER_FALLO) => STOP REVIEWER_FAILED, no se manda al builder', () => {
  const f = fx().upTo('gated'); f.reviews(1, { fallo: true }); const r = f.ns(); expectStop(r, 'REVIEWER_FAILED');
  assert.match(r.cmd[0], /launch-reviewers\.sh job-1 1$/);
});
test('8: reviews vigentes sin decision.md => DELEGATE @approver; decision anterior a los reviews => tambien', () => {
  const f = fx().upTo('reviewed'); expectDelegate(f.ns(), 'approver', 8);
  const g = fx().upTo('gated'); g.decision('APPROVE'); g.reviews(1); expectDelegate(g.ns(), 'approver', 8);
});
test('8: el DELEGATE del approver (3 campos) dice como leer el historial de la worktree', () => {
  for (const f of [fx().upTo('reviewed'), (() => { const g = fx().upTo('gated'); g.decision('APPROVE'); g.reviews(1); return g; })()]) {
    const r = f.ns(); expectDelegate(r, 'approver', 8); assert.match(r.value, /git -C factory\/worktrees\/job-1 log/);
  }
});
test('9: CHANGES => DELEGATE @builder; en la ultima ronda => STOP MAX_ROUNDS', () => {
  const f = fx().upTo('reviewed'); f.decision('CHANGES'); expectDelegate(f.ns(), 'builder', 9);
  const g = fx({ project: { max_rounds: 1 } }).upTo('reviewed'); g.decision('CHANGES'); expectStop(g.ns(), 'MAX_ROUNDS');
});
test('9: ESCALATE => STOP ESCALATED; decision ambigua => STOP DECISION_INVALID', () => {
  const f = fx().upTo('reviewed'); f.decision('ESCALATE'); expectStop(f.ns(), 'ESCALATED');
  for (const bad of ['approve', 'APPROVED', 'Parece bien', 'APPROVE o CHANGES', '']) { f.decision(bad); expectStop(f.ns(), 'DECISION_INVALID'); }
});
test('9: tras CHANGES el builder commitea => gate nuevo => ronda 2 (no se reutiliza la decision vieja)', () => {
  const f = fx().upTo('reviewed'); f.decision('CHANGES'); f.commit(); expectRun(f.ns(), /checks\.sh/, 5); f.gate();
  expectRun(f.ns(), /launch-reviewers\.sh job-1 2$/, 7); f.reviews(2); expectDelegate(f.ns(), 'approver', 8);
});
test('10: APPROVE sin human.md (o anterior a la decision) => RUN risk.sh', () => {
  const f = fx().upTo('decided'); expectRun(f.ns(), /^cd factory\/worktrees\/job-1 && bash 01-TOOLS\/risk\.sh job-1$/, 10);
  const g = fx().upTo('decided'); g.human('NEEDS_HUMAN', true); g.decision('APPROVE'); expectRun(g.ns(), /risk\.sh/, 10);
});
test('10: NEEDS_HUMAN sin resumen => DELEGATE @human-gate (no cambia la linea 1)', () => {
  const f = fx().upTo('decided'); f.human('NEEDS_HUMAN', false); const r = f.ns(); expectDelegate(r, 'human-gate', 10); assert.match(r.first, /NO cambiar la linea 1/);
});
test('10: FAST_PATH con fast_path.enabled=false, o linea 1 ambigua => STOP HUMAN_LINE_INVALID', () => {
  const f = fx().upTo('decided'); f.human('FAST_PATH', true); expectStop(f.ns(), 'HUMAN_LINE_INVALID');
  for (const bad of ['fast_path', 'FAST_PATH?', 'Aprobado', '']) { f.human(bad, true); expectStop(f.ns(), 'HUMAN_LINE_INVALID'); }
});
test('10: FAST_PATH legitimo (fast_path.enabled=true en factory/config.json) sigue adelante', () => {
  const f = fx({ config: { fast_path: { enabled: true } } }).upTo('decided'); f.human('FAST_PATH', false); expectDelegate(f.ns(), 'memory-curator', 11);
});
test('11: sin trace.md, sin linea "Brain:" o anterior a human.md => DELEGATE @memory-curator', () => {
  const f = fx().upTo('humanized'); expectDelegate(f.ns(), 'memory-curator', 11);
  put(path.join(f.job, 'trace.md'), '# trace\nsolo la orquesta\n'); expectDelegate(f.ns(), 'memory-curator', 11);
  f.trace(); f.human('NEEDS_HUMAN', true); expectDelegate(f.ns(), 'memory-curator', 11);
});
test('11b: superficie en human_review_surfaces => STOP HUMAN_REVIEW hasta review.ok (posterior a human.md)', () => {
  const f = fx({ project: { human_review_surfaces: ['page'] } }); f.newJob(); f.input(); f.spec({ surface: 'page' }); f.confirm(); f.commit(); f.gate(); f.reviews(1);
  f.decision(); f.human(); f.trace();
  const r = f.ns(); expectStop(r, 'HUMAN_REVIEW'); assert.deepEqual(r.cmd, ['touch factory/jobs/job-1/review.ok']);
  put(path.join(f.job, 'review.ok'), ''); expectRun(f.ns(), /^git push/, 12);
  f.human(); f.trace(); expectStop(f.ns(), 'HUMAN_REVIEW'); // human.md cambio despues de la revision
  const g = fx({ project: { human_review_surfaces: ['page'] } }).upTo('traced'); expectRun(g.ns(), /^git push/, 12); // Surface: none no la exige
});
test('12: todo listo sin subir => RUN git push -u origin factory/<id>; tras subir ya no', () => {
  const f = fx().upTo('traced'); expectRun(f.ns(), /^git push -u origin factory\/job-1$/, 12);
  f.push(); assert.notEqual(f.ns().state, '12');
});
test('12: si cambia HEAD tras subir, hay que volver a subir (la rama remota ya no coincide)', () => {
  const f = fx().upTo('pushed'); const r = f.ns(); assert.equal(r.state, '13');
  f.commit(); expectRun(f.ns(), /checks\.sh/, 5);
});
test('12: sin remoto origin => STOP NO_REMOTE', () => { expectStop(fx({ remote: false }).upTo('traced').ns(), 'NO_REMOTE'); });
test('13: sin gh => STOP HUMAN_CREATE_PR con el comando y la URL exactos; con pr.url => DONE', () => {
  const f = fx().upTo('pushed'); const r = f.ns(); expectStop(r, 'HUMAN_CREATE_PR');
  assert.match(r.cmd[0], /^gh pr create --draft --base main --head factory\/job-1 --title 'Spec de prueba' --body '/);
  assert.match(r.cmd.join('\n'), /compare\/main\.\.\.factory\/job-1/); assert.match(r.cmd.join('\n'), /pr\.url/);
  put(path.join(f.job, 'pr.url'), 'https://github.com/o/r/pull/9\n'); const d = f.ns(); assert.equal(d.first, 'DONE'); assert.equal(d.code, 0);
});
test('13: con gh y sin PR => RUN gh pr create --draft; con PR => DONE', () => {
  const f = fx().upTo('pushed'); const gh = fakeGh(); f.gh = gh.bin;
  const r = f.ns(); expectRun(r, /^gh pr create --draft --base main --head factory\/job-1 --title '/, 13);
  assert.equal(f.ns().first, r.first); // idempotente
  run('bash', ['-c', r.value.replace(/^gh/, gh.bin)], { cwd: f.repo }); assert.ok(gh.created());
  const d = f.ns(); assert.equal(d.first, 'DONE'); assert.match(d.why.join(), /pull\/7/);
});
test('el comando del PR no se puede romper con comillas del spec', () => {
  const f = fx().upTo('built'); put(path.join(f.job, 'spec.md'), SPEC({ title: "# Arregla 'x'; rm -rf $(whoami) `id` \"y\"" })); f.confirm(); f.gate(); f.reviews(1); f.decision(); f.human(); f.trace(); f.push();
  const r = f.ns(); expectStop(r, 'HUMAN_CREATE_PR'); assert.match(r.cmd[0], /--title 'Arregla x rm -rf whoami id y'/);
});

// ---------------------------------------------------------------- orden y fail-closed
test('orden: nunca builder sin spec.ok; nunca reviewers con gate FAIL u obsoleto; nunca push/PR sin APPROVE y human.md', () => {
  const noOk = fx().upTo('spec'); assert.notEqual(noOk.ns().kind, 'DELEGATE');
  const fail = fx().upTo('built'); fail.gate(false); assert.doesNotMatch(fail.ns().first, /launch-reviewers/);
  const stale = fx().upTo('gated'); stale.commit(); assert.doesNotMatch(stale.ns().first, /launch-reviewers/);
  for (const dec of [null, 'CHANGES', 'ESCALATE', 'basura']) {
    const f = fx().upTo('reviewed'); if (dec) f.decision(dec); f.human(); f.trace();
    const r = f.ns(); assert.doesNotMatch(r.first, /git push|gh pr create/, `decision=${dec}\n${r.raw}`);
  }
  const noHuman = fx().upTo('decided'); f2: { const r = noHuman.ns(); assert.doesNotMatch(r.first, /git push|gh pr create/); }
});
test('obsolescencia: cambiar HEAD invalida gate y reviews, y arrastra decision y human (recorrido entero otra vez)', () => {
  const f = fx().upTo('pushed'); assert.equal(f.ns().state, '13');
  f.commit(); expectRun(f.ns(), /checks\.sh/, 5); f.gate();
  expectRun(f.ns(), /launch-reviewers\.sh job-1 2$/, 7); f.reviews(2);
  expectDelegate(f.ns(), 'approver', 8); f.decision(); expectRun(f.ns(), /risk\.sh/, 10);
});
test('politica invalida (project.json roto o con valores ambiguos) => STOP PROJECT_INVALID', () => {
  for (const bad of ['{no', JSON.stringify({ max_rounds: 0 }), JSON.stringify({ max_rounds: '3' }), JSON.stringify({ require_spec_ok: 'no' }),
    JSON.stringify({ brain: { default: ['../../etc/passwd'] } }), JSON.stringify({ brain: { default: ['/etc/passwd'] } }), JSON.stringify({ human_review_surfaces: 'page' })]) {
    expectStop(fx({ project: bad }).ns(), 'PROJECT_INVALID');
  }
});

// ---------------------------------------------------------------- Brain -> agentes
test('READ: cada DELEGATE lista las paginas del Brain que existen (default + las del agente)', () => {
  const f = fx({ project: { brain: { default: ['02-DOCS/wiki/index.md', 'no/existe.md'], agents: { 'spec-writer': ['02-DOCS/wiki/sdd/decisions.md'] } } } }).upTo('input');
  assert.equal(f.ns().read, '02-DOCS/wiki/index.md, 02-DOCS/wiki/sdd/decisions.md');
  const g = fx({ project: { brain: { default: [] } } }).upTo('input'); assert.equal(g.ns().read, undefined);
  const h = fx().upTo('job'); assert.equal(h.ns().read, '02-DOCS/wiki/index.md'); // sin project.json: indice del Brain
});
test('la politica por proyecto cambia el flujo: max_rounds y require_spec_ok de factory/project.json mandan sobre config.json', () => {
  const f = fx({ project: { max_rounds: 1 }, config: { max_rounds: 5 } }).upTo('reviewed'); f.decision('CHANGES'); expectStop(f.ns(), 'MAX_ROUNDS');
  const g = fx({ config: { max_rounds: 1 } }).upTo('reviewed'); g.decision('CHANGES'); expectStop(g.ns(), 'MAX_ROUNDS'); // sin project.json: config.json
  const h = fx({ config: { max_rounds: 5 } }).upTo('reviewed'); h.decision('CHANGES'); expectDelegate(h.ns(), 'builder', 9);
});

// ---------------------------------------------------------------- idempotencia, solo lectura, ubicacion
const snapshot = (f) => {
  const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name); return e.isDirectory() ? walk(p) : [`${p} ${fs.statSync(p).mtimeMs} ${crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')}`];
  }) : [];
  return [walk(path.join(f.repo, 'factory')).join('\n'), git(f.repo, 'status', '--porcelain', '--ignored'), git(f.repo, 'for-each-ref'), (fs.existsSync(f.wt) ? git(f.wt, 'status', '--porcelain', '--ignored') : '')].join('\n--\n');
};
test('idempotente y de solo lectura en todos los estados (el arbol no cambia)', () => {
  for (const st of ['job', 'input', 'spec', 'confirmed', 'built', 'gated', 'reviewed', 'decided', 'humanized', 'traced', 'pushed']) {
    const f = fx().upTo(st); const before = snapshot(f); const a = f.ns(); const b = f.ns();
    assert.equal(a.raw, b.raw, `no idempotente en ${st}`); assert.equal(snapshot(f), before, `escribio algo en ${st}`);
  }
  const z = fx(); const before = snapshot(z); z.ns(); assert.equal(snapshot(z), before);
});
test('da lo mismo desde el checkout principal que desde la worktree', () => {
  const f = fx().upTo('gated'); const a = f.ns(); const b = f.ns({}, f.wt); assert.equal(b.raw, a.raw);
});

// ---------------------------------------------------------------- recorrido completo con scripts reales
test('E2E: el bucle next-step -> ejecutar -> repetir lleva un job de la nada a DONE con los scripts reales', { timeout: 300000 }, () => {
  const f = fx({ tools: true }); const gh = fakeGh(); f.gh = gh.bin;
  // el humano confirma el spec; el builder escribe codigo en alcance
  const { actions, final } = drive(f, { humans: { HUMAN_CONFIRM_SPEC: () => f.confirm() } });
  const seq = actions.map((a) => a.first.split(/[ |:@]+/).filter(Boolean).slice(0, 3).join(' '));
  assert.equal(final.first, 'DONE', actions.map((a) => a.first).join('\n'));
  const kinds = actions.map((a) => a.first);
  const order = [/new-job\.sh/, /@intake/, /@spec-writer/, /HUMAN_CONFIRM_SPEC/, /@builder/, /checks\.sh/, /launch-reviewers\.sh job-1 1/, /@approver/, /risk\.sh/, /@human-gate/, /@memory-curator/, /git push/, /gh pr create --draft/, /^DONE/];
  let at = -1; for (const re of order) { const i = kinds.findIndex((k, n) => n > at && re.test(k)); assert.ok(i > at, `falta o desordenado ${re}\n${kinds.join('\n')}`); at = i; }
  assert.ok(gh.created(), 'no se creo el PR en borrador');
  // los artefactos de evidencia los escribieron los scripts, con el commit atado
  assert.match(fs.readFileSync(path.join(f.job, 'gate.md'), 'utf8'), new RegExp(`^GATE: PASS\\nCOMMIT: ${f.head()}\\nGATE_FAIL_STREAK: 0\\n`));
  assert.equal(fs.readFileSync(path.join(f.job, 'round-1/.commit'), 'utf8').trim(), f.head());
  assert.match(fs.readFileSync(path.join(f.job, 'human.md'), 'utf8'), /^NEEDS_HUMAN/);
});
test('E2E: CHANGES => el builder corrige, gate nuevo, ronda 2, y el job termina', { timeout: 300000 }, () => {
  const f = fx({ tools: true }); const gh = fakeGh(); f.gh = gh.bin; let n = 0;
  const { actions, final } = drive(f, { humans: { HUMAN_CONFIRM_SPEC: () => f.confirm() }, agents: { approver: () => f.decision(++n === 1 ? 'CHANGES' : 'APPROVE') } });
  assert.equal(final.first, 'DONE', actions.map((a) => a.first).join('\n'));
  assert.ok(actions.some((a) => /launch-reviewers\.sh job-1 2$/.test(a.first)), 'no hubo ronda 2');
  assert.ok(fs.existsSync(path.join(f.job, 'round-2/.commit')));
});
