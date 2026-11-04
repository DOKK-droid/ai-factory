import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { factoryGuard } from '../.opencode/plugins/factory-guard.js';

async function mk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-'));
  const hooks = await factoryGuard({ directory: dir });
  const run = (tool, args) => hooks['tool.execute.before']({ tool }, { args });
  return { dir, run };
}
const grave = (run) => run('bash', { command: 'echo x > opencode.json' });
const policy = (run) => run('bash', { command: 'gh pr create --title x' });

test('comandos de lectura con 2>&1 sobre rutas protegidas no cuentan', async () => {
  const { run } = await mk();
  for (let i = 0; i < 6; i++) await run('bash', { command: 'bash 01-TOOLS/new-job.sh j 2>&1' });
});

test('3 bloqueos graves => modo parada: solo lectura; escribe BLOCKED.md', async () => {
  const { dir, run } = await mk();
  for (let i = 0; i < 3; i++) await assert.rejects(grave(run), /BLOCKED/);
  await assert.rejects(run('bash', { command: 'ls' }), /STOP/);
  await assert.rejects(run('write', { filePath: 'a.txt' }), /STOP/);
  await run('read', { filePath: 'a.txt' });
  assert.ok(fs.existsSync(path.join(dir, 'factory/logs/BLOCKED.md')));
  assert.equal(fs.readFileSync(path.join(dir, 'factory/logs/blocked.log'), 'utf8').trim().split('\n').length, 3);
});

test('los errores de politica tienen mas margen (10) antes de parar', async () => {
  const { run } = await mk();
  for (let i = 0; i < 9; i++) await assert.rejects(policy(run), /politica/);
  await assert.rejects(policy(run), /DETENIDA/);
  await assert.rejects(run('bash', { command: 'ls' }), /STOP/);
});

test('touch factory/logs/RESET (humano) reanuda la sesion sin reiniciar', async () => {
  const { dir, run } = await mk();
  for (let i = 0; i < 3; i++) await assert.rejects(grave(run));
  await assert.rejects(run('bash', { command: 'ls' }), /STOP/);
  fs.writeFileSync(path.join(dir, 'factory/logs/RESET'), '');
  await run('bash', { command: 'ls' });
  assert.ok(!fs.existsSync(path.join(dir, 'factory/logs/BLOCKED.md')));
  assert.ok(!fs.existsSync(path.join(dir, 'factory/logs/RESET')));
});

test('un agente no puede crear RESET (factory/logs/ esta protegido)', async () => {
  const { run } = await mk();
  await assert.rejects(run('bash', { command: 'touch factory/logs/RESET' }), /BLOCKED/);
  await assert.rejects(run('write', { filePath: 'factory/logs/RESET', content: '' }), /BLOCKED/);
});
