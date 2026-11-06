// rsc-pin.sh: RSC fijado a factory/rsc-pin.json con knowledge-sync y auto-update apagados. Todo con un `npx`/`npm` simulados (tests/rsc-fake.mjs):
// sin red y sin instalar nada. La prueba en vivo contra el paquete real solo corre con FACTORY_LIVE_RSC=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, git, run } from './helpers.mjs';
import { fakeBin, PIN, PLAN } from './rsc-fake.mjs';

const PINSH = path.join(REPO, 'factory/scripts/rsc-pin.sh');
const INSTALL = path.join(REPO, 'factory/scripts/install-into.sh');
const ANSWERS = ['--technical-level', 'technical', '--goal', 'proyecto de prueba'];

function dest(files = { 'README.md': '# proyecto\n' }) {
  const d = tmp('af-pin-');
  git(d, 'init', '-q', '-b', 'main'); git(d, 'config', 'user.email', 't@t.t'); git(d, 'config', 'user.name', 't'); git(d, 'config', 'commit.gpgsign', 'false');
  for (const [f, t] of Object.entries(files)) write(path.join(d, f), t);
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base');
  return d;
}
const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');
const exists = (d, f) => fs.existsSync(path.join(d, f));
const manifest = (d) => JSON.parse(read(d, '.rsc.json'));
const pin = (bin, d, args = [], env = {}, script = PINSH) => run('bash', [script, '--dir', d, ...args], { env: bin.env(env) });
const commit = (d, msg = 'c') => { git(d, 'add', '-A'); git(d, 'commit', '-qm', msg); };
/** Instala RSC con el simulador en las dos pasadas que exige (plan y aceptacion). */
function installRsc(bin, d, env = {}) {
  const first = pin(bin, d, ['--apply', ...ANSWERS], env); assert.equal(first.status, 3, first.stdout + first.stderr);
  assert.match(first.stdout, new RegExp(`--accept-plan ${PLAN}`)); assert.ok(!exists(d, '.rsc.json'), 'la primera pasada no escribe');
  return pin(bin, d, ['--apply', ...ANSWERS, '--accept-plan', PLAN], env);
}
const FACTORY_PUSH_DENY = (d) => JSON.parse(read(d, 'opencode.json')).permission.bash['git push'];

test('rsc-pin.json: version exacta 3.6.0 e integridad sha512 fijadas', () => {
  assert.equal(PIN.version, '3.6.0');
  assert.equal(PIN.integrity, 'sha512-o4rEaT24AQfYLjFbRSqgw6oBH3bO2kg++X7xBP2K4XB6JmFumllwsWdwq4v9DtE03OQ+jXIJXEsfVGpXTJyXtg==');
  assert.deepEqual(Object.keys(PIN).sort(), ['integrity', 'version']);
});

test('dry-run por defecto: imprime las ordenes con la version fijada y no ejecuta ni escribe nada', () => {
  const bin = fakeBin(); const d = dest(); const before = git(d, 'status', '--porcelain');
  const r = pin(bin, d, ANSWERS); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\] .*npx --yes @ericrisco\/rsc@3\.6\.0 onboard/); assert.match(r.stdout, /dry-run: no se cambio nada/);
  assert.doesNotMatch(r.stdout, /@latest/);
  assert.deepEqual(bin.calls(), [], 'ni npx ni npm'); assert.equal(git(d, 'status', '--porcelain'), before);
  // con RSC ya instalado, igual
  assert.equal(installRsc(bin, d).status, 0); commit(d); const n = bin.calls().length;
  fs.rmSync(path.join(d, '.rsc/.no-auto-update'));
  const r2 = pin(bin, d); assert.equal(r2.status, 0, r2.stderr); assert.match(r2.stdout, /\[dry-run\] .*knowledge-sync off/);
  assert.equal(bin.calls().length, n); assert.ok(!exists(d, '.rsc/.no-auto-update'));
});

test('sin RSC: --apply sin respuestas del humano se niega (exit 2) y no llama a nada', () => {
  const bin = fakeBin(); const d = dest();
  const r = pin(bin, d, ['--apply']); assert.equal(r.status, 2); assert.match(r.stderr, /respuestas del humano/);
  assert.deepEqual(bin.calls(), []); assert.ok(!exists(d, '.rsc.json'));
  assert.equal(pin(bin, d, ['--apply', '--technical-level', 'technical']).status, 2, 'falta el objetivo');
});

test('primera pasada: muestra el plan, no escribe y sale 3; solo la segunda, con el id del plan, instala', () => {
  const bin = fakeBin(); const d = dest();
  const r = pin(bin, d, ['--apply', ...ANSWERS]); assert.equal(r.status, 3);
  assert.match(r.stdout, /PENDIENTE: .*--accept-plan ab{1}/); assert.ok(!exists(d, '.rsc.json') && !exists(d, '.rsc'));
  assert.equal(pin(bin, d, ['--apply', ...ANSWERS, '--accept-plan', 'no-es-un-hash']).status, 2);
  const ok = pin(bin, d, ['--apply', ...ANSWERS, '--accept-plan', PLAN]); assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.ok(exists(d, '.rsc.json'));
});

test('RSC primero, fabrica despues: RSC instalado, sync y auto-update apagados, AGENTS.md respetado', () => {
  const bin = fakeBin(); const d = dest({ 'README.md': 'x\n', 'AGENTS.md': '# Mis reglas previas\n' });
  const r = installRsc(bin, d); assert.equal(r.status, 0, r.stdout + r.stderr);
  const m = manifest(d); assert.ok(m.optOuts.includes('knowledge-sync') && m.optOuts.includes('auto-update'), JSON.stringify(m.optOuts));
  assert.equal(m.gitPermissions, false); assert.equal(m.catalogVersion, '3.6.0');
  assert.ok(exists(d, '.rsc/.no-knowledge-sync') && exists(d, '.rsc/.no-auto-update'));
  assert.ok(read(d, 'AGENTS.md').startsWith('# Mis reglas previas'), 'el texto previo sobrevive'); assert.match(read(d, 'AGENTS.md'), /rsc-suggest:start/);
  commit(d, 'rsc');
  const inst = run('bash', [INSTALL, d, '--apply', '--force'], { env: bin.env() }); assert.equal(inst.status, 0, inst.stdout + inst.stderr);
  assert.match(inst.stdout, /RSC ya instalado en el destino/);
  assert.ok(read(d, 'AGENTS.md').startsWith('# Mis reglas previas') && /rsc-suggest:start/.test(read(d, 'AGENTS.md')), 'AGENTS.md del destino intacto');
  assert.match(read(d, 'AGENTS.factory.md'), /Pipeline/);
  assert.equal(FACTORY_PUSH_DENY(d), 'deny', 'los permisos de la fabrica mandan');
  assert.ok(manifest(d).optOuts.includes('auto-update'));
  assert.equal(pin(bin, d, ['--check']).status, 0); assert.equal(run('bash', [INSTALL, d, '--check'], { env: bin.env() }).status, 0);
});

test('fabrica primero, RSC despues: AGENTS.md de la fabrica y opencode.json intactos, sync y auto-update apagados', () => {
  const bin = fakeBin(); const d = dest();
  assert.equal(run('bash', [INSTALL, d, '--apply'], { env: bin.env() }).status, 0); commit(d, 'fabrica');
  const agents = read(d, 'AGENTS.md'); const oc = read(d, 'opencode.json'); assert.deepEqual(bin.calls(), [], 'sin RSC, instalar la fabrica no llama a npx');
  const r = installRsc(bin, d); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RSC reescribio opencode\.json; se restauro/);
  assert.equal(read(d, 'opencode.json'), oc); assert.equal(FACTORY_PUSH_DENY(d), 'deny');
  assert.ok(read(d, 'AGENTS.md').startsWith(agents.trimEnd()), 'la fabrica sigue entera'); assert.match(read(d, 'AGENTS.md'), /rsc-suggest:end/);
  const m = manifest(d); assert.ok(m.optOuts.includes('knowledge-sync') && m.optOuts.includes('auto-update') && m.gitPermissions === false);
  assert.equal(pin(bin, d, ['--check']).status, 0, 'el estado queda en orden');
  assert.equal(run('bash', [INSTALL, d, '--check'], { env: bin.env() }).status, 0);
});

test('idempotente: la segunda pasada no ejecuta nada ni cambia ningun archivo', () => {
  const bin = fakeBin(); const d = dest(); assert.equal(installRsc(bin, d).status, 0); commit(d);
  const n = bin.calls().length; const before = ['.rsc.json', 'AGENTS.md'].map((f) => read(d, f));
  const r = pin(bin, d, ['--apply']); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /DONE: ya esta en orden/);
  assert.equal(bin.calls().length, n, 'cero llamadas nuevas'); assert.deepEqual(['.rsc.json', 'AGENTS.md'].map((f) => read(d, f)), before);
  assert.equal(git(d, 'status', '--porcelain'), '');
});

test('todas las llamadas usan la version del pin, nunca @latest; si el pin cambia, cambian las llamadas', () => {
  const bin = fakeBin(); const d = dest(); assert.equal(installRsc(bin, d).status, 0);
  const calls = bin.calls(); assert.ok(calls.some((c) => c.startsWith('npx')) && calls.some((c) => c.startsWith('npm view')));
  for (const c of calls) { assert.doesNotMatch(c, /latest/); assert.match(c, /@ericrisco\/rsc@3\.6\.0( |$)/); }
  // una copia del script con otro pin: lee el pin, no lo lleva escrito
  const f = tmp('af-fac-'); fs.mkdirSync(path.join(f, 'factory/scripts'), { recursive: true });
  fs.copyFileSync(PINSH, path.join(f, 'factory/scripts/rsc-pin.sh'));
  write(path.join(f, 'factory/rsc-pin.json'), JSON.stringify({ version: '3.6.1', integrity: PIN.integrity }));
  const bin2 = fakeBin(); const e = dest();
  const r = pin(bin2, e, ['--apply', ...ANSWERS], { FAKE_INTEGRITY: PIN.integrity }, path.join(f, 'factory/scripts/rsc-pin.sh')); assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.ok(bin2.calls().every((c) => !c.includes('3.6.0') && c.includes('rsc@3.6.1')), bin2.calls().join('\n'));
});

test('un pin invalido (etiqueta en vez de version, integridad que no es sha512) se rechaza antes de llamar a nada', () => {
  for (const bad of [{ version: 'latest', integrity: PIN.integrity }, { version: '3', integrity: PIN.integrity }, { version: '3.6.0', integrity: 'md5-abc' }, { version: '3.6.0' }]) {
    const f = tmp('af-fac-'); fs.mkdirSync(path.join(f, 'factory/scripts'), { recursive: true });
    fs.copyFileSync(PINSH, path.join(f, 'factory/scripts/rsc-pin.sh')); write(path.join(f, 'factory/rsc-pin.json'), JSON.stringify(bad));
    const bin = fakeBin(); const r = pin(bin, dest(), ['--apply', ...ANSWERS], {}, path.join(f, 'factory/scripts/rsc-pin.sh'));
    assert.equal(r.status, 1, JSON.stringify(bad)); assert.deepEqual(bin.calls(), []);
  }
});

test('si la integridad del registro no coincide con el pin no se ejecuta nada del paquete', () => {
  const bin = fakeBin(); const d = dest();
  const r = pin(bin, d, ['--apply', ...ANSWERS], { FAKE_INTEGRITY: 'sha512-otra' });
  assert.equal(r.status, 1); assert.match(r.stderr, /integridad .* no coincide/);
  assert.deepEqual(bin.calls().filter((c) => c.startsWith('npx')), [], 'ningun npx'); assert.ok(!exists(d, '.rsc.json'));
  const none = fakeBin(); const r2 = pin(none, d, ['--apply', ...ANSWERS], { FAKE_INTEGRITY: '' }); assert.equal(r2.status, 1, 'sin respuesta del registro tambien falla');
});

test('si sync no registra auto-update, falla (la comprobacion es sobre .rsc.json, no un supuesto)', () => {
  const bin = fakeBin(); const d = dest();
  const r = installRsc(bin, d, { FAKE_SYNC_NO_AUTOUPDATE: '1' });
  assert.equal(r.status, 1, r.stdout); assert.match(r.stdout + r.stderr, /falta el optOut auto-update/);
});

test('si RSC pisa el AGENTS.md existente, falla en vez de darlo por bueno', () => {
  const bin = fakeBin(); const d = dest({ 'README.md': 'x\n', 'AGENTS.md': '# Mis reglas previas\n' });
  const r = installRsc(bin, d, { FAKE_CLOBBER_AGENTS: '1' }); assert.equal(r.status, 1); assert.match(r.stderr, /AGENTS\.md ya no contiene/);
});

test('una version instalada distinta de la fijada no se arregla sola: se para sin ejecutar sync', () => {
  const bin = fakeBin(); const d = dest(); assert.equal(installRsc(bin, d).status, 0);
  const m = manifest(d); m.catalogVersion = '3.7.5'; write(path.join(d, '.rsc.json'), JSON.stringify(m)); const n = bin.calls().length;
  const r = pin(bin, d, ['--apply']); assert.equal(r.status, 1); assert.match(r.stderr, /otra version de RSC/); assert.equal(bin.calls().length, n);
  assert.equal(pin(bin, d, ['--check']).status, 1);
});

test('--check: sin RSC sale 0 (es opcional) y sin red; con RSC exige version, los dos optOuts, gitPermissions=false y git push: deny', () => {
  const bin = fakeBin(); const d = dest();
  let r = pin(bin, d, ['--check']); assert.equal(r.status, 0); assert.match(r.stdout, /RSC no instalado/);
  assert.equal(run('bash', [INSTALL, d, '--apply'], { env: bin.env() }).status, 0); commit(d);
  assert.equal(installRsc(bin, d).status, 0); const n = bin.calls().length;
  r = pin(bin, d, ['--check']); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /^OK: RSC 3\.6\.0 fijado/m);
  const base = manifest(d); const put = (m) => write(path.join(d, '.rsc.json'), JSON.stringify(m));
  put({ ...base, optOuts: base.optOuts.filter((o) => o !== 'auto-update') }); r = pin(bin, d, ['--check']); assert.equal(r.status, 1); assert.match(r.stdout, /falta el optOut auto-update/);
  put({ ...base, optOuts: base.optOuts.filter((o) => o !== 'knowledge-sync') }); r = pin(bin, d, ['--check']); assert.equal(r.status, 1); assert.match(r.stdout, /falta el optOut knowledge-sync/);
  put({ ...base, gitPermissions: true }); r = pin(bin, d, ['--check']); assert.equal(r.status, 1); assert.match(r.stdout, /gitPermissions no es false/);
  put({ ...base, catalogVersion: '3.7.5' }); r = pin(bin, d, ['--check']); assert.equal(r.status, 1); assert.match(r.stdout, /catalogVersion no es la fijada/);
  put(base); const oc = JSON.parse(read(d, 'opencode.json')); oc.permission.bash['git push'] = 'allow'; write(path.join(d, 'opencode.json'), JSON.stringify(oc));
  r = pin(bin, d, ['--check']); assert.equal(r.status, 1); assert.match(r.stdout, /falta la regla "git push": "deny"/);
  write(path.join(d, '.rsc.json'), '{ no es json'); assert.equal(pin(bin, d, ['--check']).status, 1);
  assert.equal(bin.calls().length, n, '--check no llama a npx ni a npm');
});

test('--check: sin los marcadores locales es un aviso, no un error (se reconstruyen al clonar)', () => {
  const bin = fakeBin(); const d = dest(); assert.equal(installRsc(bin, d).status, 0);
  fs.rmSync(path.join(d, '.rsc/.no-auto-update')); fs.rmSync(path.join(d, '.rsc/.no-knowledge-sync'));
  const r = pin(bin, d, ['--check']); assert.equal(r.status, 0); assert.match(r.stdout, /AVISO: .*no-auto-update/); assert.match(r.stdout, /AVISO: .*no-knowledge-sync/);
  const fix = pin(bin, d, ['--apply']); assert.equal(fix.status, 0, fix.stdout + fix.stderr); assert.ok(exists(d, '.rsc/.no-auto-update'));
});

test('argumentos: --check y --apply no se combinan; opciones raras y destinos inexistentes fallan', () => {
  const bin = fakeBin(); const d = dest();
  assert.equal(pin(bin, d, ['--check', '--apply']).status, 2); assert.equal(pin(bin, d, ['--rara']).status, 2);
  assert.equal(run('bash', [PINSH, '--dir', '/no/existe'], { env: bin.env() }).status, 1); assert.deepEqual(bin.calls(), []);
});

// ---------------------------------------------------------------------------------------------------------
// Integracion con install-into.sh
// ---------------------------------------------------------------------------------------------------------
test('install-into: rsc-pin.json viaja con la maquinaria y el dry-run muestra el plan de RSC sin llamar a nada', () => {
  const bin = fakeBin(); const d = dest();
  const rows = run('bash', [INSTALL, '--list']).stdout.split('\n'); assert.ok(rows.includes('copy\tfactory/rsc-pin.json'));
  const r = run('bash', [INSTALL, d], { env: bin.env() }); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /== RSC fijado \(rsc-pin\.sh, dry-run\) ==/); assert.match(r.stdout, /rsc@3\.6\.0/); assert.doesNotMatch(r.stdout, /@latest/);
  assert.deepEqual(bin.calls(), []); assert.equal(git(d, 'status', '--porcelain'), '');
  assert.equal(run('bash', [INSTALL, d, '--apply'], { env: bin.env() }).status, 0);
  assert.deepEqual(JSON.parse(read(d, 'factory/rsc-pin.json')), PIN); assert.ok(fs.statSync(path.join(d, 'factory/scripts/rsc-pin.sh')).mode & 0o111);
});

test('install-into --apply sin RSC no lo instala: imprime el comando (con respuestas a cargo del humano)', () => {
  const bin = fakeBin(); const d = dest(); const r = run('bash', [INSTALL, d, '--apply'], { env: bin.env() });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /RSC es opcional/); assert.match(r.stdout, /rsc-pin\.sh --dir .* --apply --technical-level/);
  assert.deepEqual(bin.calls(), []); assert.ok(!exists(d, '.rsc.json'));
});

test('install-into --check falla si el RSC del destino perdio un apagado; --apply con RSC y pin fallido deja la maquinaria pero sale 1', () => {
  const bin = fakeBin(); const d = dest(); assert.equal(installRsc(bin, d).status, 0); commit(d);
  fs.rmSync(path.join(d, '.rsc/.no-auto-update'));   // fuera de orden: rsc-pin tiene que ir al registro, y el registro miente
  const inst = run('bash', [INSTALL, d, '--apply', '--force'], { env: bin.env({ FAKE_INTEGRITY: 'sha512-otra' }) });
  assert.equal(inst.status, 1); assert.match(inst.stderr, /maquinaria quedo instalada, pero rsc-pin\.sh fallo/); assert.ok(exists(d, '01-TOOLS/next-step.sh'));
  commit(d, 'fabrica'); const m = manifest(d); write(path.join(d, '.rsc.json'), JSON.stringify({ ...m, optOuts: [] }));
  const c = run('bash', [INSTALL, d, '--check'], { env: bin.env() }); assert.equal(c.status, 1); assert.match(c.stdout, /FALTA\/DIFIERE: RSC: .*falta el optOut/);
});

// ---------------------------------------------------------------------------------------------------------
// En vivo (red y paquete real): FACTORY_LIVE_RSC=1
// ---------------------------------------------------------------------------------------------------------
test('en vivo: RSC real fijado a la version del pin, sync apagado, AGENTS.md previo y opencode.json de la fabrica intactos', {
  skip: process.env.FACTORY_LIVE_RSC === '1' ? false : 'FACTORY_LIVE_RSC=1 no esta definido (prueba en vivo: usa red y npx @ericrisco/rsc real)', timeout: 600000,
}, () => {
  const d = dest({ 'README.md': 'x\n', 'AGENTS.md': '# Mis reglas previas\n' });
  assert.equal(run('bash', [INSTALL, d, '--apply', '--force']).status, 0); commit(d, 'fabrica');
  const oc = read(d, 'opencode.json'); const env = { ...process.env };
  const first = run('bash', [PINSH, '--dir', d, '--apply', ...ANSWERS], { env }); assert.equal(first.status, 3, first.stdout + first.stderr);
  const id = first.stdout.match(/--accept-plan ([0-9a-f]{64})/)[1];
  const r = run('bash', [PINSH, '--dir', d, '--apply', ...ANSWERS, '--accept-plan', id], { env }); assert.equal(r.status, 0, r.stdout + r.stderr);
  const m = manifest(d); assert.equal(m.catalogVersion, PIN.version); assert.ok(m.optOuts.includes('knowledge-sync') && m.optOuts.includes('auto-update'), JSON.stringify(m.optOuts));
  assert.equal(read(d, 'opencode.json'), oc); assert.ok(read(d, 'AGENTS.md').startsWith('# Mis reglas previas') && /rsc-suggest:start/.test(read(d, 'AGENTS.md')));
  assert.equal(run('bash', [PINSH, '--dir', d, '--check']).status, 0);
});
