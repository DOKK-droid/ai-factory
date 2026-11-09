// consistency-auditor: no abre el codigo del linter ni las plantillas (medido: 20-27 % de lo que leia cada pasada).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const md = fs.readFileSync(path.join(REPO, '.opencode/agent/consistency-auditor.md'), 'utf8');
const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
const readBlock = (fm.match(/^  read:\n((?:    .+\n)+)/m) || [])[1] || '';
const rules = [...readBlock.matchAll(/^    "([^"]+)":\s*(\w+)/gm)].map((m) => [m[1], m[2]]);
const last = (target) => { let r; for (const [p, a] of rules) if (p === '*' || target.endsWith(p.replace(/^\*/, '').replace(/\*$/, '')) || (p.endsWith('/*') && target.includes(p.replace(/^\*/, '').replace(/\*$/, '')))) r = a; return r; };

test('el auditor tiene reglas read explicitas y el comodin va primero (gana la ultima que calza)', () => {
  assert.ok(rules.length >= 2, 'sin bloque read');
  assert.equal(rules[0][0], '*');
});
test('no puede leer project-lint.mjs ni factory/templates/', () => {
  assert.equal(last('/x/factory/scripts/project-lint.mjs'), 'deny');
  assert.equal(last('/x/factory/templates/project/00-vision.md'), 'deny');
});
test('sigue pudiendo leer los documentos del proyecto y mantiene el deny de .env', () => {
  assert.equal(last('/x/factory/worktrees/j/02-DOCS/wiki/project/00-vision.md'), 'allow');
  assert.ok(rules.some(([p, a]) => p === '*.env' && a === 'deny'));
});
test('el prompt le dice que la salida del linter es la autoridad y que no abra esos archivos', () => {
  assert.match(md, /no abras\*\* `factory\/scripts\/project-lint\.mjs`/);
});
test('sigue sin poder escribir y sin aprobar', () => {
  assert.match(fm, /^  edit: deny$/m);
  assert.match(fm, /project-lint\.mjs\*approve\*": deny/);
});
