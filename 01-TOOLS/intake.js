#!/usr/bin/env node
/**
 * intake.js
 * Normaliza una entrada (Sentry, GitHub Issue o tarea manual) a input.md
 * dentro de factory/jobs/<id>/.
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const ROOT = process.cwd();
const JOBS_DIR = path.join(ROOT, 'factory', 'jobs');

function generateId(input) {
  const ts = Date.now();
  const hash = createHash('sha1').update(input + ts).digest('hex').slice(0, 8);
  return `job-${ts}-${hash}`;
}

function detectSource(input) {
  if (input.includes('sentry.io') || input.includes('Sentry')) return 'sentry';
  if (input.includes('github.com') || input.includes('Issue') || input.includes('issue')) return 'github';
  return 'manual';
}

function main() {
  const input = process.argv.slice(2).join(' ').trim();
  if (!input) {
    console.error('Uso: node 01-TOOLS/intake.js "<entrada>"');
    process.exit(1);
  }

  const id = generateId(input);
  const source = detectSource(input);
  const jobDir = path.join(JOBS_DIR, id);

  fs.mkdirSync(jobDir, { recursive: true });

  const now = new Date().toISOString();

  const jobJson = {
    id,
    status: 'intake_done',
    source,
    created_at: now,
    updated_at: now,
    input_hash: createHash('sha256').update(input).digest('hex')
  };

  const inputMd = `# Input normalizado\n\n` +
    `- **Job ID:** ${id}\n` +
    `- **Fuente:** ${source}\n` +
    `- **Fecha:** ${now}\n` +
    `- **Entrada original:**\n\n${input}\n`;

  const traceMd = `# Trazabilidad\n\n` +
    `Issue/Error → Spec → Branch → PR → Reviews → Decisión\n\n` +
    `Estado inicial: input normalizado (${source})\n`;

  fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify(jobJson, null, 2));
  fs.writeFileSync(path.join(jobDir, 'input.md'), inputMd);
  fs.writeFileSync(path.join(jobDir, 'trace.md'), traceMd);

  console.log(`Job creado: ${id}`);
  console.log(`Directorio: ${jobDir}`);
  console.log(`Fuente detectada: ${source}`);
}

main();
