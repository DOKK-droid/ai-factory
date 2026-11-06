// init-project.sh: modo derivado, requisitos, pasos de uno en uno, idempotencia y "nunca sudo". Todo en directorios temporales,
// con espias en el PATH (sudo, gh, opencode, npm, npx) que registran cada llamada; sin red ni OpenCode.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, git, run } from './helpers.mjs';
import { head, BODY } from './project-fixture.mjs';
import { PLAN } from './rsc-fake.mjs';

const INIT = path.join(REPO, 'factory/scripts/init-project.sh');
const INSTALL = path.join(REPO, 'factory/scripts/install-into.sh');
const FAKE = path.join(REPO, 'tests/rsc-fake.mjs');

/** Carpeta de espias. Todas las llamadas quedan en `log`. gh responde bien salvo SPY_GH_FAIL=1; npm ci crea node_modules. */
function spies() {
  const dir = tmp('af-spy-'); const log = path.join(dir, 'calls.log');
  const sh = (name, body) => { write(path.join(dir, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${log}"\n${body}\n`); fs.chmodSync(path.join(dir, name), 0o755); };
  sh('sudo', 'exit 0'); sh('opencode', 'exit 0'); sh('gh', '[ -z "${SPY_GH_FAIL:-}" ]');
  sh('npm', `case "$1" in view) exec node "${FAKE}" npm "$@" ;; ci) mkdir -p node_modules ;; run) [ "$2" = hooks:install ] && bash .hooks/install-git-hooks.sh ;; esac; exit 0`);
  write(path.join(dir, 'npx'), `#!/usr/bin/env bash\nexec node "${FAKE}" npx "$@"\n`); fs.chmodSync(path.join(dir, 'npx'), 0o755);
  const managed = tmp('af-nomanaged-');
  return { dir, log, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []),
    env: (extra = {}) => ({ ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_LOG: log, FACTORY_MODELS_CACHE_TTL_S: '0', FACTORY_MANAGED_DIR: managed, ...extra }) };
}
function repo(files = {}) {
  const d = tmp('af-init-');
  git(d, 'init', '-q', '-b', 'main'); git(d, 'config', 'user.email', 't@t.t'); git(d, 'config', 'user.name', 't'); git(d, 'config', 'commit.gpgsign', 'false');
  for (const [f, t] of Object.entries({ '.gitkeep': '', ...files })) write(path.join(d, f), t);
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base');
  return d;
}
const commit = (d, m = 'c') => { git(d, 'add', '-A'); git(d, 'commit', '-qm', m); };
const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');
const exists = (d, f) => fs.existsSync(path.join(d, f));
const tree = (d) => {
  const out = [];
  (function walk(p) { for (const e of fs.readdirSync(p, { withFileTypes: true })) { if (e.name === '.git') continue; const f = path.join(p, e.name); if (e.isDirectory()) walk(f); else out.push([path.relative(d, f), fs.readFileSync(f, 'utf8')]); } })(d);
  return out.sort(([a], [b]) => (a < b ? -1 : 1));
};
const go = (sp, d, args = [], extra = {}) => run('bash', [INIT, '--dir', d, ...args], { cwd: d, env: sp.env(extra) });
const kv = (out) => Object.fromEntries(out.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const lastLine = (out) => out.trim().split('\n').at(-1);
/** Destino con la fabrica instalada y commiteada. */
function installed(sp, files = {}) {
  const d = repo(files); const r = run('bash', [INSTALL, d, '--apply'], { env: sp.env() }); assert.equal(r.status, 0, r.stderr + r.stdout); commit(d, 'fabrica'); return d;
}
const PROJECT = '02-DOCS/wiki/project/';
const withDoc = (d, name, doc = {}) => { write(path.join(d, PROJECT, name + '.md'), head(name, doc) + BODY[name]); commit(d, 'doc ' + name); };

test('las cuatro fixtures dan el MODE esperado (A vacio, B con .md, C con codigo, D base parcial con la fabrica instalada)', () => {
  const sp = spies();
  const cases = [
    ['vacio', repo(), { CONTENT: 'A', FACTORY: 'missing', MODE: 'A' }],
    ['con .md', repo({ 'README.md': '# idea\n' }), { CONTENT: 'B', FACTORY: 'missing', MODE: 'B' }],
    ['con codigo', repo({ 'src/app.js': 'export const a = 1;\n', 'README.md': '# x\n' }), { CONTENT: 'C', FACTORY: 'missing', MODE: 'C' }],
  ];
  for (const [name, d, want] of cases) {
    const r = go(sp, d); assert.equal(r.status, 0, name + r.stderr); const o = kv(r.stdout);
    for (const [k, v] of Object.entries(want)) assert.equal(o[k], v, `${name}: ${k}`);
  }
  const d = installed(sp, { 'README.md': '# x\n' }); withDoc(d, '00-vision');
  const r = go(sp, d); const o = kv(r.stdout);
  assert.equal(o.FACTORY, 'installed'); assert.equal(o.PROJECT, 'partial'); assert.equal(o.MODE, 'D', r.stdout); assert.equal(o.CONTENT, 'B', 'el contenido sigue siendo B: el modo D lo decide la base documental');
});

test('modo D tambien con la base desactualizada; con la base sin empezar manda el contenido', () => {
  const sp = spies(); const d = installed(sp, { 'README.md': '# x\n' });
  assert.equal(kv(go(sp, d).stdout).MODE, 'B');
  write(path.join(d, PROJECT, '00-vision.md'), head('00-vision', { estado: 'desactualizado' }) + BODY['00-vision']);
  write(path.join(d, PROJECT, 'project.ok'), JSON.stringify({ docs: { '00-vision': { sha256: 'x', version: '0.1.0', refs: {} } } })); commit(d);
  const o = kv(go(sp, d).stdout); assert.equal(o.PROJECT, 'stale'); assert.equal(o.MODE, 'D');
  // sin fabrica instalada nunca es D, aunque haya documentos
  const m = repo({ [PROJECT + '00-vision.md']: head('00-vision') + BODY['00-vision'] }); const om = kv(go(sp, m).stdout);
  assert.equal(om.FACTORY, 'missing'); assert.notEqual(om.MODE, 'D');
});

test('lo que instala la fabrica no cuenta como contenido: instalada sobre un repo vacio sigue siendo A; con un package.json real, C; con un .md, B', () => {
  const sp = spies(); const d = installed(sp);
  assert.ok(exists(d, 'package.json') && exists(d, '02-DOCS/wiki/index.md') && exists(d, 'AGENTS.md'), 'la fabrica dejo package.json, Brain y AGENTS.md');
  assert.equal(kv(go(sp, d).stdout).CONTENT, 'A');
  write(path.join(d, 'notas.md'), '# notas\n'); assert.equal(kv(go(sp, d).stdout).CONTENT, 'B');
  write(path.join(d, 'package.json'), JSON.stringify({ name: 'x', dependencies: { express: '1' } })); assert.equal(kv(go(sp, d).stdout).CONTENT, 'C');
  const e = installed(sp); const pj = JSON.parse(read(e, 'package.json')); pj.scripts.build = 'tsc'; write(path.join(e, 'package.json'), JSON.stringify(pj)); assert.equal(kv(go(sp, e).stdout).CONTENT, 'C', 'un script propio es del proyecto');
  const f = repo({ 'node_modules/x/index.js': 'x', '.worktrees/a/b.py': 'x' }); assert.equal(kv(go(sp, f).stdout).CONTENT, 'A', 'node_modules y .worktrees se ignoran');
});

test('dry-run: no escribe nada, no llama a npm/npx/sudo y a gh solo para auth status', () => {
  const sp = spies();
  for (const d of [repo(), repo({ 'README.md': '# x\n' }), installed(sp)]) {
    const before = tree(d); const status = git(d, 'status', '--porcelain');
    const r = go(sp, d); assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(tree(d), before); assert.equal(git(d, 'status', '--porcelain'), status);
  }
  const calls = sp.calls();
  assert.ok(calls.every((c) => /^(opencode|gh auth status)/.test(c) || /^npm view/.test(c) === false && /^(sudo|npm|npx)/.test(c) === false), calls.join('\n'));
  assert.deepEqual(calls.filter((c) => /^(sudo|npm|npx)/.test(c)), []);
  assert.deepEqual(calls.filter((c) => /^gh /.test(c) && !/^gh auth status/.test(c)), []);
});

test('la ultima linea es HANDOFF: discovery con MODE, JOB y NEXT; blocked si falta la fabrica', () => {
  const sp = spies();
  const m = go(sp, repo({ 'README.md': '# x\n' })); assert.equal(lastLine(m.stdout), 'HANDOFF=blocked REASON=factory-missing MODE=B');
  const d = installed(sp); const r = go(sp, d);
  assert.equal(lastLine(r.stdout), 'HANDOFF=discovery MODE=A JOB=- NEXT=00-vision');
  assert.match(r.stdout, /^STEP:workspace PENDING/m); assert.match(r.stdout, /^STEP:rsc OPTIONAL/m);
});

test('requisitos: sin opencode es un error que corta; gh que no responde es un aviso; sin runner de tests avisa', () => {
  const sp = spies(); const d = installed(sp);
  const r = go(sp, d, [], { OPENCODE_BIN: '/no/existe/opencode' });
  assert.equal(r.status, 1); assert.match(r.stdout, /^CHECK:opencode ERROR/m); assert.equal(lastLine(r.stdout), 'HANDOFF=blocked REASON=requirements');
  const g = go(sp, d, [], { SPY_GH_FAIL: '1' }); assert.equal(g.status, 0); assert.match(g.stdout, /^CHECK:gh WARN/m);
  assert.match(g.stdout, /^CHECK:tests WARN/m, 'package.json de relleno: el gate fallaria');
  assert.match(go(sp, d, [], { FACTORY_TEST_CMD: 'true' }).stdout, /^CHECK:tests OK/m);
  write(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node --test' } })); assert.match(go(sp, d).stdout, /^CHECK:tests OK/m);
});

test('--apply install monta la fabrica en el destino y repetirlo no cambia nada', () => {
  const sp = spies(); const d = repo({ 'README.md': '# x\n' });
  const r = go(sp, d, ['--apply', 'install']); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(exists(d, 'factory/scripts/init-project.sh') && exists(d, '.opencode/agent/discovery.md') && exists(d, '.opencode/command/factory-init.md'));
  assert.equal(kv(r.stdout).FACTORY, 'installed'); assert.match(r.stdout, /^DONE:install/m);
  commit(d, 'fabrica'); const before = tree(d); const again = go(sp, d, ['--apply', 'install']); assert.equal(again.status, 0);
  assert.match(again.stdout, /^DONE:install/m); assert.deepEqual(tree(d), before);
});

test('--apply workspace crea el job init-<aammdd>-<4 hex> con su rama y su worktree, y repetirlo lo reutiliza', () => {
  const sp = spies(); const d = installed(sp);
  const r = go(sp, d, ['--apply', 'workspace']); assert.equal(r.status, 0, r.stdout + r.stderr);
  const o = kv(r.stdout); const m = lastLine(r.stdout).match(/^HANDOFF=discovery MODE=A JOB=(init-\d{6}-[0-9a-f]{4}) NEXT=00-vision$/); assert.ok(m, lastLine(r.stdout));
  const id = m[1]; assert.equal(o.JOB_WORKTREE, path.join(fs.realpathSync(d), 'factory/worktrees', id));
  assert.ok(exists(d, `factory/worktrees/${id}/.git`) && exists(d, `factory/jobs/${id}/job.json`));
  assert.match(git(d, 'branch', '--list', `factory/${id}`), new RegExp(id));
  const again = go(sp, d, ['--apply', 'workspace']); assert.match(again.stdout, /^DONE:workspace/m); assert.match(lastLine(again.stdout), new RegExp(`JOB=${id} `));
  assert.equal(git(d, 'branch', '--list', 'factory/init-*').trim().split('\n').length, 1, 'un solo job abierto');
  // con PR abierto el job ya no cuenta como abierto: el siguiente --apply crea otro
  write(path.join(d, `factory/jobs/${id}/pr.url`), 'https://x/pull/1\n');
  assert.equal(kv(go(sp, d).stdout).JOB, undefined); assert.match(lastLine(go(sp, d).stdout), /JOB=-/);
});

test('pasos que necesitan la fabrica: sin ella se niegan (exit 1, blocked) y no escriben', () => {
  const sp = spies(); const d = repo({ 'README.md': '# x\n' }); const before = tree(d);
  for (const step of ['hooks', 'rsc', 'workspace']) { const r = go(sp, d, ['--apply', step]); assert.equal(r.status, 1, step); assert.match(r.stdout, /HANDOFF=blocked REASON=factory-missing/); }
  assert.deepEqual(tree(d), before);
});

test('--apply deps: npm ci con package-lock.json, una sola vez; otros gestores se imprimen como MANUAL', () => {
  const sp = spies(); const d = installed(sp, { 'package-lock.json': '{}\n' });
  assert.match(go(sp, d).stdout, /^STEP:deps PENDING npm ci/m);
  const r = go(sp, d, ['--apply', 'deps']); assert.equal(r.status, 0, r.stderr); assert.ok(exists(d, 'node_modules'));
  assert.equal(sp.calls().filter((c) => c === 'npm ci').length, 1);
  assert.match(go(sp, d, ['--apply', 'deps']).stdout, /^DONE:deps/m); assert.equal(sp.calls().filter((c) => c === 'npm ci').length, 1);
  const p = installed(sp, { 'pnpm-lock.yaml': 'x\n' }); assert.match(go(sp, p).stdout, /^MANUAL: instala las dependencias/m);
  const rp = go(sp, p, ['--apply', 'deps']); assert.equal(rp.status, 1); assert.equal(sp.calls().filter((c) => c === 'npm ci').length, 1, 'no ejecuta pnpm por su cuenta');
  assert.match(go(sp, installed(sp)).stdout, /^SKIP:deps/m);
});

test('--apply hooks activa core.hooksPath una vez', () => {
  const sp = spies(); const d = installed(sp);
  assert.match(go(sp, d).stdout, /^STEP:hooks PENDING/m);
  const r = go(sp, d, ['--apply', 'hooks']); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(git(d, 'config', '--get', 'core.hooksPath').trim(), '.hooks/git');
  assert.match(go(sp, d).stdout, /^DONE:hooks/m); const n = sp.calls().length;
  assert.match(go(sp, d, ['--apply', 'hooks']).stdout, /^DONE:hooks/m);
  assert.equal(sp.calls().filter((c) => /^npm run hooks:install/.test(c)).length, 1, 'hooks:install no se repite'); assert.ok(sp.calls().length >= n);
});

test('--apply rsc: pasa las respuestas a rsc-pin.sh (3 = falta aceptar el plan), queda DONE y repetirlo no llama a nada', () => {
  const sp = spies(); const d = installed(sp);
  assert.match(go(sp, d).stdout, /^STEP:rsc OPTIONAL/m);
  const first = go(sp, d, ['--apply', 'rsc', '--', '--technical-level', 'technical', '--goal', 'prueba']);
  assert.equal(first.status, 3, first.stdout + first.stderr); assert.match(first.stdout, new RegExp(`--accept-plan ${PLAN}`)); assert.ok(!exists(d, '.rsc.json'));
  const second = go(sp, d, ['--apply', 'rsc', '--', '--technical-level', 'technical', '--goal', 'prueba', '--accept-plan', PLAN]);
  assert.equal(second.status, 0, second.stdout + second.stderr); assert.ok(exists(d, '.rsc.json'));
  assert.match(go(sp, d).stdout, /^DONE:rsc/m);
  const rscCalls = () => sp.calls().filter((c) => /^(npx|npm)/.test(c)).length; const n = rscCalls();
  assert.match(go(sp, d, ['--apply', 'rsc']).stdout, /^DONE:rsc/m); assert.equal(rscCalls(), n, 'ni npx ni npm');
  assert.equal(go(sp, d, ['--apply', 'deps', '--', '--goal', 'x']).status, 2, 'los argumentos tras -- solo valen para rsc');
});

test('idempotente (CA-I10.2): aplicar todos los pasos dos veces deja el mismo arbol, el mismo JOB y cero llamadas nuevas', () => {
  const sp = spies(); const d = repo({ 'README.md': '# x\n', 'package-lock.json': '{}\n' });
  for (const step of ['install']) assert.equal(go(sp, d, ['--apply', step]).status, 0);
  commit(d, 'fabrica');
  for (const step of ['deps', 'hooks', 'workspace']) assert.equal(go(sp, d, ['--apply', step]).status, 0, step);
  const before = tree(d); const job = kv(go(sp, d).stdout).JOB_WORKTREE;
  for (const step of ['install', 'deps', 'hooks', 'workspace']) { const r = go(sp, d, ['--apply', step]); assert.equal(r.status, 0, step); assert.match(r.stdout, new RegExp(`^DONE:${step}`, 'm')); }
  assert.deepEqual(tree(d), before); assert.equal(kv(go(sp, d).stdout).JOB_WORKTREE, job);
  assert.equal(sp.calls().filter((c) => /^(npm ci|npm run)/.test(c)).length, 2, 'ci y hooks:install una sola vez cada uno');
});

test('nunca sudo ni onboard-project --apply: cero llamadas a sudo, gh solo auth status; install-managed y onboard-project salen como MANUAL', () => {
  const sp = spies(); const d = repo({ 'README.md': '# x\n', 'package-lock.json': '{}\n' });
  const outs = [go(sp, d), go(sp, d, ['--apply', 'install'])]; commit(d, 'fabrica');
  for (const a of [[], ['--apply', 'deps'], ['--apply', 'hooks'], ['--apply', 'workspace'], ['--apply', 'rsc', '--', '--technical-level', 'technical', '--goal', 'x']]) outs.push(go(sp, d, a));
  const all = outs.map((o) => o.stdout).join('\n');
  assert.match(all, /^MANUAL: sudo bash .*install-managed\.sh --apply/m); assert.match(all, /^MANUAL: bash .*onboard-project\.sh OWNER\/REPO --check-name ci/m);
  assert.doesNotMatch(all, /^(APPLY|\+).*(install-managed|onboard-project)/m);
  const calls = sp.calls();
  assert.deepEqual(calls.filter((c) => /^sudo/.test(c)), [], 'cero llamadas a sudo');
  assert.deepEqual(calls.filter((c) => /^gh /.test(c) && !/^gh auth status$/.test(c)), [], 'gh solo para comprobar la sesion (onboard-project --apply llamaria a gh api)');
  assert.ok(!fs.existsSync('/etc/opencode/opencode.json.init-test'), 'no se toca /etc/opencode');
});

test('argumentos: paso desconocido, opcion rara, destino que no es repo ni existe', () => {
  const sp = spies(); const d = repo();
  assert.equal(go(sp, d, ['--apply', 'sudo']).status, 2); assert.equal(go(sp, d, ['--rara']).status, 2);
  assert.equal(run('bash', [INIT, '--dir', '/no/existe'], { env: sp.env() }).status, 1);
  assert.equal(run('bash', [INIT, '--dir', tmp('af-plain-')], { env: sp.env() }).status, 1);
  fs.mkdirSync(path.join(d, 'sub')); const r = run('bash', [INIT, '--dir', path.join(d, 'sub')], { env: sp.env() }); assert.equal(r.status, 1); assert.match(r.stderr, /raiz del repo/);
});

test('avisa si la instalacion de la fabrica no esta commiteada (la worktree del job saldria sin ella)', () => {
  const sp = spies(); const d = repo({ 'README.md': '# x\n' });
  go(sp, d, ['--apply', 'install']); const r = go(sp, d); assert.match(r.stdout, /^WARN: la instalacion de la fabrica no esta commiteada/m);
  commit(d, 'fabrica'); assert.doesNotMatch(go(sp, d).stdout, /^WARN:/m);
});
