import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, write, run, makeRepo, commitAll } from './helpers.mjs';

const RISK = path.join(REPO, '01-TOOLS/risk.sh');

/** Crea repo + job. `mutate` ajusta el repo/job antes de ejecutar risk.sh. */
function scenario({ fastPath = true, mutate = () => {}, changes = 'good' } = {}) {
  const repo = makeRepo();
  if (changes === 'good') {
    write(path.join(repo, 'src/feature.js'), 'export const f = () => 42;\n');
    write(path.join(repo, 'tests/feature.test.js'), "test('f', () => { expect(f()).toBe(42); });\n");
    commitAll(repo);
  }
  const jobs = path.join(repo, 'jobs'); const job = path.join(jobs, 'j1');
  for (const r of ['security', 'ux', 'ui', 'code']) write(path.join(job, `round-1/review-${r}.md`), 'VERDICT: PASS\nSCORE: 0.95\n');
  write(path.join(job, 'decision.md'), 'APPROVE\n');
  write(path.join(job, 'gate.md'), 'GATE: PASS\n');
  write(path.join(job, 'spec.md'), '# Spec\nSurface: none\n1. criterio\n');
  const cfg = path.join(repo, 'cfg.json');
  write(cfg, JSON.stringify({ max_diff_lines: 400, base_branch: 'main', fast_path: { enabled: fastPath, min_score: 0.85 } }));
  mutate({ repo, job, cfg });
  const r = run('bash', [RISK, 'j1'], { cwd: repo, env: { ...process.env, FACTORY_JOBS_DIR: jobs, FACTORY_CONFIG: cfg } });
  const human = fs.readFileSync(path.join(job, 'human.md'), 'utf8');
  return { status: r.status, first: human.split('\n')[0], human };
}
const expectHuman = (s, risk) => { assert.equal(s.first, 'NEEDS_HUMAN'); if (risk) assert.match(s.human, new RegExp(risk)); };

test('camino feliz + fast_path ON => FAST_PATH', () => assert.equal(scenario().first, 'FAST_PATH'));
test('fast_path OFF => siempre NEEDS_HUMAN', () => expectHuman(scenario({ fastPath: false })));
test('VERDICT: CHANGES (formato real) => NEEDS_HUMAN (bug original)', () =>
  expectHuman(scenario({ mutate: ({ job }) => write(path.join(job, 'round-1/review-security.md'), 'VERDICT: CHANGES\nSCORE: 0.95\n') }), 'reviewer_changes_security'));
test('sin decision.md => NEEDS_HUMAN', () =>
  expectHuman(scenario({ mutate: ({ job }) => fs.rmSync(path.join(job, 'decision.md')) }), 'approver_no_aprueba'));
test('decision CHANGES/ESCALATE => NEEDS_HUMAN', () =>
  expectHuman(scenario({ mutate: ({ job }) => write(path.join(job, 'decision.md'), 'ESCALATE\n') }), 'approver_no_aprueba'));
test('gate no pasa o ausente => NEEDS_HUMAN', () => {
  expectHuman(scenario({ mutate: ({ job }) => write(path.join(job, 'gate.md'), 'GATE: FAIL\n') }), 'gate_no_pasa');
  expectHuman(scenario({ mutate: ({ job }) => fs.rmSync(path.join(job, 'gate.md')) }), 'gate_no_pasa');
});
test('score bajo, ausente o invalido => NEEDS_HUMAN', () => {
  expectHuman(scenario({ mutate: ({ job }) => write(path.join(job, 'round-1/review-ui.md'), 'VERDICT: PASS\nSCORE: 0.5\n') }), 'score_bajo_ui');
  expectHuman(scenario({ mutate: ({ job }) => write(path.join(job, 'round-1/review-ui.md'), 'VERDICT: PASS\n') }), 'score_invalido_ui');
});
test('review faltante o veredicto invalido => NEEDS_HUMAN', () => {
  expectHuman(scenario({ mutate: ({ job }) => fs.rmSync(path.join(job, 'round-1/review-code.md')) }), 'review_faltante_code');
  expectHuman(scenario({ mutate: ({ job }) => write(path.join(job, 'round-1/review-code.md'), 'LGTM\nSCORE: 0.9\n') }), 'verdict_invalido_code');
});
test('usa el ULTIMO round (round-1 CHANGES, round-2 PASS => FAST_PATH)', () =>
  assert.equal(scenario({ mutate: ({ job }) => {
    write(path.join(job, 'round-1/review-code.md'), 'VERDICT: CHANGES\nSCORE: 0.4\n');
    for (const r of ['security', 'ux', 'ui', 'code']) write(path.join(job, `round-2/review-${r}.md`), 'VERDICT: PASS\nSCORE: 0.9\n');
  } }).first, 'FAST_PATH'));
test('el ultimo round manda tambien si es el malo', () =>
  expectHuman(scenario({ mutate: ({ job }) => {
    for (const r of ['security', 'ux', 'ui', 'code']) write(path.join(job, `round-2/review-${r}.md`), 'VERDICT: PASS\nSCORE: 0.9\n');
    write(path.join(job, 'round-2/review-code.md'), 'VERDICT: CHANGES\nSCORE: 0.9\n');
  } }), 'reviewer_changes_code'));
test('n/a con Surface: page => NEEDS_HUMAN', () =>
  expectHuman(scenario({ mutate: ({ job }) => {
    write(path.join(job, 'spec.md'), 'Surface: page\n1. x\n');
    write(path.join(job, 'round-1/review-ui.md'), 'VERDICT: PASS (n/a)\nSCORE: 0.9\n');
  } }), 'na_con_superficie_ui'));
test('rutas sensibles (auth, migraciones, workflows) => NEEDS_HUMAN', () => {
  for (const f of ['src/auth/login.js', 'db/migrations/001.sql', '.github/workflows/ci.yml'])
    expectHuman(scenario({ mutate: ({ repo }) => { write(path.join(repo, f), 'x\n'); commitAll(repo, 'sens'); } }), 'rutas_sensibles');
});
test('manifiestos de dependencias modificados => NEEDS_HUMAN', () =>
  expectHuman(scenario({ mutate: ({ repo }) => { write(path.join(repo, 'package.json'), '{"dependencies":{"x":"1.0.0"}}\n'); commitAll(repo, 'dep'); } }), 'dependencias_modificadas'));
test('cambios de codigo sin tests en el diff => NEEDS_HUMAN', () =>
  expectHuman(scenario({ changes: 'code-only', mutate: ({ repo }) => { write(path.join(repo, 'src/x.js'), 'export const x = 1;\n'); commitAll(repo, 'x'); } }), 'sin_tests_en_el_diff'));
test('test existente debilitado (lineas borradas) => NEEDS_HUMAN', () =>
  expectHuman(scenario({ mutate: ({ repo }) => { write(path.join(repo, 'tests/app.test.js'), "test('a', () => {});\n"); commitAll(repo, 'weaken'); } }), 'tests_existentes_modificados'));
test('assert trivial o test saltado => NEEDS_HUMAN', () => {
  expectHuman(scenario({ mutate: ({ repo }) => { write(path.join(repo, 'tests/new.test.js'), "test('t', () => { expect(true).toBe(true); });\n"); commitAll(repo, 'triv'); } }), 'test_trivial_o_skip');
  expectHuman(scenario({ mutate: ({ repo }) => { write(path.join(repo, 'tests/new2.test.js'), "test.skip('t', () => {});\n"); commitAll(repo, 'skip'); } }), 'test_trivial_o_skip');
});
test('diff mayor que max_diff_lines => NEEDS_HUMAN', () =>
  expectHuman(scenario({ mutate: ({ repo }) => { write(path.join(repo, 'src/big.js'), 'x\n'.repeat(500)); commitAll(repo, 'big'); } }), 'diff_excede_limite'));
test('base inexistente => NEEDS_HUMAN (falla cerrado)', () =>
  expectHuman(scenario({ mutate: ({ cfg }) => write(cfg, JSON.stringify({ base_branch: 'nope', fast_path: { enabled: true, min_score: 0.85 } })) }), 'diff_no_disponible'));
test('config ilegible => fast_path desactivado => NEEDS_HUMAN', () =>
  expectHuman(scenario({ mutate: ({ cfg }) => write(cfg, '{no json') })));
