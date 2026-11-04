#!/usr/bin/env node
/**
 * validate-models.mjs — comprueba que los IDs de modelo existen en `opencode models`.
 * Un ID inexistente hace fallar `opencode run` (o peor, deja a un agente trabajando con otro modelo / sin modelo).
 *
 * Uso: node validate-models.mjs [--agents a,b,c] [--config]
 *   sin --agents: todos los .opencode/agent/*.md ; --config: ademas los tiers de factory/config.json
 * Variables: OPENCODE_BIN (por defecto "opencode"), FACTORY_MODELS_FILE (lista de modelos en un archivo; para pruebas)
 * Salida: 0 todos existen · 1 faltan IDs · 3 no se pudo obtener la lista (se trata como fallo: no se asume nada)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

function availableModels() {
  if (process.env.FACTORY_MODELS_FILE) return parseModelsOutput(fs.readFileSync(process.env.FACTORY_MODELS_FILE, 'utf8'));
  const r = spawnSync(process.env.OPENCODE_BIN || 'opencode', ['models'], { encoding: 'utf8', timeout: 120000 });
  if (r.error || r.status !== 0) return null;
  return parseModelsOutput(r.stdout);
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
  const have = availableModels();
  if (!have || have.size === 0) { console.error('ERROR: no pude obtener la lista de `opencode models` (no instalado, sin sesion o formato inesperado). No se asume que los modelos existan.'); process.exit(3); }
  let bad = 0;
  for (const [origin, id] of wanted) {
    if (!id) { console.error(`FALTA: ${origin} no declara model:`); bad++; }
    else if (!have.has(id)) { console.error(`NO EXISTE: ${origin} usa "${id}", que no aparece en opencode models`); bad++; }
  }
  if (bad) process.exit(1);
  console.log(`OK: ${wanted.length} modelos verificados contra opencode models (${have.size} disponibles)`);
}
