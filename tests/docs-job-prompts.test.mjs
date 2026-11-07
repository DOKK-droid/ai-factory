// Prompts, permisos y plantillas de la rama 6 que no dependen del parche: quien puede escribir el spec de un job docs, que dicen discovery y
// /factory-init, y el paso opcional de CI (desactivado por defecto) que protege la base documental en el PR.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, git, run } from './helpers.mjs';
import { classifyBash, classifyTool } from '../factory/scripts/command-guard.mjs';

const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
function perms(agent) {
  const out = { edit: [], bash: [] }; let sec = null;
  for (const l of read(`.opencode/agent/${agent}.md`).split('\n---\n')[0].split('\n')) {
    let m = l.match(/^  (\w+):\s*(\w+)?$/); if (m) { sec = m[1]; continue; }
    m = l.match(/^    "([^"]+)":\s*(\w+)$/); if (m && (sec === 'edit' || sec === 'bash')) out[sec].push([m[1], m[2]]);
  }
  return out;
}
const rx = (pat) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 's');
const decide = (rules, value, fallback = 'ask') => rules.reduce((acc, [p, a]) => (rx(p).test(value) ? a : acc), fallback);

test('system-analyst escribe spec.md y tasks.md de un job y nada mas del job; no los escribe desde dentro de una worktree', () => {
  const e = perms('system-analyst').edit;
  for (const f of ['factory/jobs/j/spec.md', '/r/factory/jobs/j/spec.md', '/r/factory/jobs/j/tasks.md']) { assert.equal(decide(e, f, 'deny'), 'allow', f); assert.equal(classifyTool('write', { filePath: f }).blocked, false, f); }
  for (const f of ['input.md', 'spec.ok', 'gate.md', 'decision.md', 'human.md', 'review.ok', 'brain.ok', 'brain-request.md', 'implementa.lock', 'job.json', 'pr.url', 'trace.md', 'round-1/review-code.md', 'round-1/.commit'])
    assert.notEqual(decide(e, `/r/factory/jobs/j/${f}`, 'deny'), 'allow', f);
  assert.equal(decide(e, '/r/factory/worktrees/j/factory/jobs/j/spec.md', 'deny'), 'deny', 'ni la copia de un job dentro de una worktree');
  assert.equal(decide(e, '/r/factory/worktrees/j/02-DOCS/wiki/project/01-requisitos.md', 'deny'), 'allow');
  for (const f of ['/r/factory/worktrees/j/02-DOCS/wiki/project/03-dominio.md', '/r/factory/worktrees/j/src/a.js', '/r/factory/config.json']) assert.equal(decide(e, f, 'deny'), 'deny', f);
});
test('los demas agentes de documentacion siguen sin poder escribir el spec ni las marcas del job', () => {
  for (const a of ['domain-modeler', 'architect', 'deployment-planner', 'discovery', 'consistency-auditor']) for (const f of ['spec.md', 'tasks.md', 'spec.ok', 'gate.md']) assert.notEqual(decide(perms(a).edit, `/r/factory/jobs/j/${f}`, 'deny'), 'allow', `${a} ${f}`);
});
test('system-analyst puede mirar la base y los jobs (impact, state, project-status) pero no generar la trazabilidad ni aprobar', () => {
  const b = perms('system-analyst').bash;
  for (const c of ['node factory/scripts/project-lint.mjs check --root factory/worktrees/j', 'node factory/scripts/project-lint.mjs impact REQ-F-1 --root factory/worktrees/j', 'node factory/scripts/project-lint.mjs state --root factory/worktrees/j', 'node factory/scripts/project-status.mjs --json']) { assert.equal(decide(b, c, 'deny'), 'allow', c); assert.equal(classifyBash(c).blocked, false, c); }
  for (const c of ['node factory/scripts/project-lint.mjs trace --write', 'node factory/scripts/project-lint.mjs approve 01-requisitos', 'node factory/scripts/project-lint.mjs impact x && node factory/scripts/project-lint.mjs approve 01-requisitos', 'git commit -m x', 'rm -rf factory']) assert.equal(decide(b, c, 'deny'), 'deny', c);
  assert.equal(classifyBash('node factory/scripts/project-lint.mjs impact x && node factory/scripts/project-lint.mjs approve 01-requisitos --bootstrap').blocked, true);
});
test('los prompts: system-analyst explica el spec docs; los dueños saben que no inventan; architect registra el ADR; todos citan la plantilla que existe', () => {
  const sa = read('.opencode/agent/system-analyst.md');
  assert.match(sa, /kind: docs/); assert.match(sa, /spec-docs-template\.md/); assert.match(sa, /Documentos afectados/); assert.match(sa, /project-status\.mjs/); assert.match(sa, /tú no lo creas|no lo creas/);
  assert.ok(fs.existsSync(path.join(REPO, '02-DOCS/wiki/sdd/spec-docs-template.md')));
  for (const a of ['domain-modeler', 'architect', 'deployment-planner']) { const t = read(`.opencode/agent/${a}.md`); assert.match(t, /En un job de documentación/, a); assert.match(t, /no inventes/i, a); assert.match(t, /nunca escribes `estado: aprobado`/, a); }
  assert.match(read('.opencode/agent/architect.md'), /ADR-NNN/); assert.match(read('.opencode/agent/architect.md'), /Estado: Aprobado/);
});
test('discovery y /factory-init: el job init-* es un job de documentacion y la aprobacion se hace desde su worktree', () => {
  const d = read('.opencode/agent/discovery.md'), c = read('.opencode/command/factory-init.md'), o = read('docs/ONBOARDING.md');
  for (const t of [d, c, o]) { assert.match(t, /kind: docs/); assert.match(t, /\/factory <(JOB|job)>/); }
  assert.match(d, /HUMAN_CONFIRM_PROJECT/); assert.match(d, /DOCS_NEED_HUMAN/);
  for (const t of [d, o]) assert.match(t, /cd factory\/worktrees\/<(JOB|job)> && node factory\/scripts\/project-lint\.mjs approve/);
  assert.doesNotMatch(d, /^node factory\/scripts\/project-lint\.mjs approve <documentos>/m, 'ya no se aprueba "a pelo" desde el checkout principal');
  assert.match(read('.opencode/command/factory.md'), /kind: docs/);
});

// ---------------------------------------------------------------- CI opcional
const CI = read('factory/templates/project-ci.yml');
test('CI: el paso que protege la base documental esta en la plantilla pero DESACTIVADO (todo comentado)', () => {
  const active = CI.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(active, /docs-solo-desde-jobs/); assert.doesNotMatch(active, /02-DOCS/);
  assert.match(CI, /^#  docs-solo-desde-jobs:$/m); assert.match(CI, /OPCIONAL, desactivado por defecto/);
  assert.match(active, /^jobs:\n  ci:/m, 'el job ci que exige el ruleset sigue igual');
});
test('CI: el script del paso opcional falla un PR que toca la base documental desde una rama que no es factory/*, y deja pasar el resto', () => {
  const lines = CI.split('\n'); const i = lines.findIndex((l) => /^#\s+run: \|$/.test(l)); assert.ok(i > 0);
  const body = []; for (let j = i + 1; j < lines.length && /^#\s{10}/.test(lines[j]); j++) body.push(lines[j].replace(/^#\s{10}/, ''));
  const script = body.join('\n');
  const mk = (head, files) => {
    const origin = tmp('af-ci-o-'); git(origin, 'init', '-q', '--bare', '-b', 'main');
    const d = tmp('af-ci-'); git(d, 'init', '-q', '-b', 'main'); git(d, 'config', 'user.email', 't@t.t'); git(d, 'config', 'user.name', 't'); git(d, 'config', 'commit.gpgsign', 'false');
    write(path.join(d, 'README.md'), 'x\n'); write(path.join(d, '02-DOCS/wiki/project/00-vision.md'), 'v\n'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base'); git(d, 'remote', 'add', 'origin', origin); git(d, 'push', '-q', 'origin', 'main');
    git(d, 'switch', '-q', '-c', head); for (const f of files) write(path.join(d, f), 'cambio\n'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'cambio');
    const sh = script.replaceAll('${{ github.base_ref }}', 'main').replaceAll('${{ github.head_ref }}', head);
    return run('bash', ['-e', '-c', sh], { cwd: d, encoding: 'utf8' });
  };
  const bad = mk('feat/requisito', ['02-DOCS/wiki/project/00-vision.md']); assert.equal(bad.status, 1, bad.stdout + bad.stderr); assert.match(bad.stdout, /::error::/); assert.match(bad.stdout, /feat\/requisito/);
  assert.equal(mk('factory/job-1', ['02-DOCS/wiki/project/00-vision.md']).status, 0, 'un job factory/* si puede');
  assert.equal(mk('feat/codigo', ['src/a.js']).status, 0, 'una rama normal que no toca la base');
  assert.equal(mk('feat/docs-otra', ['02-DOCS/wiki/context.md']).status, 0, 'otras paginas del Brain no cuentan');
});
