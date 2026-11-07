#!/usr/bin/env node
/**
 * docs-job.mjs — la logica del job de documentacion (kind: docs, RF-I9): un cambio de la base documental del proyecto
 * (02-DOCS/wiki/project/) sin builder. Los agentes dueños de cada documento sustituyen al builder; el resto del pipeline
 * (reviewers, approver, human-gate, PR) es el de siempre. next-step.sh solo llama a `state` y traduce la primera palabra de la
 * respuesta; toda la logica vive aqui y se prueba aqui. Cualquier otra respuesta es un STOP en next-step.sh (fallar cerrado).
 *
 * Uso:
 *   node docs-job.mjs state --phase work|fix|changes|approve --job-dir D --job-id ID --worktree W --base REF
 *   node docs-job.mjs gate  --job-dir D --merge-base SHA          (desde la worktree; lo ejecuta checks.sh en modo docs)
 *
 * state imprime en la PRIMERA linea una palabra y despues lineas `CLAVE: valor` (CMD, OWNER, FILES, WHAT, WHY):
 *   --phase work     (trabajo antes del gate)
 *       COMMIT   hay cambios sin commitear en la base: RUN de commit-brain.sh --project            [CMD, WHY]
 *       WORK     un documento afectado aun sin trabajo (o sigue siendo plantilla): DELEGATE al dueño [OWNER, FILES, WHAT, WHY]
 *       ALIGN    un documento aprobado quedo incoherente por el cambio: DELEGATE a su dueño         [OWNER, FILES, WHAT, WHY]
 *       TRACE    trazabilidad.md existe y esta desfasada: RUN de project-lint trace --write          [CMD, WHY]
 *       READY    el trabajo esta hecho: sigue el gate
 *   --phase fix      (GATE: FAIL): WORK | TRACE | HUMAN (marcadores abiertos o ediciones fuera de alcance: lo resuelve el humano)
 *   --phase changes  (decision.md = CHANGES): WORK al dueño del documento que nombra la decision
 *   --phase approve  (antes del Brain del job): OK (la base ya esta aprobada y fresca) | CONFIRM (el humano aprueba; CMD si hay algo aprobable)
 *   En cualquier fase: INVALID [WHY] cuando no puede decidir (falla cerrado).
 * gate sale 0 si PASS y 1 si FAIL (o si no puede calcularlo); imprime las lineas que checks.sh vuelca en gate.md:
 *   FUERA_DE_ALCANCE<TAB>ruta · PLxxx E doc.md:linea msg · ABIERTO doc.md:linea [ETIQUETA] · PLANTILLA doc.md ...
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyze, gate as projectGate, DOCS, OWNERS, fmt } from './project-lint.mjs';
import { affectedDocs, adr as specAdr } from './spec-lint.mjs';
import { dirtyProject, PROJECT_DIR, DECISIONS } from './brain-request.mjs';
import { parseScope, globToRegExp, listChanges } from './scope-check.mjs';

const ORDER = ['00-vision', '01-requisitos', '02-casos-de-uso', '03-dominio', '04-arquitectura', 'decisions', '05-datos', '06-despliegue'];
const owner = (doc) => (doc === 'decisions' ? 'architect' : OWNERS[doc]);
const docFile = (doc) => (doc === 'decisions' ? DECISIONS : `${PROJECT_DIR}/${doc}.md`);
const flat = (s, n = 300) => String(s).replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const git = (cwd, ...a) => execFileSync('git', ['--no-optional-locks', '-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const reply = (first, kv = []) => [first, ...kv.flatMap(([k, v]) => String(v).split('\n').filter(Boolean).map((x) => `${k}: ${x}`))].join('\n');
const invalid = (...why) => reply('INVALID', [['WHY', why.join('\n')]]);
const byOrder = (docs) => [...new Set(docs)].filter((d) => ORDER.includes(d)).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

/** Instruccion comun para el agente dueño de un documento. */
function task({ lead, doc, jobId, adrNote = '' }) {
  const file = docFile(doc);
  return flat(`${lead} Lee factory/jobs/${jobId}/spec.md (Cambio solicitado y Documentos afectados) e input.md. Edita solo ${file} en la worktree. Cada hecho nuevo lleva su etiqueta de origen y lo que el humano no confirmo queda [PENDIENTE] con su pregunta (no lo inventes). ${doc === 'decisions' ? adrNote : 'Si el documento estaba aprobado, deja estado: desactualizado y sube la version; nunca escribas estado: aprobado (lo hace el humano con project-lint approve).'} No hagas git add ni commit.`, 900);
}
const nextAdr = (text) => `ADR-${String(Math.max(0, ...[...text.matchAll(/^##\s+ADR-0*(\d+):/gm)].map((m) => +m[1])) + 1).padStart(3, '0')}`;

function ctxOf(o) {
  const { jobDir, jobId, worktree } = o;
  if (!worktree || !fs.existsSync(worktree)) throw new Error(`no existe la worktree ${worktree}`);
  return { ...o, wtRel: `factory/worktrees/${jobId}`, spec: read(path.join(jobDir, 'spec.md')) };
}
const specRows = (spec) => affectedDocs(spec);

function stateWork(c) {
  const rows = specRows(c.spec);
  if (!rows.length) return invalid(`spec.md no tiene la tabla 'Documentos afectados' (| ID | Documento | Agente |): sin ella no se que documentos cambian`, `corrige factory/jobs/${c.jobId}/spec.md`);
  const dirty = dirtyProject(c.worktree);
  if (dirty.length) return reply('COMMIT', [['WHY', `hay cambios sin commitear en la base documental (${dirty.slice(0, 4).join(', ')})`], ['CMD', `cd ${c.wtRel} && bash 01-TOOLS/commit-brain.sh ${c.jobId} --project`]]);
  const mb = git(c.worktree, 'merge-base', c.base, 'HEAD').trim();
  const changed = new Set(git(c.worktree, 'diff', '--name-only', mb, 'HEAD').split('\n').filter(Boolean));
  const a = analyze({ root: c.worktree });
  const adrTitle = specAdr(c.spec);
  for (const doc of byOrder(rows.map((r) => r.doc))) {
    const st = a.states[doc];
    const touched = changed.has(docFile(doc));
    if (touched && st !== 'PLANTILLA' && st !== 'AUSENTE') continue;
    const row = rows.find((r) => r.doc === doc);
    const status = fs.existsSync(path.join(c.jobDir, 'spec.ok')) ? 'Aprobado' : 'Propuesto';
    const dec = read(path.join(c.worktree, DECISIONS));
    const adrNote = adrTitle && adrTitle !== 'none'
      ? `Registra '## ${nextAdr(dec)}: ${adrTitle}' con la linea 'Estado: ${status}' (el estado lo fija el flujo: ${status === 'Aprobado' ? 'el humano confirmo el spec con spec.ok' : 'nadie lo aprobo todavia'}), contexto, decision y alternativas.`
      : 'Registra el ADR que pide el spec.';
    const why = !touched ? `${doc} figura en 'Documentos afectados' (${row.ids.join(', ')}) y aun no tiene cambios` : `${doc} sigue siendo una plantilla (marcadores RELLENAR): termina de rellenarla`;
    return reply('WORK', [['OWNER', owner(doc)], ['FILES', `${c.wtRel}/${docFile(doc)}`], ['WHAT', task({ lead: `Aplica el cambio documental de ${doc}: ${row.ids.join(', ')}.`, doc, jobId: c.jobId, adrNote })], ['WHY', why]]);
  }
  const approved = new Set(Object.keys(a.reg.docs));
  const errs = a.problems.filter((p) => p.sev === 'E' && approved.has(p.doc));
  if (errs.length) {
    const doc = errs[0].doc;
    return reply('ALIGN', [['OWNER', owner(doc)], ['FILES', `${c.wtRel}/${docFile(doc)}`],
      ['WHAT', task({ lead: `Alinea ${doc} con el cambio documental de este job: corrige lo que reporta project-lint; si su contenido o lo que cita cambio, deja estado: desactualizado y sube la version; no toques otros documentos.`, doc, jobId: c.jobId })],
      ['WHY', errs.filter((p) => p.doc === doc).slice(0, 8).map((p) => `${fmt(p)}`).join('\n')]]);
  }
  if (a.problems.some((p) => p.code === 'PL061')) return reply('TRACE', [['WHY', 'trazabilidad.md esta desfasada respecto a los documentos (es un archivo generado)'], ['CMD', `cd ${c.wtRel} && node factory/scripts/project-lint.mjs trace --write`]]);
  return reply('READY');
}

const PL_LINE = /^(PL\d{3}) E (\S+?)(?::(\d+))? (.*)$/;
function stateFix(c) {
  const gate = read(path.join(c.jobDir, 'gate.md'));
  if (!gate) return invalid(`no pude leer factory/jobs/${c.jobId}/gate.md`);
  const lines = gate.split(/\r?\n/);
  if (lines[0].trim() !== 'GATE: FAIL') return invalid(`gate.md no esta en GATE: FAIL (linea 1: '${flat(lines[0], 40)}')`);
  const open = lines.filter((l) => l.startsWith('ABIERTO '));
  const out = lines.filter((l) => /^(FUERA_DE_ALCANCE|BORRADO_FUERA_DE_ALCANCE)\t/.test(l));
  if (open.length || out.length) {
    return reply('HUMAN', [['WHY', [
      open.length ? `hay ${open.length} marcador(es) sin resolver ([PENDIENTE]/[PROPUESTO]/[INFERIDO]) en los documentos tocados; solo el humano los confirma (respondiendo a discovery o editando el documento):` : '',
      ...open.slice(0, 8).map((l) => `  ${flat(l, 160)}`),
      out.length ? `hay ${out.length} archivo(s) cambiados fuera del alcance del spec; un agente no los revierte: reviertelos tu o amplia el spec:` : '',
      ...out.slice(0, 8).map((l) => `  ${l.replace('\t', ' ')}`),
    ].filter(Boolean).join('\n')]]);
  }
  const pls = lines.map((l) => l.match(PL_LINE)).filter(Boolean).map((m) => ({ code: m[1], doc: m[2].replace(/\.md$/, ''), line: flat(m[0], 200) }));
  const tpl = lines.map((l) => l.match(/^PLANTILLA (\S+?)\.md /)).filter(Boolean).map((m) => ({ code: 'PLANTILLA', doc: m[1], line: flat(m[0], 200) }));
  const all = [...pls, ...tpl];
  if (!all.length) return invalid('gate.md esta en FAIL pero no encuentro el motivo (ni PLxxx, ni ABIERTO, ni FUERA_DE_ALCANCE, ni PLANTILLA): leelo a mano');
  if (all.every((p) => p.code === 'PL061')) return reply('TRACE', [['WHY', 'solo falla la trazabilidad generada'], ['CMD', `cd ${c.wtRel} && node factory/scripts/project-lint.mjs trace --write`]]);
  const doc = byOrder(all.map((p) => p.doc))[0];
  if (!doc) return reply('HUMAN', [['WHY', `el gate falla en ${[...new Set(all.map((p) => p.doc))].join(', ')}, que no es un documento que un agente escriba: ${all[0].line}`]]);
  return reply('WORK', [['OWNER', owner(doc)], ['FILES', `${c.wtRel}/${docFile(doc)}`],
    ['WHAT', task({ lead: `Corrige ${doc} segun lo que reporta factory/jobs/${c.jobId}/gate.md.`, doc, jobId: c.jobId })],
    ['WHY', all.filter((p) => p.doc === doc).slice(0, 8).map((p) => p.line).join('\n')]]);
}

function stateChanges(c) {
  const dec = read(path.join(c.jobDir, 'decision.md'));
  if (!dec) return invalid(`no pude leer factory/jobs/${c.jobId}/decision.md`);
  const named = ORDER.filter((d) => new RegExp(`(?<![\\w-])${d}(?![\\w-])`).test(dec));
  let doc = byOrder(named)[0];
  let why = doc ? `decision.md nombra ${named.join(', ')}` : '';
  if (!doc) {
    const rows = specRows(c.spec);
    if (!rows.length) return invalid('decision.md no nombra ningun documento y spec.md no tiene la tabla Documentos afectados');
    doc = byOrder(rows.map((r) => r.doc))[0]; why = `decision.md no nombra un documento: se empieza por ${doc}, el primero de Documentos afectados`;
  }
  return reply('WORK', [['OWNER', owner(doc)], ['FILES', `${c.wtRel}/${docFile(doc)}`],
    ['WHAT', task({ lead: `Aplica los cambios que pide el approver para ${doc}: lee factory/jobs/${c.jobId}/decision.md y factory/jobs/${c.jobId}/round-*/review-*.md; si piden cambiar otro documento, no lo toques e informalo.`, doc, jobId: c.jobId })],
    ['WHY', why]]);
}

function stateApprove(c) {
  const lines = projectGate({ root: c.worktree });
  if (!lines.length) return reply('OK');
  const a0 = analyze({ root: c.worktree });
  const cand = DOCS.filter((d) => ['LISTO', 'DESACTUALIZADO'].includes(a0.states[d]));
  const a1 = analyze({ root: c.worktree, approving: cand });
  const bad = new Set(a1.problems.filter((p) => p.sev === 'E' && !['PL050', 'PL051', 'PL053'].includes(p.code)).map((p) => p.doc));
  const ok = cand.filter((d) => !bad.has(d));
  const kv = [['WHY', [`la base documental de este job no esta aprobada y fresca; la aprueba el humano:`, ...lines.slice(0, 12)].join('\n')]];
  if (ok.length) kv.push(['CMD', `cd ${c.wtRel} && node factory/scripts/project-lint.mjs approve ${ok.join(' ')}`]);
  return reply('CONFIRM', kv);
}

export function state(o) {
  try {
    const c = ctxOf(o);
    switch (o.phase) {
      case 'work': return stateWork(c);
      case 'fix': return stateFix(c);
      case 'changes': return stateChanges(c);
      case 'approve': return stateApprove(c);
      default: return invalid(`fase desconocida '${flat(o.phase, 30)}' (work|fix|changes|approve)`);
    }
  } catch (e) { return invalid(`docs-job.mjs no pudo decidir (${flat(e.message, 160)})`); }
}

// ---------------------------------------------------------------- gate del job de documentacion
const CURATOR = ['02-DOCS/wiki/jobs/', '02-DOCS/wiki/index.md'];
export function gateRun({ jobDir, mergeBase, root = process.cwd() }) {
  const out = [];
  let failed = false;
  const fail = (name) => { failed = true; out.push(`   FALLO: ${name}`); };
  const specText = read(path.join(jobDir, 'spec.md'));
  if (!specText) { out.push(`-> alcance: no existe ${path.join(jobDir, 'spec.md')}`); fail('alcance'); return { out, ok: false }; }
  const scope = parseScope(specText);
  const globs = scope.globs.map((g) => g.replace(/\s*<!--.*$/, '')).map((g) => ({ g, re: globToRegExp(g) }));
  const adrTitle = specAdr(specText);
  const changes = listChanges(mergeBase, root);
  const inBase = changes.filter((c) => c.path.startsWith(`${PROJECT_DIR}/`));
  out.push(`-> cambios detectados vs ${mergeBase.slice(0, 7)}: ${changes.length} archivos (${inBase.length} en la base documental)`);

  // 1. alcance: la base (o lo que el Alcance declare dentro de ella), decisions.md con ADR, y lo derivado o del curator
  const outside = [];
  for (const c of changes) {
    const p = c.path;
    if (p === DECISIONS) { if (!(adrTitle && adrTitle !== 'none' && globs.some((x) => x.re.test(p)))) outside.push(p); continue; }
    if (p.startsWith(`${PROJECT_DIR}/`)) { if (/\/(project\.ok|trazabilidad\.md)$/.test(p) || globs.some((x) => x.re.test(p))) continue; outside.push(p); continue; }
    if (CURATOR.some((x) => p === x || p.startsWith(x))) continue;
    outside.push(p);
  }
  if (!scope.found || !globs.length) { out.push('-> alcance: el spec no tiene la seccion Alcance con rutas'); fail('alcance'); }
  else if (outside.length) { outside.forEach((p) => out.push(`FUERA_DE_ALCANCE\t${p}`)); fail('alcance'); }
  else if (!inBase.length) { out.push('-> alcance: el job no cambia la base documental'); fail('alcance'); }
  else out.push('-> alcance: OK');

  // 2. sintaxis: project.ok es JSON valido y los documentos son markdown
  const okFile = changes.find((c) => c.path === `${PROJECT_DIR}/project.ok` && c.status !== 'D');
  let syn = true;
  if (okFile) { try { JSON.parse(read(path.join(root, okFile.path))); } catch { out.push(`   SINTAXIS ${okFile.path}: JSON invalido`); syn = false; } }
  for (const c of inBase) if (c.status !== 'D' && !/\.(md|ok)$/.test(c.path)) { out.push(`   SINTAXIS ${c.path}: la base documental solo lleva .md y project.ok`); syn = false; }
  if (syn) out.push('-> sintaxis: OK (archivos cambiados)'); else fail('sintaxis');

  // 3. project-lint check --strict
  const a = analyze({ root, strict: true });
  const errs = a.problems.filter((p) => p.sev === 'E');
  const touched = DOCS.filter((d) => changes.some((c) => c.path === `${PROJECT_DIR}/${d}.md`));
  const tpl = touched.filter((d) => a.states[d] === 'PLANTILLA');
  if (errs.length) { errs.forEach((p) => out.push(fmt(p))); fail('project-lint'); }
  else out.push('-> project-lint check --strict: OK');
  if (tpl.length) { tpl.forEach((d) => out.push(`PLANTILLA ${d}.md sigue siendo una plantilla (marcadores RELLENAR)`)); fail('plantillas'); }

  // 4. nada sin confirmar en los documentos tocados
  const open = [];
  for (const d of touched) a.docs[d].m.forEach((l, i) => { for (const m of l.matchAll(/\[(PENDIENTE|PROPUESTO|INFERIDO)\b[^\]]*\]/g)) open.push(`ABIERTO ${d}.md:${i + 1} [${m[1]}] ${flat(l.trim(), 90)}`); });
  if (open.length) { open.forEach((l) => out.push(l)); fail('marcadores-abiertos'); }
  else out.push('-> marcadores abiertos: OK (ningun [PENDIENTE]/[PROPUESTO]/[INFERIDO] en los documentos tocados)');
  return { out, ok: !failed };
}

function cli(argv) {
  const [cmd, ...rest] = argv;
  const opts = (names) => {
    const o = {};
    for (let i = 0; i < rest.length; i += 2) { const k = rest[i]?.replace(/^--/, ''); if (!names.includes(k) || rest[i + 1] === undefined) return null; o[k] = rest[i + 1]; }
    return names.every((k) => o[k]) ? o : null;
  };
  if (cmd === 'state') {
    const o = opts(['phase', 'job-dir', 'job-id', 'worktree', 'base']);
    if (!o) { console.log(invalid('uso: state --phase work|fix|changes|approve --job-dir D --job-id ID --worktree W --base REF')); return 0; }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/.test(o['job-id']) || o['job-id'].includes('..')) { console.log(invalid('job-id invalido')); return 0; }
    console.log(state({ phase: o.phase, jobDir: o['job-dir'], jobId: o['job-id'], worktree: o.worktree, base: o.base })); return 0;
  }
  if (cmd === 'gate') {
    const o = opts(['job-dir', 'merge-base']);
    if (!o) { console.error('uso: docs-job.mjs gate --job-dir D --merge-base SHA'); return 64; }
    try { const r = gateRun({ jobDir: o['job-dir'], mergeBase: o['merge-base'] }); r.out.forEach((l) => console.log(l)); return r.ok ? 0 : 1; }
    catch (e) { console.log(`-> gate de documentacion: no pude calcularlo (${flat(e.message, 160)})`); console.log('   FALLO: gate'); return 1; }
  }
  console.error('uso: docs-job.mjs state --phase … | gate --job-dir D --merge-base SHA'); return 64;
}
if (import.meta.url === `file://${process.argv[1]}`) process.exit(cli(process.argv.slice(2)));
