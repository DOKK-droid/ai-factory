import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { extractJson, decide, runProbes } from '../factory/scripts/probe-permissions.mjs';

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
  assert.equal(run(JSON.stringify({ permission: { bash: { '*': 'allow' } } })).status, 1);
  assert.equal(run('nada').status, 3);
});
