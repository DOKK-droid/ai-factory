// Fixture compartida de los tests de trazabilidad: una fabrica instalada con la base documental aprobada y un job cuyo spec
// (ya confirmado) cita REQ-F-1, REQ-F-2 y UC-2 en `Implementa:`.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { write, git, run } from './helpers.mjs';
import { fx, put } from './ns-fixture.mjs';
import { makeProject, DOC_NAMES, LINT } from './project-fixture.mjs';
import { analyze } from '../factory/scripts/project-lint.mjs';

export const IMPL = ['REQ-F-1', 'REQ-F-2, UC-2'];
export const edit = (file, from, to) => { const t = fs.readFileSync(file, 'utf8'); assert.ok(t.includes(from), `no contiene: ${from}`); fs.writeFileSync(file, t.replace(from, to)); };
export const POLICY = { require_spec_ok: true, spec_profile: 'full', project_docs: 'required' };
export const REQS = (f) => path.join(f.wt, '02-DOCS/wiki/project/01-requisitos.md');
export function seedProject(f, { approve = true } = {}) {
  const p = makeProject();
  for (const rel of ['README.md', ...DOC_NAMES.map((d) => `02-DOCS/wiki/project/${d}.md`), '02-DOCS/wiki/project/discovery.md', '02-DOCS/wiki/sdd/decisions.md']) write(path.join(f.repo, rel), fs.readFileSync(path.join(p.root, rel), 'utf8'));
  if (approve) { const r = run('node', [LINT, 'approve', ...DOC_NAMES, '--root', f.repo]); assert.equal(r.status, 0, r.stdout); }
  git(f.repo, 'add', '-A'); git(f.repo, 'commit', '-qm', 'base documental'); git(f.repo, 'push', '-q', 'origin', 'main');
}
/** Job con la base aprobada y un spec que cita REQ-F-1, REQ-F-2 y UC-2, ya confirmado (spec.ok). */
export function job({ project = POLICY, approve = true, implementa = IMPL, confirm = true } = {}) {
  const f = fx({ tools: true, project }); seedProject(f, { approve }); f.upTo('input'); f.spec({ implementa });
  if (confirm) f.confirm();
  f.pl = (...a) => run('node', [LINT, ...a, '--jobs-dir', path.join(f.repo, 'factory/jobs')], { cwd: f.repo, env: f.env() });
  f.align = (cmd, ...a) => {
    const r = f.pl(cmd, f.id, ...a); const lines = r.stdout.split('\n').filter(Boolean);
    const get = (k) => lines.filter((l) => l.startsWith(k + ': ')).map((l) => l.slice(k.length + 2));
    return { code: r.status, first: lines[0] || '', get, raw: r.stdout, stderr: r.stderr };
  };
  f.lock = path.join(f.job, 'implementa.lock');
  f.readLock = () => JSON.parse(fs.readFileSync(f.lock, 'utf8'));
  f.reapprove = () => { const r = run('node', [LINT, 'approve', ...DOC_NAMES, '--root', f.wt]); assert.equal(r.status, 0, r.stdout); };
  f.changeReq = (from, to) => { edit(REQS(f), from, to); f.reapprove(); };
  return f;
}
export const hashOf = (root, id) => analyze({ root }).defs.get(id).hash;

