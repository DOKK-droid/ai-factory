#!/usr/bin/env node
/**
 * spec-lint.mjs — valida la ESTRUCTURA de spec.md y tasks.md (no su acierto). Lo usa next-step.sh (estado 2).
 *
 * Perfiles (factory/project.json -> "spec_profile"):
 *   standard  Surface, criterios numerados, Alcance con rutas, tasks.md.                         (por defecto)
 *   full      + ADR, Actores, Requisitos funcionales (RF-n), Diseño, y trazabilidad:
 *             cada criterio cita [RF-n] existentes, cada RF lo cubre >=1 criterio y aparece en tasks.md.
 *
 * Las secciones se escriben como "## Actores" o como "Actores:" (ambas valen).
 *
 * Uso:
 *   node spec-lint.mjs check   <spec.md> <tasks.md> [standard|full]   -> un problema por linea; sale 0 si no hay
 *   node spec-lint.mjs adr     <spec.md>                              -> "none" o el titulo del ADR declarado
 *   node spec-lint.mjs summary <spec.md>                              -> resumen para el humano (una linea por dato)
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
export const adr = (t) => {
  const v = (String(t).match(/^adr:\s*(.*?)\s*$/im) || [])[1];
  if (v === undefined) return null;               // sin linea ADR
  return v === '' || /^(none|ninguno|ninguna|n\/a|no)$/i.test(v) ? 'none' : v;
};
const criteria = (t) => String(t).split(/\r?\n/).filter((l) => /^\s*\d+[.)]\s+\S/.test(l)).map((l) => l.replace(/^\s*\d+[.)]\s+/, ''));

export function lint(spec, tasks, profile = 'standard') {
  const p = [];
  const crit = criteria(spec);
  if (!String(spec).trim()) return ['falta spec.md o esta vacio'];
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
  const al = bullets(section(spec, 'alcance')); out.push(`Alcance: ${al.slice(0, 8).join(', ') || '(vacio)'}`);
  const d = adr(spec); if (d && d !== 'none') out.push(`ADR a registrar: ${d}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, specPath, tasksPath, profile] = process.argv.slice(2);
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  if (mode === 'check') { const p = lint(read(specPath), read(tasksPath), profile || 'standard'); p.forEach((x) => console.log(x)); process.exit(p.length ? 1 : 0); }
  else if (mode === 'adr') console.log(adr(read(specPath)) ?? 'none');
  else if (mode === 'summary') summary(read(specPath)).forEach((x) => console.log(x));
  else { console.error('uso: spec-lint.mjs check <spec> <tasks> [standard|full] | adr <spec> | summary <spec>'); process.exit(64); }
}
