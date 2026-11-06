#!/usr/bin/env node
/**
 * project-lint.mjs — valida la base documental del proyecto (02-DOCS/wiki/project/): formato, IDs, referencias cruzadas,
 * origen de cada afirmacion y frescura de la aprobacion. Valida ESTRUCTURA y trazabilidad, no que el contenido sea acertado.
 *
 * Documentos: 00-vision 01-requisitos 02-casos-de-uso 03-dominio 04-arquitectura 05-datos 06-despliegue (+ discovery y el
 * trazabilidad.md generado). IDs: REQ-F-n, REQ-NF-n (01), UC-n (02), ENT-n (03). Etiquetas de origen: [FUENTE: ruta#ancla]
 * [INFERIDO] [INVESTIGADO: url, fecha] [PROPUESTO] [PENDIENTE]. Terminos del dominio entre doble corchete.
 * Se ignoran los bloques de codigo, los comentarios HTML y el codigo en linea.
 *
 * Aprobacion: project.ok (JSON versionado, lo escribe solo `approve`, que ejecuta el humano) guarda el hash del cuerpo de cada
 * documento y el de cada ID ajeno que cita. No se usa mtime: los documentos viajan por git y un clon pierde ese orden.
 *
 * Uso:
 *   node project-lint.mjs check   [--dir D] [--root R] [--strict]   un problema por linea: CODIGO E|W archivo:linea mensaje
 *   node project-lint.mjs state   [--dir D] [--root R]              CLAVE=valor (lo consume init-project.sh)
 *   node project-lint.mjs impact  <ID|documento|--changed> [...]     si cambias X, revisa Y
 *   node project-lint.mjs trace   [--write] [...]                    trazabilidad.md (derivado, nunca a mano)
 *   node project-lint.mjs approve <documento...> [...]               humano: registra el hash y marca aprobado
 *   node project-lint.mjs gate    [...]                              0 solo si los 7 documentos estan aprobados y frescos
 * Salida: 0 sin errores, 1 con errores, 64 uso incorrecto.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_DIR = '02-DOCS/wiki/project';
export const DOCS = ['00-vision', '01-requisitos', '02-casos-de-uso', '03-dominio', '04-arquitectura', '05-datos', '06-despliegue'];
export const OWNERS = {
  '00-vision': 'system-analyst', '01-requisitos': 'system-analyst', '02-casos-de-uso': 'system-analyst',
  '03-dominio': 'domain-modeler', '05-datos': 'domain-modeler', '04-arquitectura': 'architect', '06-despliegue': 'deployment-planner',
  discovery: 'discovery',
};
const ID_HOME = { REQ: '01-requisitos', UC: '02-casos-de-uso', ENT: '03-dominio' };
const ESTADOS = ['borrador', 'aprobado', 'desactualizado'];
const ID_VALID = /^(?:REQ-F-\d+|REQ-NF-\d+|UC-\d+|ENT-\d+)$/;
const ID_TOKEN = /\b(?:REQ|UC|ENT)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g;
const DEF_BULLET = /^- (REQ-(?:F|NF)-\d+):/;
const DEF_HEAD = /^(#{2,4})\s+(UC-\d+|ENT-\d+):\s*(.*)$/;
const LABEL = /\[(FUENTE|INFERIDO|INVESTIGADO|PROPUESTO|PENDIENTE)(?::\s*([^\]]*))?\]/g;
const SEMVER = /^\d+\.\d+\.\d+$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const norm = (lines) => lines.map((l) => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
const slug = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Copia de las lineas sin bloques de codigo, comentarios HTML ni codigo en linea (misma numeracion). */
function mask(lines, from) {
  let fence = false, comment = false;
  return lines.map((l, i) => {
    if (i < from) return '';
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return ''; }
    if (fence) return '';
    let s = l, r = '';
    while (s.length) {
      if (comment) { const e = s.indexOf('-->'); if (e < 0) s = ''; else { comment = false; s = s.slice(e + 3); } }
      else { const b = s.indexOf('<!--'); if (b < 0) { r += s; s = ''; } else { r += s.slice(0, b); comment = true; s = s.slice(b + 4); } }
    }
    return r.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
  });
}

function parseDoc(name, dir) {
  const file = path.join(dir, `${name}.md`);
  if (!fs.existsSync(file)) return { name, file, missing: true };
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  let header = null, bodyStart = 0;
  if (lines[0].trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end > 0) {
      header = {};
      for (let i = 1; i < end; i++) { const m = lines[i].match(/^([A-Za-z_]+):\s*(.*?)\s*(?:\s#.*)?$/); if (m) header[m[1]] = { value: m[2], line: i + 1 }; }
      bodyStart = end + 1;
    }
  }
  const body = lines.slice(bodyStart);
  const m = mask(lines, bodyStart);
  return {
    name, file, lines, header, bodyStart, m,
    plantilla: /RELLENAR/.test(body.join('\n')),
    hash: sha(norm(body)),
    estado: header?.estado?.value,
  };
}

/** Bloques de definicion de ID de un documento: { id, line, raw, mtext }. */
function blocksOf(doc) {
  const { lines, m } = doc, out = [];
  for (let i = doc.bodyStart; i < m.length; i++) {
    let id = null, end = i, head = m[i].match(DEF_HEAD);
    const bul = m[i].match(DEF_BULLET);
    if (head) {
      id = head[2]; end = i + 1;
      while (end < m.length && !(/^(#{1,6})\s/.test(m[end]) && m[end].match(/^(#+)/)[1].length <= head[1].length)) end++;
    } else if (bul) {
      id = bul[1]; end = i + 1;
      while (end < m.length && (m[end].trim() === '' || /^\s+\S/.test(m[end]))) end++;
    }
    if (!id) continue;
    let e = end; while (e > i + 1 && m[e - 1].trim() === '') e--;
    out.push({ id, line: i + 1, raw: norm(lines.slice(i, e)), mtext: m.slice(i, e) });
  }
  return out;
}

const labelsIn = (text) => [...String(text).matchAll(LABEL)].map((x) => ({ kind: x[1], value: (x[2] || '').trim(), index: x.index }));
const idsIn = (text) => [...String(text).matchAll(ID_TOKEN)].map((x) => x[0]);

function readRegistry(dir) {
  const f = path.join(dir, 'project.ok');
  if (!fs.existsSync(f)) return { docs: {} };
  try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return { docs: j && typeof j.docs === 'object' && j.docs ? j.docs : {}, bad: !j || typeof j.docs !== 'object' }; }
  catch { return { docs: {}, bad: true }; }
}

function resolveSource(value, root, dir) {
  const [p, anchor] = value.split('#');
  const realRoot = fs.realpathSync(root);
  if (!p || path.isAbsolute(p)) return { err: 'la ruta debe ser relativa al repositorio' };
  for (const base of [root, dir]) {
    const f = path.resolve(base, p);
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) continue;
    const real = fs.realpathSync(f);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return { err: `la ruta sale del repositorio (${p})` };
    if (!anchor) return {};
    const txt = fs.readFileSync(real, 'utf8');
    const lm = anchor.match(/^L(\d+)(?:-L?(\d+))?$/);
    if (lm) return Number(lm[2] || lm[1]) <= txt.split('\n').length ? {} : { err: `la linea ${anchor} no existe en ${p}` };
    const heads = [...txt.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((x) => slug(x[1]));
    if (heads.includes(slug(anchor)) || new RegExp(`(?<![\\w-])${escRe(anchor)}(?![\\w-])`, 'i').test(txt)) return {};
    return { err: `el ancla #${anchor} no existe en ${p}` };
  }
  return { err: `no existe ${p}` };
}

/** Analiza todo el directorio. Devuelve { problems, docs, states, pendientes, project, defs, cites }. */
export function analyze({ dir = DEFAULT_DIR, root = process.cwd(), strict = false, approving = [] } = {}) {
  dir = path.resolve(root, dir);
  const problems = [];
  const P = (code, sev, doc, line, msg) => problems.push({ code, sev, doc, line, msg });
  const names = [...DOCS, 'discovery'];
  const docs = Object.fromEntries(names.map((n) => [n, parseDoc(n, dir)]));
  const present = names.filter((n) => !docs[n].missing);
  const reg = readRegistry(dir);
  if (reg.bad) P('PL054', 'E', 'project.ok', 0, 'no es un JSON válido con { docs }: solo `approve` lo escribe');
  const approvingSet = new Set(approving);
  const isApproved = (d) => d.estado === 'aprobado' || approvingSet.has(d.name);

  // ---- cabecera ----
  for (const n of present) {
    const d = docs[n];
    if (!d.header) { P('PL001', 'E', n, 1, 'sin cabecera (--- documento, estado, version, fecha, responsable ---)'); continue; }
    const miss = ['documento', 'estado', 'version', 'fecha', 'responsable'].filter((k) => !d.header[k]?.value);
    if (miss.length) P('PL001', 'E', n, 1, `a la cabecera le faltan: ${miss.join(', ')}`);
    if (d.header.documento?.value && d.header.documento.value !== n) P('PL004', 'E', n, d.header.documento.line, `documento: debe ser '${n}'`);
    if (d.header.estado?.value && !ESTADOS.includes(d.header.estado.value)) P('PL002', 'E', n, d.header.estado.line, `estado debe ser ${ESTADOS.join(' | ')}`);
    if (d.header.version?.value && !SEMVER.test(d.header.version.value)) P('PL003', 'E', n, d.header.version.line, 'version debe ser semver (1.2.3)');
    if (d.header.fecha?.value && !ISO.test(d.header.fecha.value)) P('PL003', 'E', n, d.header.fecha.line, 'fecha debe ser AAAA-MM-DD');
  }
  if (strict) for (const n of DOCS) if (docs[n].missing) P('PL005', 'E', n, 0, 'documento ausente');

  // ---- definiciones, citas y formato de IDs ----
  const defs = new Map(), cites = [];
  const blocks = {};
  for (const n of present) {
    blocks[n] = blocksOf(docs[n]);
    for (const b of blocks[n]) {
      const home = ID_HOME[b.id.split('-')[0]];
      if (defs.has(b.id)) { const o = defs.get(b.id); P('PL011', 'E', n, b.line, `${b.id} ya está definido en ${o.doc}.md:${o.line}`); }
      else defs.set(b.id, { id: b.id, doc: n, line: b.line, hash: sha(b.raw), block: b });
      if (n !== home) P('PL012', 'E', n, b.line, `${b.id} se define en ${home}.md; aquí cítalo en prosa, sin empezar la línea por el ID`);
    }
  }
  const decisions = path.resolve(root, '02-DOCS/wiki/sdd/decisions.md');
  const adrs = fs.existsSync(decisions) ? new Set([...fs.readFileSync(decisions, 'utf8').matchAll(/^##\s+(ADR-\d+):/gm)].map((x) => x[1])) : null;
  for (const n of present) {
    const d = docs[n], own = new Map(blocks[n].map((b) => [b.line - 1, b.id]));
    d.m.forEach((l, i) => {
      let skipped = false;
      for (const t of l.matchAll(ID_TOKEN)) {
        let tok = t[0];
        if (tok === 'REQ-F' || tok === 'REQ-NF') continue;   // nombre del tipo, no un ID
        if (!ID_VALID.test(tok)) { P('PL010', 'E', n, i + 1, `ID mal formado: ${tok}`); continue; }
        if (!skipped && own.get(i) === tok && t.index <= 8) { skipped = true; continue; }
        cites.push({ id: tok, doc: n, line: i + 1 });
        if (!defs.has(tok)) P('PL020', 'E', n, i + 1, `${tok} no está definido en ningún documento`);
      }
      for (const t of l.matchAll(/\bRF-F?\d+\b/g)) P('PL013', 'E', n, i + 1, `${t[0]} pertenece al spec de un job o a la fábrica; el proyecto usa REQ/UC/ENT`);
      if (adrs) for (const t of l.matchAll(/\bADR-\d+\b/g)) if (!adrs.has(t[0])) P('PL020', 'E', n, i + 1, `${t[0]} no existe en sdd/decisions.md`);
    });
  }

  // ---- origen de cada afirmacion ----
  for (const n of present) {
    const d = docs[n], approved = isApproved(d);
    for (const b of blocks[n]) {
      const ls = labelsIn(b.mtext.join('\n'));
      if (!ls.length) P('PL030', 'E', n, b.line, `${b.id} sin etiqueta de origen ([FUENTE: ruta#ancla], [INFERIDO], [INVESTIGADO], [PROPUESTO] o [PENDIENTE])`);
      else if (approved && n !== 'discovery' && !ls.some((x) => x.kind === 'FUENTE')) P('PL034', 'E', n, b.line, `${b.id} está en un documento aprobado y no tiene [FUENTE]`);
    }
    d.m.forEach((l, i) => {
      for (const x of labelsIn(l)) {
        if (x.kind === 'FUENTE') {
          if (!x.value) P('PL031', 'E', n, i + 1, '[FUENTE] sin ruta');
          else { const r = resolveSource(x.value, root, dir); if (r.err) P('PL031', 'E', n, i + 1, `[FUENTE: ${x.value}] ${r.err}`); }
        } else if (x.kind === 'INVESTIGADO' && !/^https:\/\/\S+,\s*\d{4}-\d{2}-\d{2}$/.test(x.value)) P('PL032', 'E', n, i + 1, '[INVESTIGADO] necesita https://url, AAAA-MM-DD');
        if (approved && n !== 'discovery' && ['PENDIENTE', 'PROPUESTO', 'INFERIDO'].includes(x.kind)) P('PL033', 'E', n, i + 1, `[${x.kind}] en un documento aprobado: el humano debe confirmarlo o quitarse`);
      }
    });
    if (approved && d.plantilla && n !== 'discovery') P('PL070', 'E', n, 1, 'documento aprobado con marcadores RELLENAR');
  }

  // ---- glosario ----
  const dom = docs['03-dominio'];
  if (!dom.missing && !dom.plantilla) {
    const terms = new Map(); const add = (t, line) => { const k = t.trim().toLowerCase(); if (!k) return; if (terms.has(k)) P('PL041', 'E', '03-dominio', line, `término repetido en el glosario: ${t.trim()}`); else terms.set(k, true); };
    for (const b of blocks['03-dominio']) if (b.id.startsWith('ENT-')) add(b.mtext[0].replace(DEF_HEAD, '$3').replace(LABEL, '').trim(), b.line);
    let inG = false;
    dom.m.forEach((l, i) => {
      if (/^#{1,2}\s/.test(l)) inG = /^##\s+Glosario\b/i.test(l);
      else if (inG) { const g = l.match(/^- \*\*(.+?)\*\*\s*:\s*(.*)$/); if (g) { add(g[1], i + 1); const a = g[2].match(/\(alias:\s*([^)]*)\)/i); if (a) a[1].split(',').forEach((x) => add(x, i + 1)); } }
    });
    for (const n of present) docs[n].m.forEach((l, i) => { for (const t of l.matchAll(/\[\[([^\]]+)\]\]/g)) if (!terms.has(t[1].trim().toLowerCase())) P('PL040', 'E', n, i + 1, `término fuera del glosario: ${t[1].trim()}`); });
  }

  // ---- cobertura (entre documentos con contenido) ----
  const has = (n) => strict ? true : (!docs[n].missing && !docs[n].plantilla);
  const citedIn = (id, dn) => cites.some((c) => c.id === id && dn.includes(c.doc));
  const ucs = blocks['02-casos-de-uso'] || [];
  const covered = new Set();
  if (has('02-casos-de-uso')) for (const b of ucs.filter((x) => x.id.startsWith('UC-'))) {
    const line = b.mtext.find((l) => /^\s*-\s*Cubre:/.test(l));
    const reqs = line ? idsIn(line).filter((x) => /^REQ-F-\d+$/.test(x)) : [];
    if (!reqs.length) P('PL022', 'E', '02-casos-de-uso', b.line, `${b.id} sin 'Cubre:' con algún REQ-F`);
    reqs.forEach((r) => covered.add(r));
  }
  if (has('01-requisitos') && has('02-casos-de-uso')) for (const b of blocks['01-requisitos'] || []) if (/^REQ-F-/.test(b.id) && !covered.has(b.id)) P('PL021', 'E', '01-requisitos', b.line, `${b.id} no lo cubre ningún caso de uso`);
  for (const b of has('01-requisitos') ? blocks['01-requisitos'] || [] : []) {
    if (!b.id.startsWith('REQ-NF-')) continue;
    if (!/M[eé]trica:\s*[^\n]*\d/i.test(b.mtext.join('\n').replace(LABEL, ''))) P('PL024', 'E', '01-requisitos', b.line, `${b.id} sin 'Métrica:' con un valor numérico`);
    if (has('04-arquitectura') && has('06-despliegue') && !citedIn(b.id, ['04-arquitectura', '06-despliegue'])) P('PL025', 'E', '01-requisitos', b.line, `${b.id} no lo cita ni 04-arquitectura ni 06-despliegue`);
  }
  if (has('01-requisitos') && has('02-casos-de-uso')) for (const b of blocks['03-dominio'] || []) if (b.id.startsWith('ENT-') && !citedIn(b.id, ['01-requisitos', '02-casos-de-uso'])) P('PL023', 'E', '03-dominio', b.line, `${b.id} no lo usa ningún requisito ni caso de uso`);
  if (has('05-datos')) for (const b of blocks['03-dominio'] || []) if (b.id.startsWith('ENT-') && !citedIn(b.id, ['05-datos'])) P('PL026', 'E', '03-dominio', b.line, `${b.id} no aparece en 05-datos (si no se persiste, dilo allí citándolo)`);

  // ---- un hecho, un documento ----
  const reqText = (b) => b.mtext.join(' ').replace(/^- REQ-(?:F|NF)-\d+:/, '').replace(LABEL, '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const b of blocks['01-requisitos'] || []) {
    const t = reqText(b);
    if (t.length < 25) continue;
    for (const n of present.filter((x) => x !== '01-requisitos' && x !== 'discovery')) if (docs[n].m.join(' ').replace(/\s+/g, ' ').toLowerCase().includes(t)) P('PL060', 'W', n, 0, `repite el texto de ${b.id}; cítalo por ID`);
  }

  // ---- aprobacion y frescura ----
  const blockHash = (id) => defs.get(id)?.hash;
  const states = {};
  for (const n of DOCS) {
    const d = docs[n], r = reg.docs[n];
    if (d.missing) { states[n] = 'AUSENTE'; continue; }
    if (d.plantilla) { states[n] = 'PLANTILLA'; if (r) P('PL053', 'E', n, 1, 'hay registro de aprobación en project.ok pero el documento es una plantilla'); continue; }
    if (d.estado === 'aprobado' && !r) P('PL053', 'E', n, d.header?.estado?.line || 1, 'la cabecera dice aprobado y project.ok no lo registra (solo `approve` aprueba)');
    if (r && d.estado === 'borrador') P('PL053', 'E', n, d.header?.estado?.line || 1, 'project.ok lo registra como aprobado pero la cabecera dice borrador');
    if (r) {
      const own = r.sha256 === d.hash;
      const stale = Object.entries(r.refs || {}).filter(([id, h]) => blockHash(id) !== h);
      if (!own && d.estado === 'aprobado') P('PL050', 'E', n, 1, 'documento editado después de su aprobación: pon estado desactualizado y sube la versión');
      if (!own && r.version === d.header?.version?.value) P('PL052', 'W', n, d.header?.version?.line || 1, 'el contenido cambió y la versión sigue igual');
      if (own && d.estado === 'aprobado') for (const [id] of stale) P('PL051', 'E', n, 1, `cita ${id}, cuya definición ${blockHash(id) ? 'cambió' : 'ya no existe'} desde la aprobación`);
      states[n] = own && !stale.length && d.estado === 'aprobado' ? 'APROBADO' : 'DESACTUALIZADO';
    }
  }
  const pendientes = present.reduce((s, n) => s + docs[n].m.reduce((a, l) => a + labelsIn(l).filter((x) => x.kind === 'PENDIENTE').length, 0), 0);
  for (const n of DOCS) {
    if (states[n]) continue;
    const errs = problems.some((p) => p.doc === n && p.sev === 'E');
    const pend = docs[n].m.some((l) => labelsIn(l).some((x) => x.kind === 'PENDIENTE'));
    states[n] = pend ? 'PENDIENTE' : errs ? 'BORRADOR' : 'LISTO';
  }

  // ---- trazabilidad generada ----
  const tr = path.join(dir, 'trazabilidad.md');
  if (fs.existsSync(tr) && fs.readFileSync(tr, 'utf8').replace(/\r\n?/g, '\n') !== buildTrace({ docs, defs, cites })) P('PL061', 'E', 'trazabilidad', 1, 'no coincide con lo generado: ejecuta `project-lint trace --write`');

  const vals = DOCS.map((n) => states[n]);
  const project = !fs.existsSync(dir) || vals.every((v) => v === 'AUSENTE' || v === 'PLANTILLA') ? 'none'
    : vals.some((v) => v === 'DESACTUALIZADO') ? 'stale'
    : vals.every((v) => v === 'APROBADO') && pendientes === 0 ? 'complete' : 'partial';
  return { problems, docs, states, pendientes, project, defs, cites, reg, dir, blocks };
}

function buildTrace({ docs, defs, cites }) {
  const ids = [...defs.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const citedBy = (id) => [...new Set(cites.filter((c) => c.id === id && c.doc !== defs.get(id).doc).map((c) => c.doc))].sort();
  const fechas = DOCS.map((n) => docs[n].header?.fecha?.value).filter(Boolean).sort();
  const line = (b, key) => (b.mtext.find((l) => new RegExp(`^\\s*-\\s*${key}:`).test(l)) || '');
  const out = ['---', 'documento: trazabilidad', 'estado: generado', 'version: 1.0.0', `fecha: ${fechas.at(-1) || '1970-01-01'}`, 'responsable: project-lint', 'generado: true', '---', '',
    '# Trazabilidad', '', '> Generado por `project-lint trace --write`. No lo edites: se vuelve a calcular desde los documentos.', '',
    '## Requisitos y casos de uso', '', '| Requisito | Casos de uso que lo cubren |', '|---|---|'];
  const ucs = [...defs.values()].filter((d) => d.id.startsWith('UC-'));
  for (const id of ids.filter((x) => x.startsWith('REQ-'))) {
    const u = ucs.filter((d) => idsIn(line(d.block, 'Cubre')).includes(id)).map((d) => d.id);
    out.push(`| ${id} | ${u.join(', ') || '—'} |`);
  }
  out.push('', '## Casos de uso y entidades', '', '| Caso de uso | Cubre | Usa |', '|---|---|---|');
  for (const d of ucs.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))) out.push(`| ${d.id} | ${idsIn(line(d.block, 'Cubre')).join(', ') || '—'} | ${idsIn(line(d.block, 'Usa')).join(', ') || '—'} |`);
  out.push('', '## Si cambias X, revisa Y', '', '| ID | Definido en | Responsable | Revisa |', '|---|---|---|---|');
  for (const id of ids) { const d = defs.get(id); out.push(`| ${id} | ${d.doc} | ${OWNERS[d.doc] || '—'} | ${citedBy(id).join(', ') || '—'} |`); }
  out.push('', '| Documento | Si cambia, revisa |', '|---|---|');
  for (const n of DOCS) {
    const mine = ids.filter((i) => defs.get(i).doc === n), dep = [...new Set(mine.flatMap(citedBy))].sort();
    out.push(`| ${n} | ${dep.join(', ') || '—'} |`);
  }
  return out.join('\n') + '\n';
}

export const trace = (a) => buildTrace(a);

/** Documentos que citan IDs de `n` (para "si cambias X, revisa Y"). */
export function dependents(a, n) {
  const mine = new Set([...a.defs.values()].filter((d) => d.doc === n).map((d) => d.id));
  return [...new Set(a.cites.filter((c) => mine.has(c.id) && c.doc !== n).map((c) => c.doc))].sort();
}

/** Lo que hay que reabrir segun project.ok: documentos cuyo contenido o cuyas citas cambiaron. */
export function changed(a) {
  const out = [];
  for (const n of DOCS) {
    const r = a.reg.docs[n], d = a.docs[n];
    if (!r || d.missing) continue;
    if (r.sha256 !== d.hash) out.push({ doc: n, why: 'su contenido cambió' });
    for (const [id, h] of Object.entries(r.refs || {})) if (a.defs.get(id)?.hash !== h) out.push({ doc: n, why: `cita ${id}, que ${a.defs.get(id) ? 'cambió' : 'ya no existe'}` });
  }
  return out;
}

/** Humano: registra el hash de cada documento y lo marca aprobado. Devuelve { ok, errors[] }. */
export function approve(docNames, opts = {}) {
  const errors = [];
  const targets = [...new Set(docNames)];
  for (const n of targets) if (!DOCS.includes(n)) errors.push(`${n}: solo se aprueban ${DOCS.join(', ')}`);
  if (errors.length) return { ok: false, errors };
  const a = analyze({ ...opts, approving: targets });
  for (const n of targets) {
    if (a.docs[n].missing) { errors.push(`${n}: no existe`); continue; }
    for (const p of a.problems.filter((x) => x.doc === n && x.sev === 'E' && !['PL050', 'PL051', 'PL053'].includes(x.code))) errors.push(`${p.code} ${n}.md:${p.line} ${p.msg}`);
    const deps = new Set(a.cites.filter((c) => c.doc === n && a.defs.get(c.id) && a.defs.get(c.id).doc !== n).map((c) => a.defs.get(c.id).doc));
    for (const dep of deps) if (!targets.includes(dep) && a.states[dep] !== 'APROBADO') errors.push(`${n}: cita ${dep}, que no está aprobado (apruébalos juntos o antes)`);
  }
  if (errors.length) return { ok: false, errors };
  const dir = a.dir, reg = readRegistry(dir);
  for (const n of targets) {
    const d = a.docs[n], refs = {};
    for (const c of a.cites.filter((x) => x.doc === n)) { const def = a.defs.get(c.id); if (def && def.doc !== n) refs[c.id] = def.hash; }
    reg.docs[n] = { sha256: d.hash, version: d.header.version.value, fecha: d.header.fecha.value, refs: Object.fromEntries(Object.entries(refs).sort(([x], [y]) => x.localeCompare(y, 'en', { numeric: true }))) };
    const lines = d.lines.slice(); lines[d.header.estado.line - 1] = lines[d.header.estado.line - 1].replace(/^(estado:\s*)\S+/, '$1aprobado');
    fs.writeFileSync(d.file, lines.join('\n'));
  }
  const sorted = Object.fromEntries(Object.entries(reg.docs).sort(([x], [y]) => x.localeCompare(y)));
  fs.writeFileSync(path.join(dir, 'project.ok'), JSON.stringify({ version: 1, docs: sorted }, null, 2) + '\n');
  return { ok: true, errors: [] };
}

export function gate(opts = {}) {
  const a = analyze({ ...opts, strict: true });
  const out = a.problems.filter((p) => p.sev === 'E').map(fmt);
  for (const n of DOCS) if (a.states[n] !== 'APROBADO') out.push(`GATE ${n}: ${a.states[n]}`);
  if (a.pendientes) out.push(`GATE ${a.pendientes} [PENDIENTE] abiertos`);
  return [...new Set(out)];
}

const fmt = (p) => `${p.code} ${p.sev} ${p.doc}${p.doc.includes('.') ? '' : '.md'}${p.line ? ':' + p.line : ''} ${p.msg}`;

function cli(argv) {
  const args = [], opt = { strict: false, write: false, changed: false, dir: DEFAULT_DIR, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--strict') opt.strict = true; else if (x === '--write') opt.write = true; else if (x === '--changed') opt.changed = true;
    else if (x === '--dir' || x === '--root') { if (!argv[i + 1]) return usage(); opt[x.slice(2)] = argv[++i]; }
    else if (x.startsWith('--')) return usage(); else args.push(x);
  }
  const [cmd, ...rest] = args;
  const base = { dir: opt.dir, root: path.resolve(opt.root) };
  if (cmd === 'check') { const a = analyze({ ...base, strict: opt.strict }); a.problems.forEach((p) => console.log(fmt(p))); return a.problems.some((p) => p.sev === 'E') ? 1 : 0; }
  if (cmd === 'state') {
    const a = analyze(base);
    DOCS.forEach((n) => console.log(`DOC ${n} ${a.states[n]}`));
    console.log(`PENDIENTES=${a.pendientes}`); console.log(`PROJECT=${a.project}`);
    const next = DOCS.find((n) => a.states[n] !== 'APROBADO');
    console.log(next ? `NEXT=${next} OWNER=${OWNERS[next]}` : 'NEXT=-');
    for (const c of changed(a)) console.log(`REOPEN=${c.doc}:${OWNERS[c.doc]} (${c.why})`);
    return 0;
  }
  if (cmd === 'impact') {
    const a = analyze(base);
    if (opt.changed) { const c = changed(a); c.forEach((x) => console.log(`REABRIR ${OWNERS[x.doc]} ${x.doc} (${x.why})`)); return 0; }
    const t = rest[0]; if (!t) return usage();
    if (DOCS.includes(t)) { dependents(a, t).forEach((n) => console.log(`REVISAR ${n} (${OWNERS[n]})`)); return 0; }
    if (!a.defs.has(t)) { console.error(`${t} no está definido`); return 1; }
    [...new Set(a.cites.filter((c) => c.id === t && c.doc !== a.defs.get(t).doc).map((c) => `${c.doc}.md:${c.line}`))].forEach((w) => console.log(`REVISAR ${w} (${OWNERS[w.split('.md')[0]] || '—'}) cita ${t}`));
    return 0;
  }
  if (cmd === 'trace') {
    const a = analyze(base); const text = buildTrace(a);
    if (opt.write) { fs.writeFileSync(path.join(a.dir, 'trazabilidad.md'), text); return 0; }
    process.stdout.write(text); return 0;
  }
  if (cmd === 'approve') {
    if (!rest.length) return usage();
    const r = approve(rest, base); r.errors.forEach((e) => console.log(e));
    if (r.ok) console.log(`APROBADO ${rest.join(' ')}`);
    return r.ok ? 0 : 1;
  }
  if (cmd === 'gate') { const o = gate(base); o.forEach((l) => console.log(l)); return o.length ? 1 : 0; }
  return usage();
}
function usage() { console.error('uso: project-lint.mjs check|state|impact|trace|approve|gate [--dir D] [--root R] [--strict] [--write] [--changed]'); return 64; }

if (import.meta.url === `file://${process.argv[1]}`) process.exit(cli(process.argv.slice(2)));
