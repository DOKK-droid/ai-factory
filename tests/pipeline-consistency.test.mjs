// Consistencia entre agentes, guard y scripts: el pipeline no puede exigir algo que otra capa prohibe.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyBash, classifyTool, PROTECTED_PATHS } from '../factory/scripts/command-guard.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = ['orchestrator', 'intake', 'spec-writer', 'builder', 'reviewer-security', 'reviewer-ux', 'reviewer-ui', 'reviewer-code', 'approver', 'human-gate', 'memory-curator'];

/** Parser minimo del frontmatter: permission.{edit,bash} -> [[patron, accion]] en orden. */
function perms(agent) {
  const txt = fs.readFileSync(path.join(ROOT, '.opencode/agent', agent + '.md'), 'utf8');
  const fm = txt.split('\n---\n')[0].split('\n');
  const out = { edit: [], bash: [], flat: {} };
  let sec = null;
  for (const l of fm) {
    let m = l.match(/^  (\w+):\s*(\w+)?$/);
    if (m) { sec = m[1]; if (m[2]) out.flat[sec] = m[2]; continue; }
    m = l.match(/^    "([^"]+)":\s*(\w+)$/);
    if (m && (sec === 'edit' || sec === 'bash')) out[sec].push([m[1], m[2]]);
  }
  return out;
}
const rx = (pat) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 's');
/** OpenCode: gana la ULTIMA regla que calza. */
const decide = (rules, value, fallback = 'ask') => rules.reduce((acc, [p, a]) => (rx(p).test(value) ? a : acc), fallback);

test('todos los patrones de edit empiezan por * (rutas absolutas de la worktree)', () => {
  for (const a of AGENTS) for (const [p] of perms(a).edit) assert.ok(p.startsWith('*'), `${a}: "${p}"`);
});

test('builder: cada PROTECTED_PATH esta denegado (relativa y absoluta)', () => {
  const rules = perms('builder').edit;
  for (const p of PROTECTED_PATHS) {
    const sample = p.endsWith('/') ? p + 'x.js' : p;
    for (const v of [sample, '/home/u/ai-factory/factory/worktrees/j/' + sample]) {
      assert.equal(decide(rules, v), 'deny', `${v} deberia estar denegado al builder`);
    }
  }
  assert.equal(decide(rules, '/w/src/app.js'), 'allow');
});

const TABLE = [
  ['bash 01-TOOLS/new-job.sh job-1 2>&1', 'orchestrator'],
  ['bash .hooks/spec-first-gate.sh 2>&1', 'orchestrator'],
  ['bash 01-TOOLS/checks.sh job-1 2>&1', 'orchestrator'],
  ['bash 01-TOOLS/launch-reviewers.sh job-1 1 2>&1', 'orchestrator'],
  ['bash 01-TOOLS/validate-artifacts.sh job-1 1 2>&1', 'orchestrator'],
  ['bash 01-TOOLS/risk.sh job-1 2>&1', 'orchestrator'],
  ['git push -u origin factory/job-1', 'orchestrator'],
  ['gh pr create --draft --title t --body b', 'orchestrator'],
  ['cat factory/config.json', 'orchestrator'],
  ['ls .hooks/', 'orchestrator'],
  ['ls .opencode/plugins/ 2>&1', 'orchestrator'],
  ['node factory/scripts/validate-models.mjs 2>&1', 'orchestrator'],
  ['bash 01-TOOLS/risk.sh job-1', 'human-gate'],
  ['node 01-TOOLS/intake.js --issue 3', 'intake'],
  ['bash 01-TOOLS/checks.sh job-1', 'builder'],
];
for (const [cmd, agent] of TABLE) {
  test(`${agent} puede ejecutar: ${cmd}`, () => {
    assert.equal(classifyBash(cmd).blocked, false, 'lo bloquea el guard');
    assert.equal(decide(perms(agent).bash, cmd), 'allow', 'no lo permite el agente');
  });
}

const PRODUCES = [
  ['intake', 'factory/jobs/j/input.md'], ['spec-writer', 'factory/jobs/j/spec.md'], ['spec-writer', 'factory/jobs/j/tasks.md'],
  ['approver', 'factory/jobs/j/decision.md'], ['human-gate', 'factory/jobs/j/human.md'],
  ['memory-curator', 'factory/jobs/j/trace.md'], ['memory-curator', '02-DOCS/wiki/index.md'],
  ['orchestrator', 'factory/jobs/j/job.json'], ['orchestrator', 'factory/jobs/j/trace.md'],
];
for (const [agent, file] of PRODUCES) {
  test(`${agent} puede escribir ${file} (ruta relativa y absoluta) y el guard lo acepta`, () => {
    for (const f of [file, '/home/u/ai-factory/' + file]) {
      assert.equal(decide(perms(agent).edit, f, 'deny'), 'allow', f);
      assert.equal(classifyTool('write', { filePath: f }).blocked, false, f);
    }
  });
}

test('los reviewers no escriben ni ejecutan: el script guarda sus reviews', () => {
  for (const a of AGENTS.filter((x) => x.startsWith('reviewer-'))) {
    const p = perms(a);
    assert.equal(p.flat.edit, 'deny'); assert.equal(p.flat.bash, 'deny');
  }
});

test('el orchestrator no puede escribir contenido de otros agentes', () => {
  const r = perms('orchestrator').edit;
  for (const f of ['spec.md', 'tasks.md', 'decision.md', 'human.md', 'input.md']) assert.equal(decide(r, 'factory/jobs/j/' + f, 'deny'), 'deny', f);
  assert.equal(decide(r, 'src/app.js', 'deny'), 'deny');
});

test('el prompt del orchestrator nombra cada script y agente que usa, y todos existen', () => {
  const txt = fs.readFileSync(path.join(ROOT, '.opencode/agent/orchestrator.md'), 'utf8');
  for (const s of txt.match(/01-TOOLS\/[\w.-]+\.(?:sh|js)/g) || []) assert.ok(fs.existsSync(path.join(ROOT, s)), s);
  for (const h of txt.match(/\.hooks\/[\w.-]+\.sh/g) || []) assert.ok(fs.existsSync(path.join(ROOT, h)), h);
  for (const a of txt.match(/@[a-z-]+/g) || []) assert.ok(AGENTS.includes(a.slice(1)), a);
  assert.match(txt, /launch-reviewers\.sh/); assert.match(txt, /NUNCA por Task/);
  assert.doesNotMatch(txt, /FACTORY_HUMAN=|FACTORY_GUARD_ALLOW_PROTECTED_EDIT=1/);
});
