#!/usr/bin/env node
/**
 * validate-models.mjs — comprueba que los IDs de modelo existen en `opencode models`.
 * Un ID inexistente hace fallar `opencode run` (o peor, deja a un agente trabajando con otro modelo / sin modelo).
 *
 * Uso: node validate-models.mjs [--agents a,b,c] [--config]
 *   sin --agents: todos los .opencode/agent/*.md ; --config: ademas los tiers de factory/config.json
 * Variables: OPENCODE_BIN (por defecto "opencode"), FACTORY_MODELS_FILE (lista de modelos en un archivo; para pruebas),
 *   FACTORY_MODELS_TIMEOUT_MS (espera maxima de `opencode models`; por defecto 300000),
 *   FACTORY_MODELS_CACHE_TTL_S (vigencia de la cache de la lista; por defecto 1800, 0 = sin cache)
 * Cache: ${TMPDIR:-/tmp}/factory-models-cache-<uid>-<hash del binario>.txt, permisos 600; solo guarda salidas que pasaron parseModelsOutput.
 * Salida: 0 todos existen · 1 faltan IDs · 3 no se pudo obtener la lista (se trata como fallo: no se asume nada)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_CACHE_TTL_S = 1800;

export function parseModelsOutput(text) {
  const ids = new Set();
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
    const m = line.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.:@+\/-]+)$/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

export function agentModels(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    const fm = fs.readFileSync(path.join(dir, f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const m = fm && fm[1].match(/^model:\s*(\S+)/m);
    out[f.replace(/\.md$/, '')] = m ? m[1] : null;
  }
  return out;
}

/** Entero positivo de una variable de entorno; si no lo es, el valor por defecto. */
function envInt(name, def, { allowZero = false } = {}) {
  const v = process.env[name];
  if (v === undefined || !/^\d+$/.test(v.trim())) return def;
  const n = Number(v);
  return n > 0 || (allowZero && n === 0) ? n : def;
}

function cacheFile(bin) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'u';
  const h = crypto.createHash('sha1').update(bin).digest('hex').slice(0, 8);
  return path.join(process.env.TMPDIR || os.tmpdir(), `factory-models-cache-${uid}-${h}.txt`);
}

/** Lista cacheada si es un archivo propio, no caducado y con modelos validos; si no, null. */
function readCache(file, ttlS) {
  if (ttlS <= 0) return null;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || (typeof process.getuid === 'function' && st.uid !== process.getuid())) return null;
    if (Date.now() - st.mtimeMs > ttlS * 1000) return null;
    const ids = parseModelsOutput(fs.readFileSync(file, 'utf8'));
    return ids.size > 0 ? ids : null;
  } catch { return null; }
}

function writeCache(file, text) {
  try {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch { /* la cache es solo una optimizacion */ }
}

/** -> { ids: Set|null, error: string|null } ; error explica por que no hay lista. */
function availableModels() {
  if (process.env.FACTORY_MODELS_FILE) return { ids: parseModelsOutput(fs.readFileSync(process.env.FACTORY_MODELS_FILE, 'utf8')), error: null };
  const bin = process.env.OPENCODE_BIN || 'opencode';
  const timeoutMs = envInt('FACTORY_MODELS_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const ttlS = envInt('FACTORY_MODELS_CACHE_TTL_S', DEFAULT_CACHE_TTL_S, { allowZero: true });
  const file = cacheFile(bin);
  const cached = readCache(file, ttlS);
  if (cached) return { ids: cached, error: null, cached: true };
  const r = spawnSync(bin, ['models'], { encoding: 'utf8', timeout: timeoutMs });
  if (r.error && (r.error.code === 'ETIMEDOUT' || r.signal)) {
    return { ids: null, error: `\`opencode models\` no respondio en ${Math.round(timeoutMs / 1000)} s (timeout). Sube el limite con FACTORY_MODELS_TIMEOUT_MS=<milisegundos>.` };
  }
  if (r.error) return { ids: null, error: `no pude ejecutar \`${bin} models\` (${r.error.code || r.error.message}): no esta instalado o no esta en el PATH.` };
  if (r.status !== 0) return { ids: null, error: `\`${bin} models\` termino con codigo ${r.status} (sin sesion o fallo propio).` };
  const ids = parseModelsOutput(r.stdout);
  if (ids.size === 0) return { ids: null, error: `\`${bin} models\` devolvio una salida vacia o con formato inesperado.` };
  if (ttlS > 0) writeCache(file, r.stdout);
  return { ids, error: null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const only = argv.includes('--agents') ? argv[argv.indexOf('--agents') + 1].split(',') : null;
  const wanted = []; // [origen, id]
  const models = agentModels('.opencode/agent');
  for (const [name, id] of Object.entries(models)) if (!only || only.includes(name)) wanted.push([`agente ${name}`, id]);
  if (argv.includes('--config') && fs.existsSync('factory/config.json')) {
    const c = JSON.parse(fs.readFileSync('factory/config.json', 'utf8'));
    for (const [t, id] of Object.entries(c.tiers || {})) wanted.push([`tier ${t}`, id]);
  }
  const { ids: have, error, cached } = availableModels();
  if (!have || have.size === 0) { console.error(`ERROR: no pude obtener la lista de modelos: ${error || 'la lista esta vacia'} No se asume que los modelos existan.`); process.exit(3); }
  let bad = 0;
  for (const [origin, id] of wanted) {
    if (!id) { console.error(`FALTA: ${origin} no declara model:`); bad++; }
    else if (!have.has(id)) { console.error(`NO EXISTE: ${origin} usa "${id}", que no aparece en opencode models${cached ? ' (lista en cache; si acabas de anadir un proveedor, repite con FACTORY_MODELS_CACHE_TTL_S=0)' : ''}`); bad++; }
  }
  if (bad) process.exit(1);
  console.log(`OK: ${wanted.length} modelos verificados contra opencode models (${have.size} disponibles)`);
}
