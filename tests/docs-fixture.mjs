// Fixture de los jobs de documentacion (kind: docs): una fabrica instalada con la base aprobada y un job docs con su spec confirmado.
// Los agentes se simulan escribiendo en la worktree lo que harian (siempre con estado desactualizado y version nueva si el documento estaba aprobado).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { run, git } from './helpers.mjs';
import { fx, put } from './ns-fixture.mjs';
import { seedProject, edit } from './trace-fixture.mjs';
import { DOC_NAMES, LINT } from './project-fixture.mjs';
import { REPO } from './helpers.mjs';

export const DOCS_JOB = path.join(REPO, 'factory/scripts/docs-job.mjs');
export const DOCS_POLICY = { require_spec_ok: true, project_docs: 'required' };
export const PD = '02-DOCS/wiki/project';
export const ROW = (ids, doc, agent) => ({ ids, doc, agent });
export const OWNER = { '00-vision': 'system-analyst', '01-requisitos': 'system-analyst', '02-casos-de-uso': 'system-analyst', '03-dominio': 'domain-modeler', '04-arquitectura': 'architect', '05-datos': 'domain-modeler', '06-despliegue': 'deployment-planner', decisions: 'architect' };

export const docsSpecText = ({ rows = [ROW('REQ-F-2', '01-requisitos', 'system-analyst')], adr = 'none', title = 'ajustar el listado', alcance = [`${PD}/**`] } = {}) => `# Spec — Cambio documental: ${title}
Surface: none
ADR: ${adr}

## Objetivo
Ajustar el listado de pedidos. Nace de input.md.

## Cambio solicitado
${rows.map((r) => `- Modificar ${r.ids} en ${r.doc}.`).join('\n')}

## Documentos afectados
| ID | Documento | Agente |
|---|---|---|
${rows.map((r) => `| ${r.ids} | ${r.doc} | ${r.agent} |`).join('\n')}

## Impacto en jobs
- Ninguno todavia.

## Criterios de aceptación
1. REQ-F-2 queda definido en 01-requisitos y cubierto por UC-2.
2. project-lint check --strict sin errores.

## Alcance
${alcance.map((a) => `- ${a}`).join('\n')}
`;
export const docsTasksText = (rows) => rows.map((r, i) => `- [ ] T${i + 1} (${r.doc}, ${r.agent}): cambiar ${r.ids}\n`).join('');

/** Job docs con la base aprobada (seed) y el spec ya escrito (y confirmado si confirm). */
export function docsJob({ project = DOCS_POLICY, approve = true, rows = undefined, adr = 'none', alcance = undefined, confirm = true, id = 'job-1', stage = 'confirmed' } = {}) {
  const f = fx({ tools: true, project, kind: 'docs', id });
  seedProject(f, { approve });
  f.newJob(); if (stage !== 'job') f.input();
  f.rows = rows || [ROW('REQ-F-2', '01-requisitos', 'system-analyst')];
  f.docsSpec = (o = {}) => {
    const rr = o.rows || f.rows; put(path.join(f.job, 'spec.md'), docsSpecText({ rows: rr, adr: o.adr ?? adr, alcance: o.alcance ?? alcance })); put(path.join(f.job, 'tasks.md'), o.tasks ?? docsTasksText(rr));
  };
  if (stage === 'confirmed' || stage === 'spec') f.docsSpec();
  if (confirm && stage === 'confirmed') f.confirm();
  f.file = (doc) => path.join(f.wt, doc === 'decisions' ? '02-DOCS/wiki/sdd/decisions.md' : `${PD}/${doc}.md`);
  /** Simula al agente dueño: cambia el cuerpo y, si el documento estaba aprobado, lo deja desactualizado con version nueva. */
  f.agentEdit = (doc, from, to, { stale = true } = {}) => {
    const file = f.file(doc); let t = fs.readFileSync(file, 'utf8'); assert.ok(t.includes(from), `${doc} no contiene: ${from}`);
    t = t.replace(from, to);
    if (stale && doc !== 'decisions') t = t.replace(/^estado: aprobado$/m, 'estado: desactualizado').replace(/^version: (\d+)\.(\d+)\.(\d+)$/m, (_, a, b, c) => `version: ${a}.${b}.${+c + 1}`);
    fs.writeFileSync(file, t);
  };
  f.marcarDesactualizado = (doc) => { const file = f.file(doc); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^estado: aprobado$/m, 'estado: desactualizado').replace(/^version: (\d+)\.(\d+)\.(\d+)$/m, (_, a, b, c) => `version: ${a}.${b}.${+c + 1}`)); };
  f.commitProject = () => { const r = run('bash', [path.join(f.wt, '01-TOOLS/commit-brain.sh'), id, '--project'], { cwd: f.wt, env: f.env() }); assert.equal(r.status, 0, r.stdout + r.stderr); };
  f.docsState = (phase = 'work', extra = []) => {
    const r = run('node', [DOCS_JOB, 'state', '--phase', phase, '--job-dir', f.job, '--job-id', id, '--worktree', f.wt, '--base', 'origin/main', ...extra], { cwd: f.repo, env: f.env() });
    const lines = r.stdout.split('\n').filter(Boolean);
    return { code: r.status, first: lines[0] || '', get: (k) => lines.filter((l) => l.startsWith(k + ': ')).map((l) => l.slice(k.length + 2)), raw: r.stdout, stderr: r.stderr };
  };
  f.docsGate = () => {
    const mb = git(f.wt, 'merge-base', 'origin/main', 'HEAD').trim();
    const r = run('node', [DOCS_JOB, 'gate', '--job-dir', f.job, '--merge-base', mb], { cwd: f.wt, env: f.env() });
    return { code: r.status, out: r.stdout, stderr: r.stderr };
  };
  f.approveAll = (docs = DOC_NAMES) => { const r = run('node', [LINT, 'approve', ...docs, '--root', f.wt]); assert.equal(r.status, 0, r.stdout); };
  f.edit = edit;
  return f;
}
