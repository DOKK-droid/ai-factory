#!/usr/bin/env node
/**
 * apply-models.js
 * Lee factory/config.json y reescribe SOLO la linea `model:` del frontmatter de cada
 * agente en .opencode/agent/*.md. No toca el resto del frontmatter (por ejemplo los
 * bloques `permission:` anidados), asi que es seguro ejecutarlo tras anadir permisos.
 * Uso: node factory/scripts/apply-models.js [--check]
 *   --check  no escribe; sale con codigo 1 si algun agente no coincide con la config.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const CONFIG_PATH = process.env.FACTORY_CONFIG || path.join(ROOT, 'factory', 'config.json');
const AGENTS_DIR = path.join(ROOT, '.opencode', 'agent');
const CHECK = process.argv.includes('--check');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const { tiers = {}, roles = {} } = config;
let problems = 0;

for (const [role, tier] of Object.entries(roles)) {
  if (!tiers[tier]) { console.error(`[apply-models] ERROR: el rol ${role} usa el tier "${tier}" que no existe en tiers`); problems++; }
}

for (const file of fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md')).sort()) {
  const agent = file.replace(/\.md$/, '');
  const full = path.join(AGENTS_DIR, file);
  const content = fs.readFileSync(full, 'utf8');
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)?$/);
  const model = tiers[roles[agent]];
  if (!m) { console.error(`[apply-models] ERROR: ${file} no tiene frontmatter`); problems++; continue; }
  if (!model) { console.error(`[apply-models] AVISO: ${file} sin rol/tier en config; no se toca`); problems++; continue; }

  const fm = m[1];
  const next = /^model:.*$/m.test(fm) ? fm.replace(/^model:.*$/m, `model: ${model}`) : `${fm}\nmodel: ${model}`;
  if (next === fm) { console.log(`[apply-models] ${file} ya usa ${model}`); continue; }
  if (CHECK) { console.error(`[apply-models] DESAJUSTE: ${file} no usa ${model}`); problems++; continue; }
  fs.writeFileSync(full, `---\n${next}\n---${m[2] ?? '\n'}`, 'utf8');
  console.log(`[apply-models] ${file} -> ${model}`);
}
process.exit(problems ? 1 : 0);
