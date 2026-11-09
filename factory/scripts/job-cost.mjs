#!/usr/bin/env node
/**
 * job-cost.mjs — mide el consumo de tokens por rol de las sesiones de OpenCode de un proyecto.
 * Solo lectura: abre `opencode.db` en modo readOnly y consulta solo las tablas `session` y `message`
 * (no toca `account`, `credential` ni ninguna otra). Lo ejecuta el humano para comparar antes/despues.
 *
 * Uso: node factory/scripts/job-cost.mjs <directorio-del-proyecto> [--json] [--db <ruta>]
 *   <directorio>  proyecto cuyas sesiones se miden (incluye sus worktrees y subdirectorios)
 *   --db          ruta de opencode.db (por defecto $OPENCODE_DB, o $XDG_DATA_HOME/opencode/opencode.db,
 *                 o ~/.local/share/opencode/opencode.db)
 *   --json        salida JSON en vez de tabla
 * Requiere Node >= 22.13 (usa node:sqlite).
 * Salida: 0 ok · 1 uso incorrecto · 3 no se pudo abrir la base (se trata como fallo: no se inventan cifras)
 *
 * Que es medido y que es heuristico:
 *   - tokens y `cost` vienen tal cual de OpenCode; `cost` es SU estimacion, no el consumo real del plan.
 *   - rol = el `(@rol subagent)` del titulo de la sesion; si no lo hay, la sesion es el agente principal.
 *   - "correcciones" es una heuristica sobre el titulo (Corregir, Quitar, Aplicar...): cuenta sesiones
 *     lanzadas para arreglar algo ya escrito, no defectos reales.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FIX_TITLE = /^(Corregir|Quitar|Aplicar|Anotar|Restaurar|Actualizar|Cerrar|Revisar|A[ñn]adir|Escribir ADR)\b/i;

export function defaultDbPath(env = process.env) {
  if (env.OPENCODE_DB) return env.OPENCODE_DB;
  const base = env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'opencode', 'opencode.db');
}

export function roleOf(title, agent) {
  const m = String(title || '').match(/\(@([\w-]+) subagent\)/);
  return m ? m[1] : `principal(${agent || '?'})`;
}

function modelId(raw) {
  if (!raw) return '?';
  try { const j = JSON.parse(raw); return `${j.providerID || '?'}/${j.id || '?'}`; } catch { return String(raw).slice(0, 40); }
}

/** Agrega las sesiones de `dir` por rol. `db` es una DatabaseSync (o algo con .prepare). */
export function collect(db, dir) {
  const root = dir.replace(/\/+$/, '');
  const sessions = db.prepare(
    'SELECT id, parent_id, directory, title, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, agent, model FROM session WHERE directory = ? OR directory LIKE ? ESCAPE \'\\\' ORDER BY time_created'
  ).all(root, root.replace(/[\\%_]/g, '\\$&') + '/%');
  const byMsgs = db.prepare('SELECT data FROM message WHERE session_id = ?');
  const roles = new Map();
  for (const s of sessions) {
    const role = roleOf(s.title, s.agent);
    let r = roles.get(role);
    if (!r) { r = { role, model: modelId(s.model), sesiones: 0, turnos: 0, input: 0, output: 0, razonamiento: 0, cacheLectura: 0, cacheEscritura: 0, costo: 0, correcciones: 0, contextoMax: 0 }; roles.set(role, r); }
    r.sesiones++;
    r.input += s.tokens_input || 0; r.output += s.tokens_output || 0; r.razonamiento += s.tokens_reasoning || 0;
    r.cacheLectura += s.tokens_cache_read || 0; r.cacheEscritura += s.tokens_cache_write || 0; r.costo += s.cost || 0;
    if (s.parent_id && FIX_TITLE.test(s.title || '')) r.correcciones++;
    for (const row of byMsgs.all(s.id)) {
      let j; try { j = JSON.parse(row.data); } catch { continue; }
      if (j.role !== 'assistant' || !j.tokens) continue;
      r.turnos++;
      const t = j.tokens, c = t.cache || {};
      r.contextoMax = Math.max(r.contextoMax, (t.input || 0) + (c.read || 0) + (c.write || 0));
    }
  }
  const list = [...roles.values()].sort((a, b) => b.costo - a.costo || b.cacheLectura - a.cacheLectura);
  const total = list.reduce((a, r) => { for (const k of ['sesiones', 'turnos', 'input', 'output', 'razonamiento', 'cacheLectura', 'cacheEscritura', 'costo', 'correcciones']) a[k] += r[k]; return a; },
    { sesiones: 0, turnos: 0, input: 0, output: 0, razonamiento: 0, cacheLectura: 0, cacheEscritura: 0, costo: 0, correcciones: 0 });
  return { directorio: root, sesiones: sessions.length, roles: list, total };
}

const n = (x) => x.toLocaleString('en-US');
export function formatTable(rep) {
  const head = ['rol', 'modelo', 'ses', 'turnos', 'input', 'output', 'razon.', 'cacheLect', 'cacheEscr', 'ctxMax', 'corr', 'costo$'];
  const rows = rep.roles.map((r) => [r.role, r.model, r.sesiones, r.turnos, n(r.input), n(r.output), n(r.razonamiento), n(r.cacheLectura), n(r.cacheEscritura), n(r.contextoMax), r.correcciones, r.costo.toFixed(3)].map(String));
  const t = rep.total;
  rows.push(['TOTAL', '', t.sesiones, t.turnos, n(t.input), n(t.output), n(t.razonamiento), n(t.cacheLectura), n(t.cacheEscritura), '', t.correcciones, t.costo.toFixed(3)].map(String));
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (i < 2 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
  return [`Proyecto: ${rep.directorio} (${rep.sesiones} sesiones)`, line(head), line(w.map((x) => '-'.repeat(x))), ...rows.map(line),
    '', 'costo$ es la estimacion de OpenCode, no el consumo real del plan. "corr" es una heuristica sobre el titulo de la sesion.'].join('\n');
}

export async function openDb(file) {
  if (!fs.existsSync(file)) throw new Error(`no existe ${file}`);
  const { DatabaseSync } = await import('node:sqlite');
  return new DatabaseSync(file, { readOnly: true });
}

async function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const i = args.indexOf('--db');
  const dbFile = i >= 0 ? args[i + 1] : defaultDbPath();
  const rest = args.filter((a, k) => !a.startsWith('--') && !(i >= 0 && k === i + 1));
  if (rest.length !== 1 || (i >= 0 && !args[i + 1])) { console.error('uso: job-cost.mjs <directorio-del-proyecto> [--json] [--db <ruta>]'); return 1; }
  let db;
  try { db = await openDb(dbFile); } catch (e) { console.error(`job-cost: no se pudo abrir la base (${e.message})`); return 3; }
  try {
    const rep = collect(db, path.resolve(rest[0]));
    console.log(json ? JSON.stringify(rep, null, 2) : formatTable(rep));
    return 0;
  } catch (e) { console.error(`job-cost: error al consultar (${e.message})`); return 3; }
  finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv));
