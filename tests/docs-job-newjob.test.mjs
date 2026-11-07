// new-job.sh --kind docs|code (rama 6): job.json lleva `kind`; un valor invalido no crea nada.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, run, git, makeRepo } from './helpers.mjs';

const NEW = path.join(REPO, '01-TOOLS/new-job.sh');
const mk = () => { const d = makeRepo({ '.gitignore': 'factory/jobs/\nfactory/worktrees/\n' }); git(d, 'checkout', '-q', 'main'); return d; };
const nj = (d, ...args) => run('bash', [NEW, ...args], { cwd: d, env: { ...process.env } });
const jobJson = (d, id) => JSON.parse(fs.readFileSync(path.join(d, 'factory/jobs', id, 'job.json'), 'utf8'));

test('sin --kind el job es de codigo y job.json lo dice (los jobs antiguos sin kind se leen como code)', () => {
  const d = mk(); const r = nj(d, 'j1'); assert.equal(r.status, 0, r.stderr);
  const j = jobJson(d, 'j1'); assert.equal(j.kind, 'code'); assert.equal(j.branch, 'factory/j1'); assert.equal(j.id, 'j1');
});
test('--kind docs crea el mismo job con kind docs; --kind code es igual que omitirlo', () => {
  const d = mk(); assert.equal(nj(d, 'd1', '--kind', 'docs').status, 0); assert.equal(jobJson(d, 'd1').kind, 'docs');
  assert.equal(nj(d, 'c1', '--kind', 'code').status, 0); assert.equal(jobJson(d, 'c1').kind, 'code');
  assert.equal(git(path.join(d, 'factory/worktrees/d1'), 'branch', '--show-current').trim(), 'factory/d1');
});
test('el orden de los argumentos no importa: --kind antes del id tambien vale', () => {
  const d = mk(); assert.equal(nj(d, '--kind', 'docs', 'd2').status, 0); assert.equal(jobJson(d, 'd2').kind, 'docs');
});
test('un kind desconocido, vacio o sin valor falla y no deja rama, worktree ni carpeta de job', () => {
  const d = mk();
  for (const bad of [['x1', '--kind', 'otro'], ['x2', '--kind', ''], ['x3', '--kind'], ['x4', '--kind', 'DOCS'], ['x5', '--kind', 'docs', '--kind', 'code'], ['x6', '--tipo', 'docs'], ['x7', 'y7']]) {
    const r = nj(d, ...bad); assert.notEqual(r.status, 0, bad.join(' '));
    const id = bad[0];
    assert.equal(fs.existsSync(path.join(d, 'factory/worktrees', id)), false, `worktree ${id}`);
    assert.equal(fs.existsSync(path.join(d, 'factory/jobs', id)), false, `job ${id}`);
    assert.equal(git(d, 'branch', '--list', `factory/${id}`).trim(), '', `rama ${id}`);
  }
});
test('el mensaje final nombra el kind del job', () => {
  const d = mk(); assert.match(nj(d, 'd3', '--kind', 'docs').stdout, /kind:\s+docs/);
});
