// El Brain separa el metodo (generico) de los requisitos de la propia fabrica: un proyecto que instale la fabrica no hereda estos ultimos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

test('methodology.md es el metodo generico: sin RF-F de la fabrica y apuntando al contexto del proyecto', () => {
  const m = read('02-DOCS/wiki/sdd/methodology.md');
  assert.doesNotMatch(m, /RF-F\d/);
  assert.doesNotMatch(m, /Requisitos funcionales de la fábrica/);
  assert.match(m, /^## 4\. Requisitos funcionales de cada proyecto$/m);
  assert.match(m, /02-DOCS\/wiki\/context\.md/);
});

test('los requisitos de la fabrica (RF-F1..RF-F10) viven en su propia pagina, enlazada desde el indice', () => {
  const p = read('02-DOCS/wiki/sdd/factory-requirements.md');
  for (let i = 1; i <= 10; i++) assert.match(p, new RegExp(`^- \\*\\*RF-F${i}\\*\\* `, 'm'), `falta RF-F${i}`);
  const idx = read('02-DOCS/wiki/index.md');
  assert.match(idx, /`02-DOCS\/wiki\/sdd\/factory-requirements\.md`/);
  assert.ok(fs.existsSync(path.join(REPO, '02-DOCS/wiki/sdd/factory-requirements.md')));
});
