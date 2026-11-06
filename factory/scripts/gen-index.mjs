#!/usr/bin/env node
/**
 * gen-index.mjs — GENERA 02-DOCS/wiki/index.md a partir de las paginas del wiki; no se edita a mano.
 * Asi dos jobs que anaden paginas distintas no chocan en index.md: el conflicto se resuelve regenerando.
 *
 * Cada pagina aporta `title` y `description` de su cabecera (--- ... ---) o, si no los tiene, su primer `# ` y la primera
 * frase de su primer parrafo. Es determinista: depende solo del contenido y de la ruta (nunca de mtime ni del orden de creacion).
 * Las paginas de jobs/ van aparte, de la mas reciente a la mas antigua (la fecha sale del id del job: <palabras>-<aammdd>-<hex>).
 *
 * Uso:  node gen-index.mjs --check|--write [--wiki 02-DOCS/wiki]       (--check sale 1 si index.md no coincide)
 */
import fs from 'node:fs';
import path from 'node:path';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!e.name.startsWith('.')) out.push(...walk(dir, r)); }
    else if (e.isFile() && e.name.endsWith('.md') && r !== 'index.md') out.push(r);
  }
  return out;
}

export function describe(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const fm = {};
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === '---');
    if (end > 0) { for (const l of lines.slice(1, end)) { const m = l.match(/^(title|description):\s*(.*?)\s*$/); if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, ''); } i = end + 1; }
  }
  const body = lines.slice(i);
  const h1 = body.find((l) => /^#\s+\S/.test(l));
  let desc = fm.description;
  if (!desc) {
    const h = body.findIndex((l) => /^#\s+\S/.test(l));
    for (const l of body.slice(h + 1)) {
      const t = l.trim();
      if (!t || /^(#|>|\||[-*]\s|\d+[.)]\s|<!--|```|---)/.test(t)) { if (desc) break; continue; }
      desc = (t.match(/^.+?[.!?](?=\s|$)/) || [t])[0]; break;
    }
  }
  const clean = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  return { title: clean(fm.title || (h1 || '').replace(/^#\s+/, '')), what: clean(desc).slice(0, 160) };
}

export function generate(wiki, prefix) {
  const pages = walk(wiki), rows = [], jobs = [];
  for (const rel of pages) {
    const d = describe(fs.readFileSync(path.join(wiki, rel), 'utf8'));
    const row = { rel, title: d.title || rel, what: d.what };
    if (rel.startsWith('jobs/')) jobs.push({ ...row, date: (rel.match(/-(\d{6})-[0-9a-f]{4}\.md$/) || [])[1] || '' }); else rows.push(row);
  }
  rows.sort((a, b) => cmp(a.rel, b.rel));
  jobs.sort((a, b) => cmp(b.date, a.date) || cmp(a.rel, b.rel));
  const table = (list) => ['| Pagina | Ruta | Que |', '|---|---|---|', ...list.map((r) => `| ${r.title} | \`${prefix}/${r.rel}\` | ${r.what} |`)];
  return [`# ${prefix}/index.md`, '', '> Generado por `factory/scripts/gen-index.mjs`. No lo edites a mano: cambia la cabecera (`title`, `description`) o el primer parrafo de la pagina y regeneralo.', '',
    '## Knowledge map', '', ...table(rows), '',
    ...(jobs.length ? ['## Jobs', '', ...table(jobs), ''] : []),
    '## Regla de lectura', '', '**Lee el indice primero y solo las 2-3 paginas relevantes.** No cargues todo el Brain de una vez. Cada agente consulta `02-DOCS/` antes de actuar y actualiza al terminar.', ''].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const mode = a.includes('--write') ? 'write' : a.includes('--check') ? 'check' : null;
  const wi = a.indexOf('--wiki');
  const wiki = wi >= 0 ? a[wi + 1] : '02-DOCS/wiki';
  if (!mode || (wi >= 0 && !wiki)) { console.error('uso: gen-index.mjs --check|--write [--wiki 02-DOCS/wiki]'); process.exit(64); }
  if (!fs.existsSync(wiki) || !fs.statSync(wiki).isDirectory()) { console.error(`no existe la carpeta ${wiki}`); process.exit(1); }
  const text = generate(wiki, wiki.replace(/\\/g, '/').replace(/\/+$/, ''));
  const file = path.join(wiki, 'index.md');
  if (mode === 'write') { fs.writeFileSync(file, text); console.log(`escrito ${file}`); process.exit(0); }
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n') : null;
  if (cur === text) { console.log('OK: index.md está al día'); process.exit(0); }
  console.log('index.md no coincide con lo generado: ejecuta gen-index.mjs --write'); process.exit(1);
}
