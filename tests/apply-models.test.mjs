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
test('los agentes reales de este repo coinciden con config.json', () => {
  assert.equal(run('node', [path.join(REPO, 'factory/scripts/apply-models.js'), '--check'], { cwd: REPO }).status, 0);
});
