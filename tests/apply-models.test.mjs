import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, run } from './helpers.mjs';

test('apply-models cambia SOLO model: y conserva permission anidado', () => {
  const d = tmp('af-am-');
  write(path.join(d, 'factory/config.json'), JSON.stringify({ tiers: { t: 'prov/new' }, roles: { a: 't' } }));
  const agent = '---\ndescription: x\nmode: subagent\nmodel: prov/old\npermission:\n  edit:\n    "*": deny\n    "a/*": allow\n  webfetch: deny\n---\n\n# Cuerpo\n';
  write(path.join(d, '.opencode/agent/a.md'), agent);
  assert.equal(run('node', [path.join(REPO, 'factory/scripts/apply-models.js')], { cwd: d }).status, 0);
  assert.equal(fs.readFileSync(path.join(d, '.opencode/agent/a.md'), 'utf8'), agent.replace('prov/old', 'prov/new'));
});
test('apply-models --check detecta desajustes y tiers inexistentes', () => {
  const d = tmp('af-am-');
  write(path.join(d, 'factory/config.json'), JSON.stringify({ tiers: { t: 'prov/new' }, roles: { a: 't' } }));
  write(path.join(d, '.opencode/agent/a.md'), '---\nmodel: prov/old\n---\nx\n');
  assert.notEqual(run('node', [path.join(REPO, 'factory/scripts/apply-models.js'), '--check'], { cwd: d }).status, 0);
  write(path.join(d, 'factory/config.json'), JSON.stringify({ tiers: {}, roles: { a: 'zzz' } }));
  assert.notEqual(run('node', [path.join(REPO, 'factory/scripts/apply-models.js')], { cwd: d }).status, 0);
});
// Los seis agentes de /factory-init (rama 4) llegan sin rol: sus roles van en un PARCHE a factory/config.json (archivo solo del humano).
// Se salta, con motivo, solo si faltan los seis; si faltan algunos (parche a medias) el test corre y falla.
const NEW_AGENTS = ['discovery', 'system-analyst', 'domain-modeler', 'architect', 'deployment-planner', 'consistency-auditor'];
const roles = JSON.parse(fs.readFileSync(path.join(REPO, 'factory/config.json'), 'utf8')).roles;
const noRoles = NEW_AGENTS.filter((a) => !(a in roles)).length === NEW_AGENTS.length;
test('los agentes reales de este repo coinciden con config.json', { skip: noRoles ? 'falta aplicar docs/propuestas/rama4-factory-init.patch (roles de los seis agentes de /factory-init en factory/config.json)' : false }, () => {
  assert.equal(run('node', [path.join(REPO, 'factory/scripts/apply-models.js'), '--check'], { cwd: REPO }).status, 0);
});
