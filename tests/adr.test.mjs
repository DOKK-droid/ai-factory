// Consistencia del registro de ADR (02-DOCS/wiki/sdd/decisions.md) y de su indice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const text = fs.readFileSync(path.join(REPO, '02-DOCS/wiki/sdd/decisions.md'), 'utf8');
const blocks = [...text.matchAll(/^## ADR-(\d+): (.+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)].map((m) => ({ n: +m[1], title: m[2], body: m[3] }));
const estado = (b) => (b.body.match(/^Estado:\s*(.+)$/m) || [])[1];

test('hay ADR y estan numerados 1..N sin huecos ni repetidos', () => {
  assert.ok(blocks.length >= 10, `solo ${blocks.length} ADR`);
  assert.deepEqual(blocks.map((b) => b.n), blocks.map((_, i) => i + 1));
});
test('cada ADR tiene Fecha y un Estado de los conocidos', () => {
  for (const b of blocks) {
    assert.match(b.body, /^Fecha:\s*\d{4}-\d{2}-\d{2}/m, `ADR-${b.n} sin Fecha`);
    assert.match(estado(b) || '', /^(Aprobado|Propuesto|Provisional|Parcial|Inconcluso|Reemplazado)\b/, `ADR-${b.n}: Estado "${estado(b)}"`);
  }
});
test('"Reemplazado por ADR-N" apunta a un ADR que existe y es posterior', () => {
  for (const b of blocks.filter((x) => /^Reemplazado/.test(estado(x)))) {
    const ref = (estado(b).match(/ADR-(\d+)/) || [])[1];
    if (/parche 5/.test(estado(b)) && !ref) continue;   // ADR-007 se reemplazo por un parche, no por otro ADR
    assert.ok(ref, `ADR-${b.n} dice Reemplazado sin indicar por cual`);
    assert.ok(+ref > b.n && blocks.some((x) => x.n === +ref), `ADR-${b.n} -> ADR-${ref}`);
  }
});
test('los ADR abiertos (Provisional, Parcial, Inconcluso) explican que falta', () => {
  for (const b of blocks.filter((x) => /^(Provisional|Parcial|Inconcluso)/.test(estado(x)))) assert.ok(estado(b).length > 30, `ADR-${b.n}: estado sin motivo`);
});
test('el indice del Brain cita el rango real de ADR', () => {
  const idx = fs.readFileSync(path.join(REPO, '02-DOCS/wiki/index.md'), 'utf8');
  assert.match(idx, new RegExp(`ADR-001 a ADR-${String(blocks.length).padStart(3, '0')}`));
});
