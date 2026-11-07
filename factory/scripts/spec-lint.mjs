#!/usr/bin/env node
/**
 * spec-lint.mjs — valida la ESTRUCTURA de spec.md y tasks.md (no su acierto). Lo usa next-step.sh (estado 2).
 *
 * Perfiles (factory/project.json -> "spec_profile"):
 *   standard  Surface, criterios numerados, Alcance con rutas, tasks.md.                         (por defecto)
 *   full      + ADR, Actores, Requisitos funcionales (RF-n), Diseño, y trazabilidad:
 *             cada criterio cita [RF-n] existentes, cada RF lo cubre >=1 criterio y aparece en tasks.md.
 *             Con la base documental exigida (project_docs=required, o ya hay documentos aprobados) cada RF termina con
 *             `Implementa: REQ-F-1, UC-2` y esos IDs deben existir en 02-DOCS/wiki/project/ (RF-I15).
 *
 *   docs      el spec minimo de un job de documentacion (kind: docs; plantilla 02-DOCS/wiki/sdd/spec-docs-template.md): Surface none, ADR,
 *             Objetivo, Cambio solicitado, Documentos afectados (tabla ID | Documento | Agente), Impacto en jobs, Criterios numerados y
 *             Alcance dentro de la base documental. Sin RF-n ni Implementa:. next-step.sh lo elige cuando job.json dice kind: docs.
 *
 * Las secciones se escriben como "## Actores" o como "Actores:" (ambas valen).
 *
 * Uso:
 *   node spec-lint.mjs check   <spec.md> <tasks.md> [standard|full|docs] [--root R]   -> un problema por linea; sale 0 si no hay
 *   node spec-lint.mjs adr     <spec.md>                              -> "none" o el titulo del ADR declarado
 *   node spec-lint.mjs summary <spec.md>                              -> resumen para el humano (una linea por dato)
 *   node spec-lint.mjs page    <spec.md> <pagina-del-job.md>          -> problemas de la linea Implementa: de la pagina; sale 0 si no hay
 * La base documental que `check` usa para Implementa: es la de la worktree del job (la deduce de la ruta del spec) o la de --root.
 */
import fs from 'node:fs';

const SECTIONS = {
  actores: /actores/i,
  rf: /requisitos\s+funcionales/i,
  diseno: /dise[ñn]o/i,
  criterios: /criterios\s+de\s+aceptaci[oó]n/i,
  alcance: /alcance/i,
};
const KNOWN_LABEL = /^\s*(?:#{1,6}\s*)?(actores|requisitos\s+funcionales|requisitos\s+no\s+funcionales|dise[ñn]o|criterios\s+de\s+aceptaci[oó]n|alcance|objetivo[^:]*|restricciones[^:]*|tests\s+esperados|riesgos|tareas[^:]*)\s*:?\s*$/i;
const HEADING = /^\s*#{1,6}\s+\S/;

/** Cuerpo de una seccion: lineas no vacias hasta la siguiente seccion o cabecera markdown. null si no existe. */
export function section(text, key) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((l) => {
    const m = l.match(/^\s*(?:#{1,6}\s*)?([^:#]+?)\s*:?\s*$/);
    return m && KNOWN_LABEL.test(l) && SECTIONS[key].test(m[1]) && (!/no\s+funcionales/i.test(m[1]));
  });
  if (start < 0) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (KNOWN_LABEL.test(lines[i]) || HEADING.test(lines[i])) break;
    if (lines[i].trim()) body.push(lines[i].replace(/\r$/, ''));
  }
  return body;
}
const bullets = (body) => (body || []).filter((l) => /^\s*[-*]\s+\S/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, '').trim());
export const surface = (t) => ((String(t).match(/^surface:\s*(.+?)\s*$/im) || [])[1] || '').toLowerCase();
// Corta lo que sigue a un comentario HTML (abierto o no) en una linea: se usa en rutas de Alcance, donde la plantilla
// lleva un comentario al lado. Con indexOf y no con una regexp: no hay nada que "sanear", solo quedarse con el prefijo.
export const sinComentarioHtml = (s) => { const i = String(s).indexOf('<!--'); return (i < 0 ? String(s) : String(s).slice(0, i)).trimEnd(); };
// Quita los comentarios HTML cerrados repitiendo hasta que no quede ninguno: una sola pasada deja uno nuevo
// cuando se anidan ('<!<!-- a -->-- b -->'). Uno sin cerrar se queda, y entonces el valor no es 'none' (falla cerrado).
const quitaComentarios = (s) => { let v = String(s); for (let prev = null; prev !== v;) { prev = v; v = v.replace(/<!--[\s\S]*?-->/g, ''); } return v; };
export const adr = (t) => {
  let v = (String(t).match(/^adr:\s*(.*?)\s*$/im) || [])[1];
  if (v === undefined) return null;               // sin linea ADR
  v = quitaComentarios(v).trim();                 // la plantilla lleva un comentario HTML al lado
  return v === '' || /^(none|ninguno|ninguna|n\/a|no)$/i.test(v) ? 'none' : v;
};
export const ID_IMPLEMENTA = /^(?:REQ-F-\d+|REQ-NF-\d+|UC-\d+|ENT-\d+)$/;
const IMPLEMENTA_LINE = /\bImplementa:\*{0,2}\s*(.*)$/i;
const idList = (raw) => String(raw).split(/[\s,;]+/).map((x) => x.replace(/[.)\]*]+$/, '').replace(/^[(\[*]+/, '')).filter(Boolean);
/** IDs que un spec dice implementar: union ordenada y sin repetidos de las lineas `Implementa:` de sus RF (los mal formados no cuentan). */
export function implementaIds(spec) {
  const ids = new Set();
  for (const l of bullets(section(spec, 'rf'))) { const m = l.match(IMPLEMENTA_LINE); if (m) idList(m[1]).map((x) => x.toUpperCase()).filter((x) => ID_IMPLEMENTA.test(x)).forEach((x) => ids.add(x)); }
  return [...ids].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}
const PAGE_LINE = /^\s*(?:[-*]\s+)?\**Implementa:\**\s*(.*)$/i;
/** IDs de la linea `Implementa:` de la pagina de un job (null si no la tiene). */
export function pageIds(page) {
  const line = String(page).split(/\r?\n/).map((l) => l.match(PAGE_LINE)).find(Boolean);
  return line ? [...new Set(idList(line[1]).map((x) => x.toUpperCase()))] : null;
}
/** Problemas de la linea `Implementa:` de la pagina del job frente al spec (vacio = valida o el spec no cita IDs). */
export function pageProblems(spec, page) {
  const want = implementaIds(spec);
  if (!want.length) return [];
  const got = pageIds(page);
  if (!got) return [`la página del job está sin la línea 'Implementa: ${want.join(', ')}' (la unión de las del spec)`];
  const falta = want.filter((x) => !got.includes(x)), sobra = got.filter((x) => !want.includes(x));
  const p = [];
  if (falta.length) p.push(`a la línea 'Implementa:' de la página del job le faltan: ${falta.join(', ')}`);
  for (const x of sobra) p.push(`la línea 'Implementa:' de la página del job cita ${x}, que el spec no cita`);
  return p;
}
const criteria = (t) => String(t).split(/\r?\n/).filter((l) => /^\s*\d+[.)]\s+\S/.test(l)).map((l) => l.replace(/^\s*\d+[.)]\s+/, ''));

// ---------------------------------------------------------------- perfil docs (job de documentacion)
export const isDocsSpec = (t) => /^#\s+Spec\s*[—–-]\s*Cambio documental:\s*\S/im.test(String(t).split(/\r?\n/).find((l) => l.trim()) || '');
const DOCS_DIR = '02-DOCS/wiki/project';
const DECISIONS = '02-DOCS/wiki/sdd/decisions.md';
/** Cuerpo (lineas no vacias) de la seccion cuyo encabezado markdown coincide con `re`; null si no existe. */
function headingBody(text, re) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((l) => { const m = l.match(/^#{1,6}\s*(?:\d+[.)]\s*)?(.*?)\s*:?\s*$/); return m && re.test(m[1]); });
  if (start < 0) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) { if (/^#{1,6}\s+\S/.test(lines[i])) break; if (lines[i].trim()) body.push(lines[i].replace(/\s+$/, '')); }
  return body;
}
const ID_DOCS = /^(?:REQ-F-\d+|REQ-NF-\d+|UC-\d+|ENT-\d+|ADR-\d+)$/;
/** Filas de la tabla `Documentos afectados`: [{ ids[], doc, agent }] (vacio si no hay tabla). */
export function affectedDocs(spec) {
  const body = headingBody(spec, /^documentos\s+afectados$/i) || [];
  const rows = [];
  for (const l of body) {
    if (!l.trim().startsWith('|')) continue;
    const c = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim());
    if (c.length < 3 || /^-+:?$/.test(c[0].replace(/\s/g, '')) || /^:?-{2,}/.test(c[0]) || /^id$/i.test(c[0])) continue;
    rows.push({ ids: c[0].split(/[\s,;]+/).filter(Boolean), doc: c[1], agent: c[2] });
  }
  return rows;
}
/**
 * ctx = { docs[], owners{}, defined: Set|null }: los siete documentos, el agente dueño de cada uno (y decisions) y los IDs de la base
 * (null = no se conoce y no se comprueba su existencia). Valida estructura, no que el contenido sea acertado.
 */
function lintDocs(spec, tasks, ctx) {
  const p = [];
  const { docs = [], owners = {}, defined = null } = ctx || {};
  if (!isDocsSpec(spec)) p.push("el titulo debe ser '# Spec — Cambio documental: <titulo>' (perfil docs)");
  if (surface(spec) !== 'none') p.push("Surface debe ser 'none': un cambio documental no tiene superficie");
  const adrV = adr(spec);
  if (adrV === null) p.push("sin linea 'ADR: none' o 'ADR: <titulo de la decision>'");
  for (const [name, re] of [['Objetivo', /^objetivo$/i], ['Cambio solicitado', /^cambio\s+solicitado$/i], ['Documentos afectados', /^documentos\s+afectados$/i], ['Impacto en jobs', /^impacto\s+en\s+jobs$/i]]) {
    const b = headingBody(spec, re);
    if (b === null) p.push(`sin seccion '${name}'`); else if (!b.length) p.push(`la seccion '${name}' esta vacia`);
  }
  const crit = headingBody(spec, /^criterios\s+de\s+aceptaci[oó]n$/i);
  if (crit === null) p.push("sin seccion 'Criterios de aceptación'");
  else if (!crit.some((l) => /^\s*\d+[.)]\s+\S/.test(l))) p.push("la seccion 'Criterios de aceptación' no tiene criterios numerados (1. ..., 2. ...)");

  const rows = affectedDocs(spec);
  if (headingBody(spec, /^documentos\s+afectados$/i)?.length && !rows.length) p.push("'Documentos afectados' debe ser una tabla | ID | Documento | Agente | con al menos una fila");
  const known = new Set([...docs, 'decisions']);
  for (const r of rows) {
    if (!known.has(r.doc)) p.push(`Documentos afectados: '${r.doc}' no es un documento de la base (${docs[0] ?? '00-vision'} … ${docs.at(-1) ?? '06-despliegue'} o decisions)`);
    else if (owners[r.doc] && r.agent !== owners[r.doc]) p.push(`Documentos afectados: ${r.doc} lo escribe ${owners[r.doc]}, no '${r.agent}'`);
    if (!r.ids.length) p.push(`Documentos afectados: la fila de ${r.doc} no dice que ID cambia (usa 'nuevo' si es contenido nuevo)`);
    for (const id of r.ids) {
      const u = id.toUpperCase();
      if (id === 'nuevo') continue;
      if (!ID_DOCS.test(u)) p.push(`Documentos afectados: '${id}' no es un ID de la base ni 'nuevo'`);
      else if (defined && !u.startsWith('ADR-') && !defined.has(u)) p.push(`Documentos afectados: ${u} no existe en la base documental (si es contenido nuevo, escribe 'nuevo')`);
    }
  }
  if (adrV && adrV !== 'none' && !rows.some((r) => r.doc === 'decisions')) p.push("ADR declarado: la tabla 'Documentos afectados' necesita su fila 'decisions' → architect");

  const al = headingBody(spec, /^alcance$/i);
  const entries = bullets(al);
  if (al === null || !entries.length) p.push("sin seccion 'Alcance' con al menos una ruta (- 02-DOCS/wiki/project/**)");
  for (const raw of entries) {
    const e = sinComentarioHtml(raw.replace(/`/g, '')).trim();
    if (e.startsWith('/') || e.split('/').includes('..') || e === '**' || e === '*') p.push(`Alcance: '${e}' sale de la base documental (solo ${DOCS_DIR}/ y, con ADR, ${DECISIONS})`);
    else if (e === DECISIONS) { if (adrV === null || adrV === 'none') p.push(`Alcance: ${DECISIONS} solo vale si el spec declara un ADR`); }
    else if (!e.startsWith(`${DOCS_DIR}/`)) p.push(`Alcance: '${e}' esta fuera de la base documental (solo ${DOCS_DIR}/ y, con ADR, ${DECISIONS})`);
  }
  if (adrV && adrV !== 'none' && !entries.some((x) => sinComentarioHtml(x.replace(/`/g, '')).trim() === DECISIONS)) p.push(`ADR declarado: ${DECISIONS} debe figurar en Alcance`);

  if (!String(tasks).trim()) p.push('falta tasks.md o esta vacio');
  else for (const d of new Set(rows.map((r) => r.doc).filter((d) => known.has(d)))) if (!String(tasks).includes(d)) p.push(`tasks.md no nombra el documento ${d} (una tarea por documento afectado, con su dueño)`);
  return p;
}

/**
 * `project` = { required, defined }: required => cada RF debe citar lo que implementa; defined = Set de IDs de la base (null si no se conoce).
 * Con la base exigida un conjunto vacio significa que ningun ID existe; sin exigirla solo se comprueba la existencia si hay base.
 */
export function lint(spec, tasks, profile = 'standard', project = null) {
  const p = [];
  const crit = criteria(spec);
  if (!String(spec).trim()) return ['falta spec.md o esta vacio'];
  if (profile === 'docs') return lintDocs(spec, tasks, project);
  if (!/^(page|none)$/.test(surface(spec))) p.push("sin linea 'Surface: page | none' valida");
  if (!crit.length) p.push('sin criterios de aceptacion numerados (1. ..., 2. ...)');
  if (!bullets(section(spec, 'alcance')).length) p.push("sin seccion 'Alcance' con al menos una ruta (- src/**)");
  if (!String(tasks).trim()) p.push('falta tasks.md o esta vacio');
  if (profile !== 'full') return p;

  if (adr(spec) === null) p.push("sin linea 'ADR: none' o 'ADR: <titulo de la decision>'");
  if (!bullets(section(spec, 'actores')).length) p.push("sin seccion 'Actores' (- <Actor>: <rol o interes>, al menos uno)");
  const rfLines = bullets(section(spec, 'rf'));
  const rfs = rfLines.map((l) => (l.match(/^\**\[?(RF-\d+)\]?\**\s*[:.)-]/i) || [])[1]?.toUpperCase());
  if (!rfLines.length) p.push("sin seccion 'Requisitos funcionales' (- RF-1: ...)");
  else if (rfs.some((x) => !x)) p.push("cada requisito funcional debe empezar por su id: '- RF-1: ...'");
  const ids = rfs.filter(Boolean);
  if (new Set(ids).size !== ids.length) p.push('hay ids RF-n repetidos');
  rfLines.forEach((l, i) => {
    if (!rfs[i]) return;
    const m = l.match(IMPLEMENTA_LINE);
    if (!m) { if (project?.required) p.push(`${rfs[i]} sin 'Implementa: REQ-F-n, UC-n' (el proyecto exige que cada requisito del spec cite lo que implementa de la base documental)`); return; }
    const cited = idList(m[1]);
    if (!cited.length) { p.push(`${rfs[i]}: 'Implementa:' está vacío`); return; }
    for (const raw of cited) {
      const id = raw.toUpperCase();
      if (!ID_IMPLEMENTA.test(id)) p.push(`${rfs[i]}: '${raw}' no es un ID de la base (REQ-F-n, REQ-NF-n, UC-n o ENT-n)`);
      else if (project?.defined && (project.required || project.defined.size) && !project.defined.has(id)) p.push(`${rfs[i]} cita ${id} en Implementa, que no está definido en la base documental`);
    }
  });
  if (!(section(spec, 'diseno') || []).length) p.push("sin seccion 'Diseño' (componentes, interfaces y decisiones; al menos una linea)");
  const cited = new Set();
  crit.forEach((c, i) => {
    const refs = [...c.matchAll(/\[(RF-\d+)\]/gi)].map((m) => m[1].toUpperCase());
    if (!refs.length) p.push(`el criterio ${i + 1} no cita ningun requisito ([RF-n])`);
    for (const r of refs) { if (!ids.includes(r)) p.push(`el criterio ${i + 1} cita ${r}, que no esta declarado`); cited.add(r); }
  });
  for (const id of ids) {
    if (!cited.has(id)) p.push(`${id} no esta cubierto por ningun criterio de aceptacion`);
    if (!new RegExp(`\\b${id}\\b`, 'i').test(tasks)) p.push(`${id} no aparece en tasks.md (cada tarea cita el RF que cubre)`);
  }
  return p;
}

export function summary(spec) {
  const out = [`Surface: ${surface(spec) || '?'} | criterios: ${criteria(spec).length}`];
  const a = bullets(section(spec, 'actores')); if (a.length) out.push(`Actores (${a.length}): ${a.map((x) => x.split(':')[0]).join(', ')}`);
  const r = bullets(section(spec, 'rf')); if (r.length) out.push(`Requisitos funcionales: ${r.length}`);
  const im = implementaIds(spec); if (im.length) out.push(`Implementa (${im.length}): ${im.join(', ')}`);
  const ad = affectedDocs(spec); if (ad.length) out.push(`Documentos afectados (${ad.length}): ${ad.map((r) => `${r.doc} (${r.agent})`).join(', ')}`);
  const al = bullets(section(spec, 'alcance')); out.push(`Alcance: ${al.slice(0, 8).join(', ') || '(vacio)'}`);
  const d = adr(spec); if (d && d !== 'none') out.push(`ADR a registrar: ${d}`);
  return out;
}

// Sin top-level await: project-lint importa este modulo, y un await aqui dejaria el ciclo sin resolver.
async function cli(argv) {
  const pos = [];
  const usage = () => { console.error('uso: spec-lint.mjs check <spec> <tasks> [standard|full] [--root R] | adr <spec> | summary <spec> | page <spec> <pagina>'); return 64; };
  let root = null;
  for (let i = 0; i < argv.length; i++) { if (argv[i] === '--root' && argv[i + 1]) root = argv[++i]; else if (argv[i].startsWith('--')) return usage(); else pos.push(argv[i]); }
  const [mode, specPath, tasksPath, profile] = pos;
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const out = (p) => { p.forEach((x) => console.log(x)); return p.length ? 1 : 0; };
  if (mode === 'check') {
    let project = null;
    if ((profile || 'standard') === 'full') { try { project = (await import('./project-lint.mjs')).projectContext({ specPath, root }); } catch { project = null; } }
    if (profile === 'docs') {
      try { const pl = await import('./project-lint.mjs'); project = { docs: pl.DOCS, owners: { ...pl.OWNERS, decisions: 'architect' }, defined: pl.projectContext({ specPath, root }).defined }; }
      catch { project = { docs: [], owners: {}, defined: null }; }
    }
    return out(lint(read(specPath), read(tasksPath), profile || 'standard', project));
  }
  if (mode === 'adr') { console.log(adr(read(specPath)) ?? 'none'); return 0; }
  if (mode === 'summary') { summary(read(specPath)).forEach((x) => console.log(x)); return 0; }
  if (mode === 'page') return out(pageProblems(read(specPath), read(tasksPath)));
  return usage();
}
if (import.meta.url === `file://${process.argv[1]}`) cli(process.argv.slice(2)).then((code) => process.exit(code));
