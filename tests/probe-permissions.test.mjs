import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { extractJson, decide, runProbes, unmask } from '../factory/scripts/probe-permissions.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const managed = JSON.parse(fs.readFileSync(path.join(ROOT, 'factory/templates/managed-opencode.json'), 'utf8'));
const project = JSON.parse(fs.readFileSync(path.join(ROOT, 'opencode.json'), 'utf8'));
const fails = (cfg) => runProbes(cfg).filter((r) => !r.ok).map((r) => `${r.value} -> ${r.got} (esperado ${r.expect})`);

// Fusion tipo JS: las claves conservan la posicion de su PRIMERA aparicion y el valor lo pone el ultimo (managed gana).
const merge = (a, b) => {
  const out = { permission: {} };
  for (const t of new Set([...Object.keys(a.permission), ...Object.keys(b.permission)])) {
    out.permission[t] = { ...(a.permission[t] || {}), ...(b.permission[t] || {}) };
  }
  return out;
};

// La plantilla managed solo restringe: no concede `gh pr create` (lo concede el opencode.json del proyecto).
test('la plantilla managed sola cumple la politica (salvo lo que concede el proyecto)', () => {
  assert.deepEqual(fails(managed).filter((f) => !f.startsWith('gh pr create')), []);
});
test('el opencode.json del proyecto solo (sin managed) cumple la politica', () => assert.deepEqual(fails(project), []));
test('proyecto + managed fusionados (en cualquier orden de fusion) cumplen la politica', () => {
  assert.deepEqual(fails(merge(project, managed)), [], 'proyecto primero');
  assert.deepEqual(fails(merge(managed, project)), [], 'managed primero');
});

test('detecta el orden roto: un deny generico DESPUES del allow de factory/* niega el push legitimo', () => {
  const broken = { permission: { bash: { 'git push -u origin factory/*': 'allow', 'git push *': 'deny' }, read: { '*': 'allow' } } };
  assert.ok(fails(broken).some((f) => f.startsWith('git push -u origin factory/job-1')));
});

test('detecta un hueco: sin deny, el push a main queda en ask (y --auto lo aprobaria)', () => {
  const hole = { permission: { bash: { 'git push -u origin factory/*': 'allow' } } };
  assert.ok(fails(hole).some((f) => f.startsWith('git push origin main -> ask')));
});

test('decide: gana la ultima regla; sin regla es ask', () => {
  assert.equal(decide({ 'a*': 'deny', 'ab*': 'allow' }, 'abc'), 'allow');
  assert.equal(decide({ 'ab*': 'allow', 'a*': 'deny' }, 'abc'), 'deny');
  assert.equal(decide({ x: 'allow' }, 'y'), 'ask');
  assert.equal(decide('deny', 'z'), 'deny');
});

test('extractJson tolera ANSI y texto alrededor', () => {
  const obj = { permission: { bash: { '*': 'ask' } }, note: 'a } { b' };
  assert.deepEqual(extractJson('\x1b[32mlog\x1b[0m\n' + JSON.stringify(obj, null, 2) + '\nfin'), obj);
  assert.equal(extractJson('sin json'), null);
});

test('CLI: sale 0 con politica buena, 1 con mala, 3 sin JSON', () => {
  const run = (input) => spawnSync('node', [path.join(ROOT, 'factory/scripts/probe-permissions.mjs')], { input, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } });
  assert.equal(run(JSON.stringify(merge(project, managed))).status, 0);
  assert.equal(run(JSON.stringify({ permission: { bash: { '*': 'allow' }, read: { '*': 'allow' } } })).status, 1);
  assert.equal(run('nada').status, 3);
});

// Forma REAL de `opencode debug config | ...`: permission raiz al principio, `agent.*.permission` despues,
// y la salida truncada a 64 KiB (cadena sin cerrar) => el documento completo NO es JSON valido.
const rootPerm = { bash: { '*': 'ask', 'git push -u origin factory/*': 'allow', 'git push *': 'deny' }, read: { '*': 'allow', '*.env': 'deny' } };
const realShape = (nested) => {
  const head = JSON.stringify({ $schema: 'x', permission: rootPerm }, null, 2).replace(/\n}$/, '');
  const agent = JSON.stringify({ x: { name: 'x', permission: nested } }, null, 2).replace(/^/gm, '  ');
  return `${head},\n  "agent": ${agent.trim()},\n  "provider": {\n    "p": { "name": "cortado en medio de una cade`;
};
const nestedOnly = { edit: { '*': 'deny' }, bash: { '*': 'deny' } };

test('extractJson elige el permission RAIZ aunque haya uno anidado antes y el JSON global este roto', () => {
  const raw = '\x1b[32mlog\x1b[0m\n' + realShape(nestedOnly);
  assert.throws(() => JSON.parse(raw.slice(raw.indexOf('{'))));
  assert.deepEqual(extractJson(raw).permission, rootPerm);
  assert.deepEqual(extractJson(realShape(nestedOnly)).permission, rootPerm);
});

test('extractJson: el permission anidado antes del raiz no gana', () => {
  const raw = '{\n  "agent": {"a": {"permission": {"bash": {"*": "deny"}}}},\n  "permission": ' + JSON.stringify(rootPerm) + ',\n  "z": "sin cerrar';
  assert.deepEqual(extractJson(raw).permission, rootPerm);
});

test('extractJson: sin permission raiz devuelve null (un anidado no cuenta)', () => {
  assert.equal(extractJson('{"agent": {"a": {"permission": {"bash": {"*": "deny"}}}}, "z": "cortado'), null);
});

test('decide acepta la forma lista [{permission, pattern, action}] con la regla de la ultima', () => {
  const list = [
    { permission: 'bash', pattern: '*', action: 'deny' },
    { permission: 'read', pattern: '*', action: 'allow' },
    { permission: 'bash', pattern: 'git push -u origin factory/*', action: 'allow' },
  ];
  assert.equal(decide(list, 'git push -u origin factory/a', 'bash'), 'allow');
  assert.equal(decide(list, 'rm x', 'bash'), 'deny');
  assert.equal(decide(list, 'src/a', 'read'), 'allow');
  assert.equal(decide(list, 'x', 'edit'), 'ask');
});

test('runProbes con permission en forma lista', () => {
  const cfg = { permission: [{ permission: 'bash', pattern: '*', action: 'ask' }, { permission: 'read', pattern: '*', action: 'allow' }] };
  assert.equal(runProbes(cfg).find((r) => r.value === 'src/app.js').got, 'allow');
});

test('CLI: salida real (ANSI, truncada, permission anidado primero) se lee del raiz; sin bash/read sale 3', () => {
  const run = (input) => spawnSync('node', [path.join(ROOT, 'factory/scripts/probe-permissions.mjs')], { input, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } });
  const good = JSON.stringify(merge(project, managed), null, 2).replace(/\n}$/, '');
  const r = run('\x1b[2mcfg\x1b[0m\n' + good + ',\n  "agent": {"x": {"permission": {"bash": {"*": "deny"}}}},\n  "provider": {"p": "cortada');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!/\bask\b/.test(r.stdout.split('\n').filter((l) => l.startsWith('OK')).join('\n')));
  const noBash = run(JSON.stringify({ permission: { read: { '*': 'allow' } } }));
  assert.equal(noBash.status, 3);
  assert.match(noBash.stderr, /permission\.bash/);
  const noRead = run(JSON.stringify({ permission: { bash: { '*': 'allow' }, read: {} } }));
  assert.equal(noRead.status, 3);
  assert.match(noRead.stderr, /permission\.read/);
});

test('unmask: resuelve "***" desde las fuentes (la ultima gana) y deja lo que nadie declara', () => {
  const perm = { bash: { 'gh secret *': '***', 'otra *': '***', 'git push': 'deny' } };
  const done = unmask(perm, [{ permission: { bash: { 'gh secret *': 'allow' } } }, { permission: { bash: { 'gh secret *': 'deny' } } }]);
  assert.equal(perm.bash['gh secret *'], 'deny');
  assert.equal(perm.bash['otra *'], '***');
  assert.equal(done.length, 1);
  assert.ok(runProbes({ permission: { bash: { 'gh secret *': '***' }, read: { '*': 'allow' } } }).find((r) => r.value === 'gh secret list').ok === false);
});
