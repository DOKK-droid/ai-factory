#!/usr/bin/env node
/**
 * A/B limpio de modelos para reviewers y approver.
 *   node tests/ab/run-ab.mjs --models opencode/a,opencode/b --mode approver --runs 3
 *   node tests/ab/run-ab.mjs --models ... --mode reviewer --roles security,code
 *   --dry-run   solo muestra cuantas ejecuciones y un prompt de ejemplo
 * Variables: OPENCODE_BIN (por defecto "opencode"). Se invoca: opencode run --model <m> "<prompt>"
 * (confirma con `opencode run --help`; si tus flags difieren, ajusta runModel()).
 * El prompt NO revela los fallos. Se ejecuta en un repo desechable, nunca en tu proyecto.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { parseVerdict, detectedFlaws, isCorrect, summarize } from './score.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '../..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const MODELS = (arg('models', '') || '').split(',').filter(Boolean);
const MODE = arg('mode', 'approver');
const RUNS = Number(arg('runs', 3));
const ROLES = (arg('roles', 'security,code')).split(',');
const DRY = process.argv.includes('--dry-run');
const CASES = ['cand-flawed', 'cand-clean'];
if (!MODELS.length) { console.error('Falta --models a,b,c'); process.exit(2); }

const fx = path.join(os.tmpdir(), `af-ab-${Date.now()}`);
execFileSync('bash', [path.join(HERE, 'make-fixture.sh'), fx], { stdio: 'inherit' });
const diff = (c) => execFileSync('git', ['diff', `main...${c}`], { cwd: fx, encoding: 'utf8' });
const body = (role) => fs.readFileSync(path.join(REPO, `.opencode/agent/reviewer-${role}.md`), 'utf8').replace(/^---[\s\S]*?\n---\n/, '');
const SPEC = 'Spec: endurecer el login (rate limit por intentos y busqueda de usuario por email). Criterios: 1) se bloquea al llegar a 5 intentos; 2) las consultas a BD usan parametros; 3) hay tests que validan ambos.';
const FORMAT = 'Responde SOLO con texto (no uses herramientas, no edites archivos).';

function prompts() {
  const list = [];
  for (const c of CASES) {
    const d = diff(c);
    if (MODE === 'reviewer') {
      for (const role of ROLES) list.push({ case: c, label: `reviewer-${role}`, text:
        `${body(role)}\n\n${SPEC}\n\nDiff a revisar:\n${d}\n\n${FORMAT}\nLinea 1: VERDICT: PASS o VERDICT: CHANGES. Linea 2: SCORE: 0-1. Luego los hallazgos.` });
    } else {
      const reviews = ['security', 'ux', 'ui', 'code'].map((r) => `review-${r}.md:\nVERDICT: PASS\nSCORE: 0.92\nSin hallazgos relevantes.`).join('\n\n');
      list.push({ case: c, label: 'approver', text:
        `Eres el Aprobador de una AI Factory. Decide APPROVE, CHANGES o ESCALATE.\nRegla: APPROVE solo si el trabajo cumple el spec; los reviewers pueden haberse equivocado, verifica tu mismo el diff.\n\n${SPEC}\n\nInformes de los 4 reviewers:\n${reviews}\n\nDiff:\n${d}\n\n${FORMAT}\nLinea 1: APPROVE | CHANGES | ESCALATE. Luego justificacion breve y los fallos que encuentres.` });
    }
  }
  return list;
}

function runModel(model, prompt) {
  const r = spawnSync(process.env.OPENCODE_BIN || 'opencode', ['run', '--model', model, prompt], { cwd: fx, encoding: 'utf8', timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 });
  return { out: `${r.stdout || ''}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`, status: r.status };
}

const ps = prompts();
console.log(`Fixture: ${fx}\nModo: ${MODE} | modelos: ${MODELS.length} | prompts: ${ps.length} | repeticiones: ${RUNS} => ${MODELS.length * ps.length * RUNS} ejecuciones`);
if (DRY) { console.log('\n--- prompt de ejemplo ---\n' + ps[0].text.slice(0, 1500)); process.exit(0); }

const OUT = path.join(HERE, 'out'); fs.mkdirSync(OUT, { recursive: true });
const rows = [];
for (const model of MODELS) for (const p of ps) for (let n = 1; n <= RUNS; n++) {
  const { out } = runModel(model, p.text);
  const verdict = parseVerdict(out);
  const row = { model, mode: MODE, case: p.case, label: p.label, run: n, verdict, flaws: p.case === 'cand-flawed' ? detectedFlaws(out) : [], correct: isCorrect(p.case, verdict) };
  rows.push(row);
  const f = path.join(OUT, model.replace(/[^\w.-]+/g, '_'), `${MODE}-${p.label}-${p.case}-${n}.txt`);
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, out);
  console.log(`${model} | ${p.label} | ${p.case} #${n}: ${verdict} ${row.correct ? 'OK' : 'MAL'} flaws=[${row.flaws.join(',')}]`);
}
const sum = summarize(rows);
let md = `# Resultados A/B (${new Date().toISOString()})\n\n| modelo \\| modo | flawed bien (no aprueba) | fallos detectados (de 3, media) | clean bien (aprueba) | sin formato |\n|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(sum)) md += `| ${k} | ${v.flawedOk}/${v.flawedRuns} | ${(v.flawsFound / Math.max(v.flawedRuns, 1)).toFixed(1)} | ${v.cleanOk}/${v.cleanRuns} | ${v.unknown} |\n`;
fs.writeFileSync(path.join(OUT, `summary-${MODE}.md`), md); fs.writeFileSync(path.join(OUT, `rows-${MODE}.json`), JSON.stringify(rows, null, 2));
console.log('\n' + md + `\nTextos crudos en ${OUT} (revisa a mano: el matching por palabras es aproximado).`);
