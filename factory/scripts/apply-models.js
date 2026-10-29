#!/usr/bin/env node
/**
 * apply-models.js
 * Lee factory/config.json y reescribe el campo `model:` del frontmatter
 * de cada agente en .opencode/agent/*.md segun el mapeo tiers -> modelo.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'factory', 'config.json');
const AGENTS_DIR = path.join(ROOT, '.opencode', 'agent');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeFile(p, content) {
  fs.writeFileSync(p, content, 'utf8');
}

function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const fmText = match[1];
  const body = match[2];
  const fm = {};
  for (const line of fmText.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^"|"$|^'|'$/g, '');
      fm[key] = val;
    }
  }
  return { frontmatter: fm, body };
}

function buildFrontmatter(fm) {
  const lines = ['---'];
  const orderedKeys = ['description', 'mode', 'model', 'temperature', 'tools', 'permission'];
  for (const k of orderedKeys) {
    if (k in fm) lines.push(`${k}: ${fm[k]}`);
  }
  for (const [k, v] of Object.entries(fm)) {
    if (!orderedKeys.includes(k)) lines.push(`${k}: ${v}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

function main() {
  const config = readJson(CONFIG_PATH);
  const tiers = config.tiers;
  const roles = config.roles;

  const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const fullPath = path.join(AGENTS_DIR, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const { frontmatter, body } = extractFrontmatter(content);

    // Buscar el rol del agente por nombre de archivo (sin .md)
    const agentName = file.replace(/\.md$/, '');
    const role = roles[agentName];

    if (role && tiers[role]) {
      frontmatter.model = tiers[role];
      writeFile(fullPath, buildFrontmatter(frontmatter) + body);
      console.log(`[apply-models] ${file} -> model: ${tiers[role]} (rol: ${role})`);
    } else {
      console.log(`[apply-models] ${file} sin rol mapeado, se deja igual`);
    }
  }
}

main();
