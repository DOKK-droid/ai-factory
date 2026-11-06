#!/usr/bin/env node
/**
 * scope-check.mjs — control de ALCANCE de un job.
 * El spec declara que archivos puede tocar el job:
 *     Alcance:
 *     - src/**
 *     - tests/formatAttempts.test.js
 * y cualquier cambio fuera de esa lista (sobre todo un borrado) se detecta de forma determinista.
 *
 * Uso:
 *   node scope-check.mjs changes <merge-base>      # lista cambios reales como "A|M|D<TAB>ruta" (commits + working tree + sin seguimiento)
 *   node scope-check.mjs check <spec.md> < cambios # sale 0 = ok, 1 = violaciones, 2 = alcance ausente o demasiado amplio
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const norm = (p) => String(p).trim().replace(/^\.\//, '').replace(/^["']|["']$/g, '');

/** Entradas de la seccion "Alcance:" del spec (lista con "- " hasta la primera linea que no lo sea). */
export function parseScope(specText) {
  const lines = String(specText).split(/\r?\n/);
  const i = lines.findIndex((l) => /^\s*(?:#{1,6}\s*)?alcance\s*:?\s*$/i.test(l));
  if (i < 0) return { found: false, globs: [] };
  const globs = [];
  for (let j = i + 1; j < lines.length; j++) {
    const m = lines[j].match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!m) { if (lines[j].trim() === '' && globs.length === 0) continue; break; }
    globs.push(norm(m[1].replace(/`/g, '')));
  }
  return { found: true, globs };
}

export function globToRegExp(glob) {
  let g = norm(glob);
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// Paginas del Brain que escribe el memory-curator: viajan en el PR del job sin tener que figurar en `Alcance:`.
// Duplicada en 01-TOOLS/lib.sh (FACTORY_CURATOR_PATHS); un test comprueba que coinciden.
export const CURATOR_PATHS = ['02-DOCS/wiki/jobs', '02-DOCS/wiki/index.md', '02-DOCS/wiki/sdd/decisions.md'];
// Base documental del proyecto: la aplica un agente de documentacion tras una peticion confirmada (brain.ok); no tiene que figurar
// en `Alcance:`. El builder no puede escribirla (permisos del agente). Duplicada en 01-TOOLS/lib.sh (FACTORY_PROJECT_DOC_PATHS).
export const PROJECT_DOC_PATHS = ['02-DOCS/wiki/project'];
const isCurator = (p) => [...CURATOR_PATHS, ...PROJECT_DOC_PATHS].some((c) => norm(p) === c || norm(p).startsWith(c + '/'));

const TOO_BROAD = new Set(['*', '**', '**/*', '/', '.', './']);

/** changes: [{status:'A'|'M'|'D', path}] -> { broad, out: [], delOut: [] } */
export function checkScope(globs, changes) {
  const broad = globs.length === 0 || globs.some((g) => TOO_BROAD.has(g));
  const res = globs.map(globToRegExp);
  const inScope = (p) => isCurator(p) || res.some((r) => r.test(norm(p)));
  const out = []; const delOut = [];
  for (const c of changes) {
    if (inScope(c.path)) continue;
    (c.status === 'D' ? delOut : out).push(c.path);
  }
  return { broad, out, delOut };
}

export function parseChanges(text) {
  return String(text).split('\n').filter(Boolean).map((l) => {
    const [status, ...rest] = l.split('\t');
    return { status, path: rest.join('\t') };
  });
}

/** git diff --name-status -z <mb> (+ sin seguimiento), con renombres expandidos a D + A. */
export function listChanges(mergeBase, cwd = process.cwd()) {
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = [];
  const parts = git(['diff', '--name-status', '-z', '--no-renames', mergeBase]).split('\0').filter((x) => x !== '');
  for (let i = 0; i + 1 < parts.length; i += 2) out.push({ status: parts[i][0], path: parts[i + 1] });
  for (const p of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) out.push({ status: 'A', path: p });
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, arg] = process.argv.slice(2);
  if (mode === 'changes') {
    for (const c of listChanges(arg)) console.log(`${c.status}\t${c.path}`);
  } else if (mode === 'check') {
    const scope = parseScope(fs.readFileSync(arg, 'utf8'));
    const { broad, out, delOut } = checkScope(scope.globs, parseChanges(fs.readFileSync(0, 'utf8')));
    if (!scope.found || broad) {
      console.log(!scope.found ? 'SIN_ALCANCE: el spec no tiene la seccion "Alcance:" con rutas' : 'ALCANCE_AMPLIO: el alcance incluye todo el repo ("**")');
      process.exit(2);
    }
    for (const p of out) console.log(`FUERA_DE_ALCANCE\t${p}`);
    for (const p of delOut) console.log(`BORRADO_FUERA_DE_ALCANCE\t${p}`);
    process.exit(out.length || delOut.length ? 1 : 0);
  } else { console.error('uso: scope-check.mjs changes <merge-base> | check <spec.md>'); process.exit(64); }
}
