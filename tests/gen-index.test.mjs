// gen-index.mjs: index.md GENERADO, determinista (sin mtime ni orden de creacion) y sin editar a mano.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, run } from './helpers.mjs';
import { describe, generate } from '../factory/scripts/gen-index.mjs';

const GEN = path.join(REPO, 'factory/scripts/gen-index.mjs');
const cli = (cwd, ...a) => run('node', [GEN, ...a], { cwd });
const wiki = (pages) => { const d = tmp('af-idx-'); for (const [f, t] of Object.entries(pages)) write(path.join(d, '02-DOCS/wiki', f), t); return d; };
const PAGES = {
  'sdd/constitution.md': '---\ntitle: Constitución\ndescription: Principios no negociables\n---\n# Otro título\nTexto.\n',
  'sdd/methodology.md': '# Metodología\n\n> aviso\n\nCómo se recorre un trabajo. Segunda frase.\n',
  'project/01-requisitos.md': '---\ndocumento: 01-requisitos\nestado: borrador\n---\n\n# Requisitos\n\n## Sección\nLista de requisitos | con barra.\n',
  'jobs/uno-261101-aaaa.md': '# Job uno\nPrimer job.\n',
  'jobs/dos-261105-bbbb.md': '# Job dos\nSegundo job.\n',
  'jobs/tres-261103-cccc.md': '# Job tres\nTercer job.\n',
};

test('RF-I6: describe usa title/description de la cabecera y, si no, el primer # y la primera frase', () => {
  assert.deepEqual(describe(PAGES['sdd/constitution.md']), { title: 'Constitución', what: 'Principios no negociables' });
  assert.deepEqual(describe(PAGES['sdd/methodology.md']), { title: 'Metodología', what: 'Cómo se recorre un trabajo.' });
  assert.equal(describe(PAGES['project/01-requisitos.md']).title, 'Requisitos');
  assert.match(describe(PAGES['project/01-requisitos.md']).what, /Lista de requisitos \\\| con barra/);   // la barra no rompe la tabla
});
test('RF-I6: una barra invertida antes de | no deja escapar la barra de columna (escapa \\ y luego |)', () => {
  // `a\|b` sin escapar la \ daria `a\\|b`: la \\ es una barra literal y la | parte la fila en otra columna
  assert.equal(describe('# T\n\nUsa a\\|b aqui.\n').what, 'Usa a\\\\\\|b aqui.');
  assert.equal(describe('# T\\\n\nTexto.\n').title, 'T\\\\');
});

test('RF-I6: --write genera el índice: mapa por ruta y jobs de más reciente a más antigua', () => {
  const d = wiki(PAGES); assert.equal(cli(d, '--write').status, 0);
  const idx = fs.readFileSync(path.join(d, '02-DOCS/wiki/index.md'), 'utf8');
  assert.match(idx, /^# 02-DOCS\/wiki\/index\.md/); assert.match(idx, /No lo edites a mano/);
  const order = (re) => idx.search(re);
  assert.ok(order(/project\/01-requisitos/) < order(/sdd\/constitution/) && order(/sdd\/constitution/) < order(/sdd\/methodology/));
  assert.ok(order(/jobs\/dos-261105/) < order(/jobs\/tres-261103/) && order(/jobs\/tres-261103/) < order(/jobs\/uno-261101/));
  assert.match(idx, /\| Constitución \| `02-DOCS\/wiki\/sdd\/constitution\.md` \| Principios no negociables \|/);
  assert.doesNotMatch(idx, /\| index/);   // no se lista a sí mismo
});
test('RF-I6: es determinista; no depende del orden de creación ni de mtime (dos jobs concurrentes no chocan)', () => {
  const a = wiki(PAGES);
  const entries = Object.entries(PAGES).reverse(); const b = tmp('af-idx-'); for (const [f, t] of entries) write(path.join(b, '02-DOCS/wiki', f), t);
  const old = new Date(1999, 1, 1); for (const f of Object.keys(PAGES)) fs.utimesSync(path.join(b, '02-DOCS/wiki', f), old, old);
  cli(a, '--write'); cli(b, '--write');
  assert.equal(fs.readFileSync(path.join(a, '02-DOCS/wiki/index.md'), 'utf8'), fs.readFileSync(path.join(b, '02-DOCS/wiki/index.md'), 'utf8'));
  // dos ramas añaden páginas distintas; regenerar sobre la unión da lo mismo que añadirlas en cualquier orden
  const c = wiki(PAGES); write(path.join(c, '02-DOCS/wiki/jobs/a-261106-1111.md'), '# A\nUno.\n'); write(path.join(c, '02-DOCS/wiki/jobs/b-261106-2222.md'), '# B\nDos.\n');
  const e = wiki(PAGES); write(path.join(e, '02-DOCS/wiki/jobs/b-261106-2222.md'), '# B\nDos.\n'); write(path.join(e, '02-DOCS/wiki/jobs/a-261106-1111.md'), '# A\nUno.\n');
  cli(c, '--write'); cli(e, '--write');
  assert.equal(fs.readFileSync(path.join(c, '02-DOCS/wiki/index.md'), 'utf8'), fs.readFileSync(path.join(e, '02-DOCS/wiki/index.md'), 'utf8'));
});
test('RF-I6: --check sale 0 si está al día y 1 si alguien lo editó a mano o falta una página', () => {
  const d = wiki(PAGES); assert.equal(cli(d, '--check').status, 1);   // aún no existe
  cli(d, '--write'); assert.equal(cli(d, '--check').status, 0);
  fs.appendFileSync(path.join(d, '02-DOCS/wiki/index.md'), '| a mano |\n'); assert.equal(cli(d, '--check').status, 1);
  cli(d, '--write'); write(path.join(d, '02-DOCS/wiki/sdd/nueva.md'), '# Nueva\nUna página.\n'); assert.equal(cli(d, '--check').status, 1);
  cli(d, '--write'); assert.match(fs.readFileSync(path.join(d, '02-DOCS/wiki/index.md'), 'utf8'), /sdd\/nueva\.md/);
});
test('gen-index: --wiki elige la carpeta, escribir dos veces no cambia nada y los errores de uso salen 64/1', () => {
  const d = wiki(PAGES); cli(d, '--write'); const one = fs.readFileSync(path.join(d, '02-DOCS/wiki/index.md'), 'utf8'); cli(d, '--write');
  assert.equal(fs.readFileSync(path.join(d, '02-DOCS/wiki/index.md'), 'utf8'), one);
  assert.equal(cli(d, '--check', '--wiki', '02-DOCS/wiki/').status, 0);
  assert.equal(cli(d).status, 64); assert.equal(cli(d, '--check', '--wiki').status, 64); assert.equal(cli(d, '--check', '--wiki', 'no-existe').status, 1);
  assert.equal(generate(path.join(d, '02-DOCS/wiki'), '02-DOCS/wiki'), one);
});
