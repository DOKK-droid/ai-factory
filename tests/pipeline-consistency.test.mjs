// Consistencia entre agentes, guard y scripts: el pipeline no puede exigir algo que otra capa prohibe.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { classifyBash, classifyTool, PROTECTED_PATHS } from '../factory/scripts/command-guard.mjs';
import { fx, fakeGh, drive } from './ns-fixture.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = ['orchestrator', 'intake', 'spec-writer', 'builder', 'reviewer-security', 'reviewer-ux', 'reviewer-ui', 'reviewer-code', 'approver', 'human-gate', 'memory-curator'];

/** Parser minimo del frontmatter: permission.{edit,bash} -> [[patron, accion]] en orden. */
function perms(agent) {
  const txt = fs.readFileSync(path.join(ROOT, '.opencode/agent', agent + '.md'), 'utf8');
  const fm = txt.split('\n---\n')[0].split('\n');
  const out = { edit: [], bash: [], task: [], flat: {} };
  let sec = null;
  for (const l of fm) {
    let m = l.match(/^  (\w+):\s*(\w+)?$/);
    if (m) { sec = m[1]; if (m[2]) out.flat[sec] = m[2]; continue; }
    m = l.match(/^    "([^"]+)":\s*(\w+)$/);
    if (m && (sec === 'edit' || sec === 'bash' || sec === 'task')) out[sec].push([m[1], m[2]]);
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

test('orchestrator: regla para peticiones que no son un job (solo texto; no prueba el comportamiento del modelo)', () => {
  const txt = fs.readFileSync(path.join(ROOT, '.opencode/agent/orchestrator.md'), 'utf8');
  assert.match(txt, /Si la petición no es una tarea de software/);
  for (const f of ['PATCH', 'PARCHE', 'NEXT-STEPS-FABRICA']) assert.ok(txt.includes(f), `la regla debe nombrar ${f}`);
  assert.match(txt, /no crees un job/);
  // sigue sin poder escribir fuera de trace.md
  const edit = perms('orchestrator').edit;
  for (const v of ['factory/jobs/j/trace.md']) assert.equal(decide(edit, v), 'allow');
  for (const v of ['factory/jobs/j/pr.url', 'factory/jobs/j/gate.md', 'factory/jobs/j/decision.md', 'factory/jobs/j/human.md', 'docs/PATCH-5.md', '01-TOOLS/next-step.sh']) assert.equal(decide(edit, v), 'deny', v);
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

// ---- /factory-init: discovery y los cinco especialistas de la base documental ----
const INIT_ROLES = { discovery: 'go-approver', 'system-analyst': 'sol', 'domain-modeler': 'sol', architect: 'go-approver', 'deployment-planner': 'sol', 'consistency-auditor': 'go-security' };
const INIT_AGENTS = Object.keys(INIT_ROLES);
const OWN = {
  discovery: ['discovery.md'], 'system-analyst': ['00-vision.md', '01-requisitos.md', '02-casos-de-uso.md'], 'domain-modeler': ['03-dominio.md', '05-datos.md'],
  architect: ['04-arquitectura.md'], 'deployment-planner': ['06-despliegue.md'], 'consistency-auditor': [],
};
const WT = '/home/u/ai-factory/factory/worktrees/init-1/';
const PD = '02-DOCS/wiki/project/';
const ALL_PROJECT_FILES = ['00-vision.md', '01-requisitos.md', '02-casos-de-uso.md', '03-dominio.md', '04-arquitectura.md', '05-datos.md', '06-despliegue.md', 'discovery.md', 'trazabilidad.md', 'project.ok'];
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'factory/config.json'), 'utf8'));
const PATCH4 = 'docs/propuestas/rama4-factory-init.patch';
const rolesApplied = INIT_AGENTS.filter((a) => CONFIG.roles[a] !== undefined).length;
const missPatch = (ok) => (ok ? false : `falta aplicar ${PATCH4} (roles de los seis agentes en factory/config.json)`);

test('init: los seis agentes existen, cada patron de edit es de la worktree (empieza por * y nombra factory/worktrees/*/)', () => {
  for (const a of INIT_AGENTS) {
    assert.ok(fs.existsSync(path.join(ROOT, '.opencode/agent', a + '.md')), a);
    const edit = perms(a).edit.filter(([p]) => p !== '*');
    for (const [p] of perms(a).edit) assert.ok(p.startsWith('*'), `${a}: "${p}"`);
    for (const [p, act] of edit) if (act === 'allow') assert.match(p, /^\*factory\/worktrees\/\*\/02-DOCS\//, `${a}: "${p}" debe ser de la worktree`);
  }
});

test('init: cada agente escribe solo sus archivos (en la worktree) y el guard lo acepta; nada en el checkout principal', () => {
  for (const a of INIT_AGENTS) {
    const rules = perms(a).edit;
    const own = OWN[a].map((f) => PD + f);
    if (a === 'architect') own.push('02-DOCS/wiki/sdd/decisions.md');
    for (const f of own) {
      assert.equal(decide(rules, WT + f, 'deny'), 'allow', `${a} debe poder escribir ${f}`);
      assert.equal(classifyTool('write', { filePath: WT + f }).blocked, false, `el guard bloquea ${a} -> ${f}`);
      assert.equal(decide(rules, '/home/u/ai-factory/' + f, 'deny'), 'deny', `${a}: ${f} en el checkout principal`);
      assert.equal(decide(rules, f, 'deny'), 'deny', `${a}: ${f} relativa (checkout principal)`);
    }
    const others = ALL_PROJECT_FILES.map((f) => PD + f).filter((f) => !own.includes(f));
    for (const f of [...others, '02-DOCS/wiki/sdd/decisions.md'].filter((f) => !own.includes(f))) assert.equal(decide(rules, WT + f, 'deny'), 'deny', `${a} no debe escribir ${f}`);
    for (const f of ['src/app.js', 'factory/jobs/init-1/spec.md', 'factory/jobs/init-1/brain.ok', 'opencode.json', 'AGENTS.md', 'factory/config.json']) assert.equal(decide(rules, WT + f, 'deny'), 'deny', `${a} no debe escribir ${f}`);
  }
});

test('init: solo discovery tiene task (a los cinco especialistas); webfetch solo ask en discovery; ninguno tiene websearch', () => {
  assert.deepEqual(perms('discovery').task.filter(([, act]) => act === 'allow').map(([p]) => p).sort(), INIT_AGENTS.filter((a) => a !== 'discovery').sort());
  assert.equal(decide(perms('discovery').task, 'builder', 'deny'), 'deny'); assert.equal(decide(perms('discovery').task, 'discovery', 'deny'), 'deny');
  for (const a of INIT_AGENTS) {
    const f = perms(a).flat;
    assert.equal(f.websearch, 'deny', `${a}: websearch`);
    assert.equal(f.webfetch, a === 'discovery' ? 'ask' : 'deny', `${a}: webfetch`);
    if (a !== 'discovery') assert.equal(perms(a).task.length, 0, `${a} no debe tener task`);
  }
  for (const a of AGENTS) assert.equal(perms(a).task.length, 0, `${a} (pipeline) no recibe task nuevo`);
});

test('init: nadie ejecuta project-lint approve ni sudo/install-managed/onboard-project --apply; discovery pregunta antes de init-project --apply', () => {
  const NEVER = ['node factory/scripts/project-lint.mjs approve 00-vision', 'node factory/scripts/project-lint.mjs --root x approve 01-requisitos', 'sudo bash factory/scripts/install-managed.sh --apply',
    'bash factory/scripts/install-managed.sh --apply', 'bash factory/scripts/onboard-project.sh o/r --apply', 'git push origin main', 'git commit -m x', 'git add -A', 'rm -rf 02-DOCS'];
  for (const a of INIT_AGENTS) for (const c of NEVER) assert.equal(decide(perms(a).bash, c, 'deny'), 'deny', `${a}: ${c}`);
  const d = perms('discovery').bash;
  assert.equal(decide(d, 'bash factory/scripts/init-project.sh --dir .'), 'allow'); assert.equal(decide(d, 'bash factory/scripts/init-project.sh'), 'allow');
  for (const step of ['install', 'deps', 'hooks', 'rsc', 'workspace']) assert.equal(decide(d, `bash factory/scripts/init-project.sh --dir . --apply ${step}`), 'ask', step);
  for (const c of ['bash factory/scripts/init-project.sh', 'node factory/scripts/project-lint.mjs state --root factory/worktrees/init-1', 'node factory/scripts/project-lint.mjs trace --write --root factory/worktrees/init-1']) {
    assert.equal(classifyBash(c).blocked, false, `el guard bloquea: ${c}`); assert.equal(decide(d, c), 'allow', c);
  }
  for (const c of ['node factory/scripts/project-lint.mjs approve 00-vision']) assert.equal(classifyBash(c).blocked, true, 'el guard debe bloquear approve a un agente');
});

test('init: los especialistas y el auditor solo comprueban con project-lint (check/state/impact segun el rol); el auditor no escribe', () => {
  for (const a of ['system-analyst', 'domain-modeler', 'architect', 'deployment-planner']) {
    assert.equal(decide(perms(a).bash, 'node factory/scripts/project-lint.mjs check --root factory/worktrees/init-1'), 'allow', a);
    assert.equal(decide(perms(a).bash, 'node factory/scripts/project-lint.mjs trace --write'), 'deny', `${a} no genera la trazabilidad`);
  }
  const au = perms('consistency-auditor');
  assert.equal(au.flat.edit, 'deny'); assert.equal(au.edit.length, 0);
  for (const sub of ['check --strict', 'state', 'impact']) assert.equal(decide(au.bash, `node factory/scripts/project-lint.mjs ${sub} --root factory/worktrees/init-1`), 'allow', sub);
  assert.equal(decide(au.bash, 'node factory/scripts/project-lint.mjs trace --write'), 'deny');
});

test('init: el modelo de cada agente es el de la decision D6 (tier resuelto en config.json)', () => {
  for (const [a, tier] of Object.entries(INIT_ROLES)) {
    const txt = fs.readFileSync(path.join(ROOT, '.opencode/agent', a + '.md'), 'utf8');
    assert.equal(txt.match(/^model: (.+)$/m)[1], CONFIG.tiers[tier], `${a} debe usar ${tier}`);
  }
});

test('init: roles de config.json — o los seis o ninguno (parche a medias = fallo)', () => {
  assert.ok(rolesApplied === 0 || rolesApplied === 6, `parche a medias: ${rolesApplied} de 6 roles; aplica ${PATCH4} completo`);
  assert.ok(fs.existsSync(path.join(ROOT, PATCH4)), PATCH4);
});
test('init: con el parche aplicado cada rol apunta al tier de D6 y apply-models --check no encuentra desajustes', { skip: missPatch(rolesApplied === 6) }, () => {
  for (const [a, tier] of Object.entries(INIT_ROLES)) assert.equal(CONFIG.roles[a], tier, a);
  const r = spawnSync('node', ['factory/scripts/apply-models.js', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('init: los prompts nombran solo scripts y agentes que existen; /factory-init delega en discovery', () => {
  for (const a of INIT_AGENTS) {
    const txt = fs.readFileSync(path.join(ROOT, '.opencode/agent', a + '.md'), 'utf8');
    for (const s of txt.match(/(?:factory\/scripts|01-TOOLS)\/[\w.-]+\.(?:sh|js|mjs)/g) || []) assert.ok(fs.existsSync(path.join(ROOT, s)), `${a}: ${s}`);
    for (const t of txt.match(/factory\/templates\/project\/[\w.-]+\.md/g) || []) if (!t.includes('<')) assert.ok(fs.existsSync(path.join(ROOT, t)), `${a}: ${t}`);
    if (a !== 'consistency-auditor') assert.match(txt, /(?:no|nunca)[^.\n]*aprobado|aprobaci[oó]n[^.\n]*humano|ejecuta el humano|project-lint approve/i, `${a}: debe decir que aprobar es del humano`);
  }
  const cmd = fs.readFileSync(path.join(ROOT, '.opencode/command/factory-init.md'), 'utf8');
  assert.match(cmd, /^agent: discovery$/m); assert.match(cmd, /init-project\.sh/); assert.match(cmd, /HANDOFF=discovery/); assert.match(cmd, /MANUAL:/); assert.match(cmd, /\$ARGUMENTS/);
  const disc = fs.readFileSync(path.join(ROOT, '.opencode/agent/discovery.md'), 'utf8');
  for (const a of INIT_AGENTS.filter((x) => x !== 'discovery')) assert.match(disc, new RegExp(a));
  assert.match(disc, /\[INVESTIGADO/); assert.match(disc, /no confiable/); assert.match(disc, /hasta 10/); assert.doesNotMatch(disc, /máximo 5/);
});

test('D5/D9: la propia fabrica exige la base documental (project_docs=required) y fast_path sigue apagado', () => {
  const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'factory/project.json'), 'utf8'));
  assert.equal(pj.project_docs, 'required');
  assert.equal(CONFIG.fast_path.enabled, false, 'fast_path lo habilita el humano explicitamente');
  assert.equal(rolesApplied, 6, 'config.json lleva los roles de los seis agentes (los gobierna apply-models)');
});
