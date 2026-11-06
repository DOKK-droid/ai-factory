#!/usr/bin/env node
/**
 * brain-request.mjs — peticiones de cambio al Brain NORMATIVO (REQ, UC, dominio, arquitectura, ADR) de un job.
 *
 * Un agente que detecta que el codigo contradice o amplia el Brain no lo edita: escribe un bloque en
 * factory/jobs/<id>/brain-request.md. El job se detiene hasta que el humano crea factory/jobs/<id>/brain.ok (mas reciente que la
 * peticion). Solo entonces un agente de documentacion aplica el cambio en la rama del job y se commitea con
 * `commit-brain.sh <id> --project BR-n` (la linea `Brain-Request: BR-n` del commit es lo que marca la peticion como aplicada).
 * next-step.sh solo llama a `state` y traduce su primera palabra; toda la logica vive aqui y se prueba aqui.
 *
 * Formato (un bloque por peticion; todos los campos son obligatorios, el valor puede seguir en lineas siguientes):
 *   ## BR-1
 *   Documento: 01-requisitos        (00-vision ... 06-despliegue, o decisions para un ADR)
 *   Ids: REQ-F-3                    (IDs afectados, separados por coma; "-" si es contenido nuevo)
 *   Solicitante: builder
 *   Cita: src/cart.js#L40           (donde se ve la contradiccion)
 *   Motivo: ...
 *   Cambio propuesto: ...
 *
 * Uso:
 *   node brain-request.mjs check <brain-request.md>
 *   node brain-request.mjs state --job-dir D --job-id ID --worktree W --base REF
 * `state` imprime en la PRIMERA linea una de: NONE | INVALID | CONFIRM | APPLY <BR> | COMMIT [<BR>] | ALIGN | REAPPROVE | DONE
 * y despues lineas `CLAVE: valor` (WHY, OWNER, FILES, WHAT, BR, DOCS, CMD). Cualquier otra cosa debe tratarse como INVALID.
 * Salida: 0 siempre que `state` haya podido responder; `check` sale 1 si hay problemas; 64 uso incorrecto.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyze, DOCS, OWNERS } from './project-lint.mjs';

export const PROJECT_DIR = '02-DOCS/wiki/project';
export const DECISIONS = '02-DOCS/wiki/sdd/decisions.md';
const FIELDS = ['Documento', 'Ids', 'Solicitante', 'Cita', 'Motivo', 'Cambio propuesto'];
const ID_HOME = { REQ: '01-requisitos', UC: '02-casos-de-uso', ENT: '03-dominio' };
const ID_OK = /^(?:REQ-F-\d+|REQ-NF-\d+|UC-\d+|ENT-\d+|ADR-\d+)$/;
const owner = (doc) => (doc === 'decisions' ? 'architect' : OWNERS[doc]);
const flat = (s, n = 300) => String(s).replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** Texto -> { blocks: [{ id, fields, line }], problems: [] } */
export function parse(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [], problems = [];
  let cur = null, last = null;
  lines.forEach((l, i) => {
    const h = l.match(/^##\s+(BR-\d+)\s*$/);
    if (h) { cur = { id: h[1], fields: {}, line: i + 1 }; blocks.push(cur); last = null; return; }
    if (!cur) return;
    const f = l.match(/^(Documento|Ids|Solicitante|Cita|Motivo|Cambio propuesto):\s*(.*)$/);
    if (f) { cur.fields[f[1]] = f[2].trim(); last = f[1]; }
    else if (last && l.trim() && !/^#{1,6}\s/.test(l)) cur.fields[last] = `${cur.fields[last]} ${l.trim()}`.trim();
  });
  if (!blocks.length) problems.push('no hay ningún bloque "## BR-n"');
  const seen = new Set();
  for (const b of blocks) {
    if (seen.has(b.id)) problems.push(`${b.id}: repetido`); seen.add(b.id);
    for (const k of FIELDS) if (!b.fields[k]) problems.push(`${b.id}: falta el campo ${k}`);
    const doc = b.fields.Documento;
    if (doc && ![...DOCS, 'decisions'].includes(doc)) problems.push(`${b.id}: Documento debe ser ${DOCS[0]} … ${DOCS.at(-1)} o decisions (tiene: ${flat(doc, 40)})`);
    const ids = (b.fields.Ids || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (b.fields.Ids && !(ids.length === 1 && ids[0] === '-')) for (const id of ids) {
      if (!ID_OK.test(id)) problems.push(`${b.id}: Ids tiene "${flat(id, 30)}", que no es un ID válido (o "-" si es contenido nuevo)`);
      else if (doc && DOCS.includes(doc) && ID_HOME[id.split('-')[0]] && ID_HOME[id.split('-')[0]] !== doc) problems.push(`${b.id}: ${id} no se define en ${doc}`);
      else if (doc === 'decisions' && !id.startsWith('ADR-')) problems.push(`${b.id}: en decisions solo caben ADR-n`);
    }
    if (b.fields.Solicitante && !/^[a-z][a-z-]*$/.test(b.fields.Solicitante)) problems.push(`${b.id}: Solicitante debe ser el id de un agente`);
  }
  return { blocks, problems };
}

const git = (wt, ...a) => execFileSync('git', ['--no-optional-locks', '-C', wt, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Ids de peticion ya aplicadas: lineas `Brain-Request: BR-n` en los commits de la rama del job (base..HEAD). */
export function appliedIds(wt, base) {
  const out = git(wt, 'log', '--format=%B', `${base}..HEAD`);
  return new Set([...out.matchAll(/^Brain-Request:\s*(BR-\d+)\s*$/gm)].map((m) => m[1]));
}

/** Rutas con cambios sin commitear que son de la base documental o de decisions.md. */
export function dirtyProject(wt) {
  const out = git(wt, 'status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0').filter(Boolean);
  return out.map((e) => e.slice(3)).filter((p) => p.startsWith(`${PROJECT_DIR}/`) || p === DECISIONS);
}

const reply = (first, kv = []) => [first, ...kv.flatMap(([k, v]) => String(v).split('\n').filter(Boolean).map((x) => `${k}: ${x}`))].join('\n');
const invalid = (...why) => reply('INVALID', [['WHY', why.join('\n')]]);

export function state({ jobDir, jobId, worktree, base }) {
  const file = path.join(jobDir, 'brain-request.md');
  if (!fs.existsSync(file)) return reply('NONE');
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return invalid(`no pude leer ${file}`); }
  const { blocks, problems } = parse(text);
  if (problems.length) return invalid(...problems.slice(0, 8), `corrige factory/jobs/${jobId}/brain-request.md`);
  let applied, dirty;
  try { applied = appliedIds(worktree, base); dirty = dirtyProject(worktree); } catch (e) { return invalid(`no pude leer el historial de git de la worktree (${flat(e.message, 120)})`); }
  const pending = blocks.filter((b) => !applied.has(b.id));
  const wtRel = `factory/worktrees/${jobId}`;
  const docPath = (b) => `${wtRel}/${b.fields.Documento === 'decisions' ? DECISIONS : `${PROJECT_DIR}/${b.fields.Documento}.md`}`;
  const sum = (b) => `${b.id} ${b.fields.Documento} ${b.fields.Ids} (${b.fields.Solicitante}): ${flat(b.fields.Motivo, 160)}`;

  if (pending.length) {
    const ok = path.join(jobDir, 'brain.ok');
    const fresh = fs.existsSync(ok) && fs.statSync(ok).mtimeMs > fs.statSync(file).mtimeMs;
    if (!fresh) return reply('CONFIRM', [['WHY', [`hay ${pending.length} petición(es) de cambio al Brain sin confirmar:`, ...pending.map(sum), `Lee factory/jobs/${jobId}/brain-request.md; si estás de acuerdo, confirma con el CMD (solo el humano crea esta marca).`].join('\n')], ['CMD', `touch factory/jobs/${jobId}/brain.ok`]]);
    const b = pending[0];
    if (dirty.length) return reply('COMMIT', [['BR', b.id], ['WHY', `hay cambios sin commitear en la base documental para ${b.id}`], ['CMD', `cd ${wtRel} && bash 01-TOOLS/commit-brain.sh ${jobId} --project ${b.id}`]]);
    return reply(`APPLY ${b.id}`, [['BR', b.id], ['OWNER', owner(b.fields.Documento)], ['FILES', docPath(b)],
      ['WHAT', `aplicar la petición ${b.id} confirmada por el humano en ${b.fields.Documento}: ${flat(b.fields['Cambio propuesto'], 300)}. Edita solo ese documento en la worktree; si cambia un documento aprobado, deja estado: desactualizado y sube la versión; cada hecho nuevo lleva su etiqueta de origen`],
      ['WHY', `${sum(b)}`]]);
  }
  if (dirty.length) return reply('COMMIT', [['BR', '-'], ['WHY', 'hay cambios sin commitear en la base documental (alineación o aprobación)'], ['CMD', `cd ${wtRel} && bash 01-TOOLS/commit-brain.sh ${jobId} --project`]]);

  // Todas aplicadas y commiteadas: la base aprobada debe seguir coherente. Solo se mira lo que ya tiene aprobacion registrada.
  let a;
  try { a = analyze({ root: worktree, strict: false }); } catch (e) { return invalid(`project-lint falló (${flat(e.message, 120)})`); }
  const approved = new Set(Object.keys(a.reg.docs));
  if (!approved.size) return reply('DONE');
  const errs = a.problems.filter((p) => p.sev === 'E' && approved.has(p.doc));
  if (errs.length) {
    const doc = errs[0].doc;
    return reply('ALIGN', [['OWNER', owner(doc)], ['FILES', `${wtRel}/${PROJECT_DIR}/${doc}.md`],
      ['WHAT', `alinear ${doc} con los cambios aplicados al Brain: corrige lo que reporta project-lint; si el contenido cambia, deja estado: desactualizado y sube la versión; no toques otros documentos`],
      ['WHY', errs.slice(0, 8).map((p) => `${p.code} ${p.doc}.md${p.line ? ':' + p.line : ''} ${flat(p.msg, 140)}`).join('\n')]]);
  }
  const stale = DOCS.filter((d) => a.states[d] === 'DESACTUALIZADO');
  if (stale.length) return reply('REAPPROVE', [['DOCS', stale.join(' ')], ['WHY', `la base documental cambió y estos documentos necesitan aprobación humana: ${stale.join(', ')}`], ['CMD', `cd ${wtRel} && node factory/scripts/project-lint.mjs approve ${stale.join(' ')}`]]);
  return reply('DONE');
}

function cli(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'check' && rest[0]) {
    let t; try { t = fs.readFileSync(rest[0], 'utf8'); } catch { console.log(`no existe ${rest[0]}`); return 1; }
    const { problems } = parse(t); problems.forEach((p) => console.log(p)); return problems.length ? 1 : 0;
  }
  if (cmd === 'state') {
    const o = {};
    for (let i = 0; i < rest.length; i += 2) { const k = rest[i]?.replace(/^--/, ''); if (!['job-dir', 'job-id', 'worktree', 'base'].includes(k) || !rest[i + 1]) { console.log(invalid('uso: state --job-dir D --job-id ID --worktree W --base REF')); return 0; } o[k] = rest[i + 1]; }
    if (!['job-dir', 'job-id', 'worktree', 'base'].every((k) => o[k])) { console.log(invalid('uso: state --job-dir D --job-id ID --worktree W --base REF')); return 0; }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/.test(o['job-id']) || o['job-id'].includes('..')) { console.log(invalid('job-id inválido')); return 0; }
    console.log(state({ jobDir: o['job-dir'], jobId: o['job-id'], worktree: o.worktree, base: o.base })); return 0;
  }
  console.error('uso: brain-request.mjs check <archivo> | state --job-dir D --job-id ID --worktree W --base REF'); return 64;
}
if (import.meta.url === `file://${process.argv[1]}`) process.exit(cli(process.argv.slice(2)));
