// init-project.sh --apply workspace crea el job de /factory-init como job de documentacion (kind: docs) y, con el parche de la rama 6,
// next-step.sh lo conduce sin detenerse en la base sin aprobar (el bloque 1c no aplica a un job docs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, git, run } from './helpers.mjs';
import { NEXT, parse } from './ns-fixture.mjs';

const INIT = path.join(REPO, 'factory/scripts/init-project.sh');
const INSTALL = path.join(REPO, 'factory/scripts/install-into.sh');
const PATCH = 'docs/propuestas/rama6-docs-job.patch';
const nsDocs = fs.readFileSync(NEXT, 'utf8').includes('docs-job.mjs');

function spies() {
  const dir = tmp('af-spy-'); const log = path.join(dir, 'calls.log');
  for (const n of ['sudo', 'opencode', 'gh', 'npm', 'npx']) { write(path.join(dir, n), `#!/usr/bin/env bash\necho "${n} $*" >> "${log}"\nexit 0\n`); fs.chmodSync(path.join(dir, n), 0o755); }
  return { dir, log, env: () => ({ ...process.env, PATH: `${dir}:${process.env.PATH}`, FACTORY_MODELS_CACHE_TTL_S: '0', FACTORY_MANAGED_DIR: tmp('af-nomanaged-') }) };
}
function installed(sp) {
  const d = tmp('af-init-'); git(d, 'init', '-q', '-b', 'main'); git(d, 'config', 'user.email', 't@t.t'); git(d, 'config', 'user.name', 't'); git(d, 'config', 'commit.gpgsign', 'false');
  write(path.join(d, '.gitkeep'), ''); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base');
  const r = run('bash', [INSTALL, d, '--apply'], { env: sp.env() }); assert.equal(r.status, 0, r.stderr + r.stdout); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'fabrica');
  return d;
}
const workspace = (sp, d) => { const r = run('bash', [INIT, '--dir', d, '--apply', 'workspace'], { cwd: d, env: sp.env() }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout.trim().split('\n').at(-1).match(/JOB=(init-\d{6}-[0-9a-f]{4})/)[1]; };

test('--apply workspace crea el job init-* con kind: docs, y la instalacion lleva la plantilla del spec docs y docs-job.mjs', () => {
  const sp = spies(); const d = installed(sp); const id = workspace(sp, d);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, `factory/jobs/${id}/job.json`), 'utf8')).kind, 'docs');
  assert.ok(fs.existsSync(path.join(d, 'factory/scripts/docs-job.mjs'))); assert.ok(fs.existsSync(path.join(d, '02-DOCS/wiki/sdd/spec-docs-template.md')));
  assert.equal(workspace(sp, d), id, 'repetirlo reutiliza el job');
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, `factory/jobs/${id}/job.json`), 'utf8')).kind, 'docs');
});
test('con el parche, next-step lleva el job de /factory-init por el spec de documentacion en lugar de parar en la base sin aprobar', { skip: nsDocs ? false : `falta aplicar ${PATCH}` }, () => {
  const sp = spies(); const d = installed(sp); const id = workspace(sp, d);
  write(path.join(d, `factory/jobs/${id}/input.md`), '# Tarea\nBase documental inicial\n');
  const r = parse(run('bash', [NEXT, id], { cwd: d, env: sp.env() }));
  assert.equal(r.kind, 'DELEGATE', r.raw); assert.match(r.value, /^@system-analyst \| /); assert.equal(r.state, '2');
});
