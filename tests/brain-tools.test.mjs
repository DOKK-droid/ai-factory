// Herramientas del Brain en el PR: commit-brain.sh, factory_commit_fresh (lib.sh), scope-check, risk.sh y permisos del curator.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, git, run, makeRepo, commitAll } from './helpers.mjs';
import { fx, COMMIT_BRAIN } from './ns-fixture.mjs';
import { CURATOR_PATHS, checkScope, parseScope } from '../factory/scripts/scope-check.mjs';
import { PROTECTED_PATHS } from '../factory/scripts/command-guard.mjs';

const LIB = path.join(REPO, '01-TOOLS/lib.sh');
const fresh = (cwd, sha, head = 'HEAD') => run('bash', ['-c', `source "${LIB}"; factory_commit_fresh "$1" "$2" .`, 'x', sha, head], { cwd }).status === 0;
const cb = (f, cwd = f.wt) => run('bash', [COMMIT_BRAIN, f.id], { cwd, env: f.env() });

test('la lista de paginas del curator es la misma en lib.sh y en scope-check.mjs', () => {
  const out = run('bash', ['-c', `source "${LIB}"; printf '%s\\n' "\${FACTORY_CURATOR_PATHS[@]}"`]).stdout.trim().split('\n');
  assert.deepEqual(out, CURATOR_PATHS);
});

// ---------------------------------------------------------------- factory_commit_fresh
test('factory_commit_fresh: mismo commit y ancestro con solo Brain => vigente; codigo, mezcla o Brain ajeno => obsoleto', () => {
  const repo = makeRepo({ '02-DOCS/wiki/index.md': 'i\n', '02-DOCS/wiki/sdd/constitution.md': 'c\n' }); const base = git(repo, 'rev-parse', 'HEAD').trim();
  assert.ok(fresh(repo, base)); assert.ok(fresh(repo, base, 'HEAD'));
  write(path.join(repo, '02-DOCS/wiki/jobs/j.md'), 'x\n'); write(path.join(repo, '02-DOCS/wiki/index.md'), 'i2\n'); commitAll(repo, 'brain');
  assert.ok(fresh(repo, base), 'un commit solo de paginas del curator no invalida');
  write(path.join(repo, '02-DOCS/wiki/sdd/constitution.md'), 'c2\n'); commitAll(repo, 'brain ajeno'); assert.equal(fresh(repo, base), false, 'la constitucion no es del curator');
  const b2 = git(repo, 'rev-parse', 'HEAD').trim(); write(path.join(repo, 'src/app.js'), 'export const a = 2;\n'); write(path.join(repo, '02-DOCS/wiki/jobs/j.md'), 'y\n'); commitAll(repo, 'mezcla');
  assert.equal(fresh(repo, b2), false, 'codigo + brain invalida');
});
test('factory_commit_fresh: sha vacio, inexistente o que no es ancestro => obsoleto (fail-closed)', () => {
  const repo = makeRepo(); const head = git(repo, 'rev-parse', 'HEAD').trim();
  assert.equal(fresh(repo, ''), false); assert.equal(fresh(repo, 'a'.repeat(40)), false); assert.equal(fresh(repo, 'no-es-sha'), false);
  git(repo, 'checkout', '-q', '-b', 'otra'); write(path.join(repo, 'src/o.js'), 'x\n'); commitAll(repo, 'o'); const otra = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', 'feat'); assert.equal(fresh(repo, otra), false, 'commit de otra rama'); assert.ok(fresh(repo, head));
});

test('factory_commit_fresh: un commit de OTRA historia que solo difiere en el Brain tampoco vale (exige ser ancestro)', () => {
  const repo = makeRepo({ '02-DOCS/wiki/index.md': 'i\n' }); git(repo, 'checkout', '-q', '-b', 'paralela');
  write(path.join(repo, '02-DOCS/wiki/index.md'), 'distinto\n'); commitAll(repo, 'solo brain en otra rama'); const otra = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', 'feat'); write(path.join(repo, '02-DOCS/wiki/jobs/j.md'), 'x\n'); commitAll(repo, 'brain aqui');
  assert.equal(fresh(repo, otra), false, 'no es ancestro de HEAD: no se da por vigente aunque el codigo coincida');
});

// ---------------------------------------------------------------- commit-brain.sh
test('commit-brain: commitea solo las paginas del curator, con mensaje docs(brain) y sin tocar el resto', () => {
  const f = fx().upTo('built'); write(path.join(f.wt, '02-DOCS/wiki/jobs/job-1.md'), '# j\n'); write(path.join(f.wt, '02-DOCS/wiki/index.md'), 'nuevo indice\n');
  const r = cb(f); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /OK commit [0-9a-f]+: /);
  assert.equal(git(f.wt, 'log', '-1', '--format=%s').trim(), 'docs(brain): documentacion del job job-1');
  assert.deepEqual(git(f.wt, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort(), ['02-DOCS/wiki/index.md', '02-DOCS/wiki/jobs/job-1.md']);
  assert.equal(git(f.wt, 'status', '--porcelain').trim(), '');
});
test('commit-brain: nada que commitear => 0; rama distinta, job-id invalido o cambios ajenos => 1 y no commitea', () => {
  const f = fx().upTo('built'); assert.equal(cb(f).status, 0); assert.match(cb(f).stdout, /Nada que commitear/);
  write(path.join(f.wt, '02-DOCS/wiki/jobs/job-1.md'), 'x\n'); write(path.join(f.wt, 'src/ajeno.js'), 'x\n');
  const bad = cb(f); assert.equal(bad.status, 1); assert.match(bad.stderr, /src\/ajeno\.js/); assert.equal(git(f.wt, 'log', '-1', '--format=%s').trim(), 'trabajo');
  assert.equal(git(f.wt, 'diff', '--cached', '--name-only').trim(), '', 'no dejo nada en el indice');
  assert.equal(run('bash', [COMMIT_BRAIN, 'otro-job'], { cwd: f.wt }).status, 1);   // la worktree no es de ese job
  assert.equal(run('bash', [COMMIT_BRAIN, '../x'], { cwd: f.wt }).status, 1);
  assert.equal(run('bash', [COMMIT_BRAIN, f.id], { cwd: tmp('af-nogit-') }).status, 1);
});
test('commit-brain: un archivo con nombre parecido (jobs-x.md, index.md.bak) no cuela', () => {
  const f = fx().upTo('built'); for (const rel of ['02-DOCS/wiki/jobs-x.md', '02-DOCS/wiki/index.md.bak']) {
    write(path.join(f.wt, rel), 'x\n'); assert.equal(cb(f).status, 1, rel); fs.rmSync(path.join(f.wt, rel));
  }
});

// ---------------------------------------------------------------- scope-check y risk.sh
test('scope-check: las paginas del curator nunca estan fuera de alcance; el resto del Brain si; "## Alcance" tambien se parsea', () => {
  const g = ['src/**'];
  const r = checkScope(g, [{ status: 'A', path: '02-DOCS/wiki/jobs/j.md' }, { status: 'M', path: '02-DOCS/wiki/index.md' }, { status: 'M', path: '02-DOCS/wiki/sdd/decisions.md' },
    { status: 'M', path: '02-DOCS/wiki/sdd/constitution.md' }, { status: 'A', path: '02-DOCS/wiki/jobs-x.md' }]);
  assert.deepEqual(r.out, ['02-DOCS/wiki/sdd/constitution.md', '02-DOCS/wiki/jobs-x.md']);
  assert.deepEqual(parseScope('## Alcance\n- src/a.js\n\n## Otro\n').globs, ['src/a.js']); assert.deepEqual(parseScope('Alcance:\n- src/b.js\n').globs, ['src/b.js']);
});
test('el gate (checks.sh) no marca el Brain del curator como fuera de alcance', () => {
  const f = fx({ tools: true }).upTo('built'); write(path.join(f.wt, '02-DOCS/wiki/jobs/job-1.md'), '# j\n'); write(path.join(f.wt, '02-DOCS/wiki/index.md'), 'i\n');
  const r = run('bash', [path.join(REPO, '01-TOOLS/checks.sh'), f.id], { cwd: f.wt, env: f.env({ FACTORY_TEST_CMD: 'true' }) });
  assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /alcance: OK/);
});
test('risk.sh: tras el commit del Brain el gate y los reviews siguen vigentes y la documentacion no cuenta como diff de codigo', () => {
  const f = fx({ tools: true, config: { max_diff_lines: 5, fast_path: { enabled: true, min_score: 0.5 } } }).upTo('built'); f.gate(); f.reviews(1); f.decision();
  write(path.join(f.wt, 'src/feature.js'), 'export const v = 1;\n'); git(f.wt, 'add', '-A'); git(f.wt, 'commit', '-qm', 'x'); f.gate(); f.reviews(1); f.decision();
  write(path.join(f.wt, '02-DOCS/wiki/jobs/job-1.md'), Array.from({ length: 50 }, (_, i) => `linea ${i}`).join('\n') + '\n'); f.commitBrain();
  const r = run('bash', [path.join(REPO, '01-TOOLS/risk.sh'), f.id], { cwd: f.wt, env: f.env({ FACTORY_CONFIG: path.join(f.repo, 'factory/config.json'), FACTORY_BASE: 'main' }) });
  const human = fs.readFileSync(path.join(f.job, 'human.md'), 'utf8');
  assert.doesNotMatch(human, /gate_obsoleto|reviews_obsoletas|diff_excede_limite/, human);
});
test('risk.sh: un commit de codigo despues del gate sigue siendo gate_obsoleto', () => {
  const f = fx({ tools: true }).upTo('reviewed'); f.commit('src/mas.js', 'export const m = 1;\n');
  run('bash', [path.join(REPO, '01-TOOLS/risk.sh'), f.id], { cwd: f.wt, env: f.env({ FACTORY_BASE: 'main' }) });
  assert.match(fs.readFileSync(path.join(f.job, 'human.md'), 'utf8'), /gate_obsoleto/);
});

// ---------------------------------------------------------------- permisos
const agent = (n) => fs.readFileSync(path.join(REPO, '.opencode/agent', n + '.md'), 'utf8').split('\n---\n')[0];
test('memory-curator solo puede escribir las paginas del curator y trace.md (no todo el Brain)', () => {
  const allow = [...agent('memory-curator').matchAll(/^\s+"([^"]+)": allow$/gm)].map((m) => m[1]).filter((p) => p.includes('factory/jobs') || p.includes('02-DOCS'));
  const rx = (pat) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const can = (f) => allow.some((p) => rx(p).test(f));
  for (const f of ['/w/02-DOCS/wiki/jobs/j.md', '/w/02-DOCS/wiki/index.md', '/w/02-DOCS/wiki/sdd/decisions.md', '/w/factory/jobs/j/trace.md']) assert.ok(can(f), f);
  for (const f of ['/w/02-DOCS/wiki/sdd/constitution.md', '/w/02-DOCS/wiki/harness/decisions.md', '/w/src/a.js', '/w/factory/jobs/j/gate.md', '/w/factory/jobs/j/spec.md']) assert.equal(can(f), false, f);
  for (const c of CURATOR_PATHS) assert.ok(c.startsWith('02-DOCS/wiki/'));
});
test('commit-brain.sh, spec-lint.mjs y next-step.sh estan protegidos; el builder no puede editarlos', () => {
  assert.ok(PROTECTED_PATHS.includes('01-TOOLS/commit-brain.sh')); assert.ok(PROTECTED_PATHS.some((p) => 'factory/scripts/spec-lint.mjs'.startsWith(p)));
  assert.match(agent('builder'), /"\*01-TOOLS\/commit-brain\.sh": deny/);
});
