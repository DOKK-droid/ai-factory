// Consistencia entre agentes, guard y scripts: el pipeline no puede exigir algo que otra capa prohibe.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyBash, classifyTool, PROTECTED_PATHS } from '../factory/scripts/command-guard.mjs';
import { fx, fakeGh, drive } from './ns-fixture.mjs';

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

test('approver y human-gate leen el historial de la worktree con git -C, acotado a factory/worktrees/', () => {
  for (const a of ['approver', 'human-gate']) {
    const rules = perms(a).bash;
    for (const c of ['log', 'show', 'diff', 'status']) {
      assert.equal(decide(rules, `git -C factory/worktrees/job-1 ${c} --stat`), 'allow', `${a}: git -C factory/worktrees/<id> ${c}`);
    }
    for (const v of ['git -C . log', 'git -C /tmp/otro log', 'git -C factory/worktrees/job-1 push origin main', 'git -C factory/worktrees/job-1 commit -m x', 'git push origin main']) {
      assert.equal(decide(rules, v, 'deny'), 'deny', `${a}: ${v} no debe estar permitido`);
    }
    assert.ok(!rules.some(([p, act]) => act === 'allow' && /^git -C \*/.test(p)), `${a}: nada de "git -C *" generico`);
  }
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
  ['cd factory/worktrees/job-1', 'orchestrator'],
  ['cd factory/worktrees/job-1 && bash 01-TOOLS/checks.sh job-1 2>&1', 'orchestrator'],
  ['cd factory/worktrees/job-1 && bash 01-TOOLS/launch-reviewers.sh job-1 1 2>&1', 'orchestrator'],
  ['cd factory/worktrees/job-1 && bash 01-TOOLS/risk.sh job-1 2>&1', 'orchestrator'],
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
  ['orchestrator', 'factory/jobs/j/trace.md'],
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
  for (const f of ['spec.md', 'tasks.md', 'decision.md', 'human.md', 'input.md', 'gate.md', 'job.json', 'round-1/review-code.md']) assert.equal(decide(r, 'factory/jobs/j/' + f, 'deny'), 'deny', f);
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

// ---- next-step.sh (plano de control) vs permisos reales de los agentes y del guard ----
test('next-step.sh: cada DELEGATE puede escribir el artefacto que dice y cada RUN lo aceptan el guard y el allowlist del orchestrator', { timeout: 300000 }, () => {
  const f = fx({ tools: true }); const gh = fakeGh(); f.gh = gh.bin; let n = 0;
  const { actions, final } = drive(f, { humans: { HUMAN_CONFIRM_SPEC: () => f.confirm() }, agents: { approver: () => f.decision(++n === 1 ? 'CHANGES' : 'APPROVE') } });
  assert.equal(final.first, 'DONE', actions.map((a) => a.first).join('\n'));
  const seenAgents = new Set(); const seenRuns = [];
  for (const a of actions) {
    if (a.kind === 'DELEGATE') {
      const parts = a.value.split(' | ').map((x) => x.trim()); assert.equal(parts.length, 3, `DELEGATE ambiguo (los campos van separados por ' | '): ${a.first}`);
      const [who, , files] = parts; const agent = who.slice(1); seenAgents.add(agent);
      assert.ok(AGENTS.includes(agent), agent);
      for (const file of files.split(',')) {
        const target = file.endsWith('/') ? file + 'src/x.js' : file;  // builder: la worktree entera
        for (const v of [target, '/home/u/ai-factory/' + target]) {
          assert.equal(decide(perms(agent).edit, v, 'deny'), 'allow', `${agent} no puede escribir ${v}`);
          assert.equal(classifyTool('write', { filePath: v }).blocked, false, `el guard bloquea ${agent} -> ${v}`);
        }
      }
    } else if (a.kind === 'RUN') {
      seenRuns.push(a.value);
      assert.equal(classifyBash(a.value).blocked, false, `el guard bloquea: ${a.value}`);
      assert.equal(decide(perms('orchestrator').bash, a.value), 'allow', `el orchestrator no tiene permiso para: ${a.value}`);
    }
  }
  for (const a of ['intake', 'spec-writer', 'builder', 'approver', 'human-gate', 'memory-curator']) assert.ok(seenAgents.has(a), `el recorrido no delego en ${a}`);
  for (const re of [/new-job\.sh/, /checks\.sh/, /launch-reviewers\.sh job-1 2$/, /risk\.sh/, /^git push -u origin factory\//, /^gh pr create --draft/]) assert.ok(seenRuns.some((r) => re.test(r)), String(re));
});
test('next-step.sh: ningun agente puede crear las marcas del humano ni la evidencia que el script lee', () => {
  for (const agent of AGENTS) {
    const rules = perms(agent).edit; if (!rules.length) continue;
    for (const f of ['factory/jobs/j/spec.ok', 'factory/jobs/j/review.ok', 'factory/jobs/j/pr.url', 'factory/jobs/j/gate.md', 'factory/jobs/j/round-1/.commit', 'factory/jobs/j/round-1/review-code.md', 'factory/project.json', '01-TOOLS/next-step.sh'])
      assert.notEqual(decide(rules, f, 'deny'), 'allow', `${agent} podria escribir ${f}`);
  }
});
test('next-step.sh: cada codigo STOP que puede emitir esta explicado en el prompt del orchestrator', () => {
  const sh = fs.readFileSync(path.join(ROOT, '01-TOOLS/next-step.sh'), 'utf8'); const orch = fs.readFileSync(path.join(ROOT, '.opencode/agent/orchestrator.md'), 'utf8');
  const codes = new Set([...sh.matchAll(/\bstop ([A-Z][A-Z_]+)/g)].map((m) => m[1])); assert.ok(codes.size >= 12, [...codes].join());
  for (const c of codes) assert.ok(orch.includes(c), `el orchestrator no menciona STOP: ${c}`);
  assert.match(orch, /next-step\.sh/); assert.match(orch, /Nunca elijas el siguiente paso por tu cuenta/);
  assert.equal(decide(perms('orchestrator').bash, 'bash 01-TOOLS/next-step.sh job-1'), 'allow');
  assert.equal(decide(perms('orchestrator').bash, 'bash 01-TOOLS/next-step.sh --new-id'), 'allow');
});
test('/factory: el comando delega en next-step.sh y empieza por el estado 0', () => {
  const cmd = fs.readFileSync(path.join(ROOT, '.opencode/command/factory.md'), 'utf8');
  assert.match(cmd, /next-step\.sh/); assert.match(cmd, /--new-id/); assert.match(cmd, /estado 0/); assert.match(cmd, /\$ARGUMENTS/);
  for (const a of cmd.match(/@[a-z-]+/g) || []) assert.ok(AGENTS.includes(a.slice(1)), a);
});
