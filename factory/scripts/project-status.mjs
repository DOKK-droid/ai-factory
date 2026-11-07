#!/usr/bin/env node
/**
 * project-status.mjs — estado de cada REQ y UC de la base documental, derivado de los jobs. SOLO LECTURA: no escribe nada.
 *
 *   sin job           ningun job lo cita en `Implementa:`
 *   en curso          lo cita un job que aun no esta entregado (sin gate PASS, o sin PR ni pagina del job)
 *   implementado      lo cita un job entregado (gate PASS + PR o pagina del job; o solo la pagina, ver abajo)
 *   requiere revision lo cita un job entregado cuyo implementa.lock ya no coincide con la base (el ID cambio o desaparecio)
 * Prioridad si varios jobs lo citan: en curso > implementado > requiere revision.
 *
 * Fuentes: <jobs>/*\/spec.md (Implementa:), gate.md (GATE, COMMIT, tests), pr.url, implementa.lock y las paginas versionadas
 * 02-DOCS/wiki/jobs/*.md (linea Implementa: y commit). Fuera del equipo local no hay gate.md (los jobs estan ignorados por git):
 * entonces vale la pagina del job y la evidencia se marca «no verificable aqui». Sin lock tampoco se puede saber si quedo obsoleto.
 *
 * Uso: node project-status.mjs [--json] [--root R] [--jobs-dir J]     (R por defecto: el checkout principal; J: FACTORY_JOBS_DIR o R/factory/jobs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { analyze, readLock, mainRoot } from './project-lint.mjs';
import { implementaIds, pageIds } from './spec-lint.mjs';

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const dirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
const files = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name); } catch { return []; } };
const PRIORITY = ['en curso', 'implementado', 'requiere revisión'];

function collect(root, jobsDir, hashes) {
  const jobs = new Map();
  const get = (id) => { if (!jobs.has(id)) jobs.set(id, { job: id, ids: new Set(), local: false, page: false, gate: null, commit: null, tests: null, pr: null }); return jobs.get(id); };
  for (const id of dirs(jobsDir)) {
    const spec = read(path.join(jobsDir, id, 'spec.md')), ids = implementaIds(spec);
    if (!ids.length) continue;
    const j = get(id); j.local = true; ids.forEach((x) => j.ids.add(x));
    const gate = read(path.join(jobsDir, id, 'gate.md'));
    j.gate = (gate.split('\n')[0].match(/^GATE: (PASS|FAIL)\s*$/) || [])[1] ?? null;
    const c = gate.match(/^COMMIT: ([0-9a-f]{7,40})\s*$/m); if (c) j.commit = c[1].slice(0, 7);
    const n = [...gate.matchAll(/OK:\s*(\d+) casos ejecutados/g)].map((m) => Number(m[1])); if (n.length) j.tests = n.reduce((a, b) => a + b, 0);
    j.pr = read(path.join(jobsDir, id, 'pr.url')).split('\n')[0].trim() || null;
    const lock = readLock(path.join(jobsDir, id, 'implementa.lock')); if (!lock.err) j.lock = lock.ids;
  }
  const pages = path.join(root, '02-DOCS/wiki/jobs');
  for (const f of files(pages)) {
    const text = read(path.join(pages, f)), ids = pageIds(text);
    if (!ids?.length) continue;
    const j = get(f.replace(/\.md$/, '')); j.page = true; ids.forEach((x) => j.ids.add(x));
    const c = text.match(/commit[^0-9a-f\n]*([0-9a-f]{7,40})/i); if (c && !j.commit) j.commit = c[1].slice(0, 7);
  }
  for (const j of jobs.values()) {
    j.delivered = j.local ? j.gate === 'PASS' && !!(j.pr || j.page) : j.page;
    j.verificable = j.local && j.gate !== null;
    j.cambiados = j.delivered && j.lock ? [...j.ids].filter((id) => j.lock[id] !== undefined && hashes.get(id) !== j.lock[id]).sort() : [];
  }
  return [...jobs.values()].sort((a, b) => a.job.localeCompare(b.job));
}

export function status({ root, jobsDir }) {
  const a = analyze({ root });
  const hashes = new Map([...a.defs].map(([id, d]) => [id, d.hash]));
  const ids = [...a.defs.keys()].filter((id) => /^(REQ-F|REQ-NF|UC)-/.test(id)).sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
  const jobs = collect(root, jobsDir, hashes);
  return ids.map((id) => {
    const cit = jobs.filter((j) => j.ids.has(id)).map((j) => ({
      job: j.job, estado: !j.delivered ? 'en curso' : j.cambiados.includes(id) ? 'requiere revisión' : 'implementado',
      pr: j.pr, commit: j.commit, gate: j.gate, tests: j.tests, verificable: j.verificable, cambiados: j.cambiados,
    }));
    const estado = PRIORITY.find((p) => cit.some((c) => c.estado === p)) || 'sin job';
    return { id, tipo: id.replace(/-\d+$/, ''), estado, jobs: cit };
  });
}

function detail(j) {
  const parts = [];
  if (j.estado === 'requiere revisión') parts.push(`${j.cambiados.join(', ')} cambió desde que se confirmó su spec`);
  if (j.pr) parts.push(`PR ${j.pr}`);
  if (j.commit) parts.push(`commit ${j.commit}`);
  if (j.gate) parts.push(`gate ${j.gate}`);
  if (j.tests !== null) parts.push(`${j.tests} tests`);
  if (!j.verificable && j.estado !== 'en curso') parts.push('no verificable aquí: sin gate.md');
  return `job ${j.job}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

function cli(argv) {
  const o = { json: false, root: null, jobsDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') o.json = true;
    else if ((argv[i] === '--root' || argv[i] === '--jobs-dir') && argv[i + 1]) o[argv[i] === '--root' ? 'root' : 'jobsDir'] = argv[++i];
    else { console.error('uso: project-status.mjs [--json] [--root R] [--jobs-dir J]'); return 64; }
  }
  const root = path.resolve(o.root || mainRoot());
  const jobsDir = path.resolve(o.jobsDir || process.env.FACTORY_JOBS_DIR || path.join(root, 'factory/jobs'));
  const items = status({ root, jobsDir });
  if (o.json) { console.log(JSON.stringify({ root, items }, null, 2)); return 0; }
  if (!items.length) { console.log('No hay base documental en 02-DOCS/wiki/project/: no hay requisitos ni casos de uso que seguir.'); return 0; }
  console.log('Estado de los requisitos y casos de uso (derivado de los jobs; solo lectura)');
  for (const i of items) console.log(`${i.id.padEnd(10)}  ${i.estado.padEnd(17)}  ${i.jobs.map(detail).join('; ')}`.trimEnd());
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(cli(process.argv.slice(2)));
