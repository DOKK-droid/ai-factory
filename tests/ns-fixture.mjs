// Fixture de next-step.sh: repo temporal con remoto bare, y funciones que avanzan un job estado a estado.
// Usa los scripts REALES (new-job.sh, checks.sh); los artefactos de agentes se escriben a mano (en un tmpdir, nunca en un job real).
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, git, run } from './helpers.mjs';
export const COMMIT_BRAIN = path.join(REPO, '01-TOOLS/commit-brain.sh');

export const NEXT = path.join(REPO, '01-TOOLS/next-step.sh');
const NEWJOB = path.join(REPO, '01-TOOLS/new-job.sh');
const CHECKS = path.join(REPO, '01-TOOLS/checks.sh');

// Reloj monotono: cada artefacto escrito a mano es estrictamente mas nuevo que el anterior (mtime), como en un job real.
let clock = Date.now() / 1000;
export const stamp = (file) => { clock = Math.max(Date.now() / 1000, clock + 0.002); fs.utimesSync(file, clock, clock); };
export const put = (file, text) => { write(file, text); stamp(file); };

export const SPEC = ({ surface = 'none', alcance = '- src/**', criteria = '1. Hace X\n2. Hace Y', title = '# Spec de prueba' } = {}) =>
  `${title}\nSurface: ${surface}\n\n## Criterios\n${criteria}\n\nAlcance:\n${alcance}\n`;

// implementa: lista (una entrada por RF) con lo que cada RF implementa de la base documental, p. ej. ['REQ-F-1', 'REQ-F-2, UC-2']
export const SPEC_FULL = ({ surface = 'none', adr = 'none', title = '# Spec de prueba', extra = '', implementa = null } = {}) => `${title}
Surface: ${surface}
ADR: ${adr}

## Objetivo de negocio
Acotar numeros.

## Actores
- Desarrollador: usa la funcion en su codigo
- Suite de tests: verifica el comportamiento

## Requisitos funcionales
- RF-1: acota por debajo de min${implementa?.[0] ? `. Implementa: ${implementa[0]}` : ''}
- RF-2: acota por encima de max${implementa?.[1] ? `. Implementa: ${implementa[1]}` : ''}

## Diseño
- src/feature.js exporta la funcion pura

## Criterios de aceptación
1. [RF-1] devuelve min si n < min
2. [RF-2] devuelve max si n > max
${extra}
## Alcance
- src/**
`;
export const TASKS_FULL = '- [ ] T1 (RF-1): test en rojo\n- [ ] T2 (RF-2): codigo\n';

/** Parsea la salida de next-step: { code, first, kind, state, why[], cmd[], read, raw }. */
export function parse(r) {
  const lines = String(r.stdout).split('\n').filter(Boolean);
  const first = lines[0] || '';
  const get = (k) => lines.filter((l) => l.startsWith(k + ': ')).map((l) => l.slice(k.length + 2));
  return {
    code: r.status, first, raw: r.stdout, stderr: r.stderr,
    kind: first.split(':')[0].trim(),
    value: first.includes(': ') ? first.slice(first.indexOf(': ') + 2) : '',
    state: get('STATE')[0], phase: get('PHASE')[0], why: get('WHY'), cmd: get('CMD'), read: get('READ')[0],
  };
}

export function fx({ project = null, config = null, remote = true, id = 'job-1', tools = false } = {}) {
  const origin = tmp('af-origin-'); git(origin, 'init', '-q', '--bare', '-b', 'main');
  const repo = tmp('af-ns-');
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.email', 't@t.t'); git(repo, 'config', 'user.name', 't'); git(repo, 'config', 'commit.gpgsign', 'false');
  write(path.join(repo, '.gitignore'), 'factory/jobs/\nfactory/worktrees/\n');
  write(path.join(repo, 'src/app.js'), 'export const a = 1;\n');
  write(path.join(repo, '02-DOCS/wiki/index.md'), '# Brain\n');
  write(path.join(repo, '02-DOCS/wiki/sdd/methodology.md'), '# metodologia\n'); write(path.join(repo, '02-DOCS/wiki/sdd/job-page-template.md'), '# plantilla\n');
  write(path.join(repo, '02-DOCS/wiki/sdd/decisions.md'), '# decisiones\n\n## ADR-007: algo previo\nEstado: Aprobado\n');
  // tools: el repo lleva la capa de la fabrica (01-TOOLS y factory/scripts), como cualquier proyecto onboardeado; las worktrees la heredan.
  if (tools) { fs.cpSync(path.join(REPO, '01-TOOLS'), path.join(repo, '01-TOOLS'), { recursive: true }); fs.cpSync(path.join(REPO, 'factory/scripts'), path.join(repo, 'factory/scripts'), { recursive: true }); }
  if (project !== null) write(path.join(repo, 'factory/project.json'), typeof project === 'string' ? project : JSON.stringify(project));
  if (config !== null) write(path.join(repo, 'factory/config.json'), JSON.stringify(config));
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
  if (remote) { git(repo, 'remote', 'add', 'origin', origin); git(repo, 'push', '-q', '-u', 'origin', 'main'); }

  const requireSpecOk = !(project && typeof project === 'object' && project.require_spec_ok === false);
  const full = !!(project && typeof project === 'object' && project.spec_profile === 'full');
  const f = { full, requireSpecOk, repo, origin, id, wt: path.join(repo, 'factory/worktrees', id), job: path.join(repo, 'factory/jobs', id), gh: null };
  const env = (extra = {}) => {
    const e = { ...process.env, GH_BIN: f.gh || '/nonexistent/gh', ...extra };
    for (const k of ['FACTORY_JOBS_DIR', 'FACTORY_CONFIG', 'FACTORY_BASE', 'FACTORY_REQUIRE_SPEC_OK', 'FACTORY_LOW_RESOURCES']) if (!(k in extra)) delete e[k];
    return e;
  };
  f.env = env;
  f.ns = (extra = {}, cwd = repo, args = [id]) => parse(run('bash', [NEXT, ...args], { cwd, env: env(extra), timeout: 60000 }));
  f.newJob = () => { const r = run('bash', [NEWJOB, id], { cwd: repo, env: env() }); if (r.status !== 0) throw new Error('new-job: ' + r.stdout + r.stderr); };
  f.input = () => put(path.join(f.job, 'input.md'), '# Tarea\nhaz algo\n');
  f.spec = (o) => {
    put(path.join(f.job, 'spec.md'), f.full ? SPEC_FULL(o) : SPEC(o));
    put(path.join(f.job, 'tasks.md'), f.full ? TASKS_FULL : '- [ ] t1\n');
  };
  f.confirm = () => put(path.join(f.job, 'spec.ok'), '');
  f.head = () => git(f.wt, 'rev-parse', 'HEAD').trim();
  f.commit = (file = 'src/feature.js', text = `export const v = ${Math.random()};\n`) => {
    write(path.join(f.wt, file), text); git(f.wt, 'add', file); git(f.wt, 'commit', '-qm', 'trabajo'); return f.head();
  };
  f.gate = (pass = true) => {
    const r = run('bash', [CHECKS, id], { cwd: f.wt, env: env({ FACTORY_TEST_CMD: pass ? 'true' : 'exit 1' }) });
    if (pass && r.status !== 0) throw new Error('checks: ' + r.stdout + r.stderr);
  };
  f.reviews = (round = 1, { commit = null, verdict = 'PASS', score = '0.9', fallo = false, withCommit = true } = {}) => {
    const dir = path.join(f.job, `round-${round}`);
    for (const r of ['security', 'ux', 'ui', 'code']) {
      put(path.join(dir, `review-${r}.md`), fallo && r === 'code' ? 'VERDICT: CHANGES\nSCORE: 0\n\nREVIEWER_FALLO: timeout\n' : `VERDICT: ${verdict}\nSCORE: ${score}\n\nok\n`);
    }
    if (withCommit) put(path.join(dir, '.commit'), (commit || f.head()) + '\n');
  };
  f.decision = (l1 = 'APPROVE') => put(path.join(f.job, 'decision.md'), `${l1}\n\nmotivo\n`);
  f.human = (l1 = 'NEEDS_HUMAN', summary = true) => put(path.join(f.job, 'human.md'), `${l1}\n\n## Riesgos detectados\n- Ninguno.\n${summary ? '\n## Resumen para el humano\nTodo bien.\n' : ''}`);
  f.trace = (brain = 'Brain: sin cambios') => put(path.join(f.job, 'trace.md'), `# trace\n${brain}\n`);
  /** Simula al memory-curator: escribe el Brain EN LA WORKTREE (sin commitear) y la linea Brain: de trace.md. */
  f.curate = ({ skipHeading = null, gateSha = true, listJobPage = true, extraPage = null, adrStatus = (f.requireSpecOk === false ? 'Propuesto' : 'Aprobado') } = {}) => {
    const spec = fs.readFileSync(path.join(f.job, 'spec.md'), 'utf8'); const gate = fs.readFileSync(path.join(f.job, 'gate.md'), 'utf8');
    const adr = (spec.match(/^ADR:\s*(.*)$/m) || [])[1] || 'none'; const sha7 = (gate.match(/^COMMIT: (\w{7})/m) || [])[1];
    const pages = []; const wt = (rel) => path.join(f.wt, rel);
    if (f.full) {
      const page = `02-DOCS/wiki/jobs/${id}.md`;
      const sec = ['Resumen', 'Actores', 'Requisitos funcionales', 'Diseño', 'Implementación', 'Pruebas', 'Lecciones'].filter((h) => h !== skipHeading)
        .map((h) => `## ${h}\n${h === 'Pruebas' && gateSha ? `Gate sobre el commit ${sha7}: GATE: PASS\n` : 'texto\n'}`).join('\n');
      write(wt(page), `# job ${id}\n\n${sec}`); if (listJobPage) pages.push(page);
    }
    const idx = fs.readFileSync(wt('02-DOCS/wiki/index.md'), 'utf8'); write(wt('02-DOCS/wiki/index.md'), idx + `| job ${id} | \`02-DOCS/wiki/jobs/${id}.md\` | doc |\n`); pages.push('02-DOCS/wiki/index.md');
    if (adr !== 'none') {
      const dec = fs.readFileSync(wt('02-DOCS/wiki/sdd/decisions.md'), 'utf8');
      const n = Math.max(...[...dec.matchAll(/^## ADR-0*(\d+):/gm)].map((m) => +m[1]), 0) + 1;
      write(wt('02-DOCS/wiki/sdd/decisions.md'), dec + `\n## ADR-${String(n).padStart(3, '0')}: ${adr}\nEstado: ${adrStatus}\n`); pages.push('02-DOCS/wiki/sdd/decisions.md');
    }
    if (extraPage) { write(wt(extraPage), 'x\n'); pages.push(extraPage); }
    put(path.join(f.job, 'trace.md'), `# trace\nBrain: ${pages.join(', ')}\n`);
  };
  f.commitBrain = () => { const r = run('bash', [COMMIT_BRAIN, id], { cwd: f.wt, env: env() }); if (r.status !== 0) throw new Error('commit-brain: ' + r.stdout + r.stderr); return r; };
  f.push = () => git(f.wt, 'push', '-q', '-u', 'origin', `factory/${id}`);

  const STAGES = ['job', 'input', 'spec', 'confirmed', 'built', 'gated', 'reviewed', 'decided', 'humanized', 'traced', 'pushed'];
  /** Avanza el job hasta `stage` inclusive. */
  f.upTo = (stage) => {
    const n = STAGES.indexOf(stage); if (n < 0) throw new Error('etapa: ' + stage);
    if (n >= 0) f.newJob();
    if (n >= 1) f.input();
    if (n >= 2) f.spec();
    if (n >= 3) f.confirm();
    if (n >= 4) f.commit();
    if (n >= 5) f.gate();
    if (n >= 6) f.reviews(1);
    if (n >= 7) f.decision('APPROVE');
    if (n >= 8) f.human('NEEDS_HUMAN', true);
    if (n >= 9) { if (f.full) f.curate(); else f.trace(); }
    if (n >= 10) { if (f.full) f.commitBrain(); f.push(); }
    return f;
  };
  return f;
}

/** Un `gh` simulado: `pr view` falla hasta que se ejecuta `pr create`, que guarda sus argumentos. */
export function fakeGh() {
  const dir = tmp('af-gh-'); const bin = path.join(dir, 'gh');
  fs.writeFileSync(bin, `#!/usr/bin/env bash
D="${dir}"
if [ "$1 $2" = "pr view" ]; then [ -f "$D/created" ] && { echo "https://github.com/o/r/pull/7"; exit 0; }; echo "no pull requests found" >&2; exit 1; fi
if [ "$1 $2" = "pr create" ]; then printf '%s\\n' "$*" > "$D/created"; echo "https://github.com/o/r/pull/7"; exit 0; fi
exit 1
`);
  fs.chmodSync(bin, 0o755);
  return { bin, created: () => (fs.existsSync(path.join(dir, 'created')) ? fs.readFileSync(path.join(dir, 'created'), 'utf8') : null) };
}

const STUB_OPENCODE = `#!/usr/bin/env bash
if [ "$1" = "models" ]; then exit 0; fi
printf 'VERDICT: PASS\\nSCORE: 0.9\\n\\nSin hallazgos.\\n'
`;

/**
 * Hace de orchestrator: llama a next-step y ejecuta lo que diga. Los DELEGATE los "juega" el test escribiendo el
 * artefacto que ese agente produciria. `humans` simula lo que haria el humano ante cada STOP (por codigo).
 * Devuelve la lista de acciones emitidas. Para en DONE o en un STOP que el humano no resuelve.
 */
export function drive(f, { agents = {}, maxSteps = 40, humans = {} } = {}) {
  const actions = [];
  const oc = path.join(tmp('af-oc-'), 'opencode'); fs.writeFileSync(oc, STUB_OPENCODE); fs.chmodSync(oc, 0o755);
  const play = {
    intake: () => f.input(), 'spec-writer': () => f.spec(), approver: () => f.decision('APPROVE'),
    'human-gate': () => put(path.join(f.job, 'human.md'), fs.readFileSync(path.join(f.job, 'human.md'), 'utf8') + '\n## Resumen para el humano\nok\n'),
    'memory-curator': () => (f.full ? f.curate() : f.trace()), builder: () => f.commit(),
    ...agents,
  };
  for (let i = 0; i < maxSteps; i++) {
    const r = f.ns();
    actions.push(r);
    if (r.kind === 'DONE') return { actions, final: r };
    if (r.kind === 'STOP') { const code = r.value; if (!humans[code]) return { actions, final: r }; humans[code](r); continue; }
    if (r.kind === 'RUN') {
      const cmd = f.gh ? r.value.replace(/^gh /, f.gh + ' ') : r.value; // el gh de verdad no existe en el tmpdir
      const out = run('bash', ['-c', cmd], { cwd: f.repo, env: f.env({ OPENCODE_BIN: oc, FACTORY_SKIP_MODEL_CHECK: '1', REVIEW_POLL_SECS: '1', FACTORY_TEST_CMD: 'true' }), timeout: 120000 });
      if (out.status !== 0) return { actions, final: { kind: 'STOP', value: 'SCRIPT_FAILED', why: [out.stdout + out.stderr], first: 'STOP: SCRIPT_FAILED' } };
    } else if (r.kind === 'DELEGATE') {
      const agent = r.value.split('|')[0].trim().replace(/^@/, '');
      if (!play[agent]) throw new Error('agente sin simular: ' + agent);
      play[agent]();
    } else throw new Error('salida inesperada: ' + r.raw);
  }
  throw new Error('el bucle no termino');
}
