// job-cost.mjs: agrega por rol las sesiones de un proyecto desde opencode.db (fixture sqlite temporal, solo lectura).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REPO, tmp, run } from './helpers.mjs';
import { collect, roleOf, formatTable, defaultDbPath } from '../factory/scripts/job-cost.mjs';

const SCRIPT = path.join(REPO, 'factory/scripts/job-cost.mjs');

function fixture() {
  const file = path.join(tmp('af-jobcost-'), 'opencode.db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE session (id text PRIMARY KEY, parent_id text, directory text, title text, cost real, tokens_input integer, tokens_output integer,
    tokens_reasoning integer, tokens_cache_read integer, tokens_cache_write integer, agent text, model text, time_created integer);
    CREATE TABLE message (id text PRIMARY KEY, session_id text, time_created integer, data text);
    CREATE TABLE account (id text, access_token text);
    INSERT INTO account VALUES ('a', 'SECRETO-NO-DEBE-SALIR');`);
  const ses = db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const msg = db.prepare('INSERT INTO message VALUES (?,?,?,?)');
  const model = JSON.stringify({ id: 'claude-haiku-5-5', providerID: 'opencode-go' });
  ses.run('p', null, '/proj', 'Inicializacion', 1.0, 10, 500, 0, 3000, 200, 'discovery', model, 1);
  ses.run('s1', 'p', '/proj', 'Redactar 04 (@architect subagent)', 0.1, 5, 50, 0, 100, 20, 'architect', model, 2);
  ses.run('s2', 'p', '/proj/factory/worktrees/j1', 'Corregir 04 (@architect subagent)', 0.2, 5, 60, 0, 200, 0, 'architect', model, 3);
  ses.run('x', null, '/proj-otro', 'Otro proyecto', 9.0, 1, 1, 0, 1, 0, 'build', model, 4);
  const tk = (i, r, w) => JSON.stringify({ role: 'assistant', tokens: { input: i, output: 1, reasoning: 0, cache: { read: r, write: w } } });
  msg.run('m1', 'p', 1, tk(2, 1000, 100)); msg.run('m2', 'p', 2, tk(2, 2000, 0));
  msg.run('m3', 'p', 3, JSON.stringify({ role: 'user' }));
  msg.run('m4', 's1', 1, tk(4, 0, 50)); msg.run('m5', 's2', 1, tk(1, 300, 0));
  db.close();
  return file;
}

test('roleOf: subagente por titulo, principal si no lo hay', () => {
  assert.equal(roleOf('Redactar (@system-analyst subagent)', 'x'), 'system-analyst');
  assert.equal(roleOf('Inicializacion', 'discovery'), 'principal(discovery)');
});

test('collect agrega por rol, cuenta turnos, correcciones y contexto maximo', () => {
  const db = new DatabaseSync(fixture(), { readOnly: true });
  const rep = collect(db, '/proj');
  db.close();
  assert.equal(rep.sesiones, 3, 'incluye la worktree y excluye /proj-otro');
  const arch = rep.roles.find((r) => r.role === 'architect');
  assert.equal(arch.sesiones, 2); assert.equal(arch.turnos, 2); assert.equal(arch.correcciones, 1);
  assert.equal(arch.cacheLectura, 300); assert.ok(Math.abs(arch.costo - 0.3) < 1e-9);
  assert.equal(arch.contextoMax, 301);
  const main = rep.roles.find((r) => r.role === 'principal(discovery)');
  assert.equal(main.turnos, 2, 'no cuenta los mensajes de usuario');
  assert.equal(main.contextoMax, 2002);
  assert.ok(Math.abs(rep.total.costo - 1.3) < 1e-9);
  assert.equal(main.model, 'opencode-go/claude-haiku-5-5');
});

test('formatTable incluye TOTAL y la advertencia de que el costo es estimado', () => {
  const db = new DatabaseSync(fixture(), { readOnly: true });
  const out = formatTable(collect(db, '/proj')); db.close();
  assert.match(out, /TOTAL/); assert.match(out, /estimacion de OpenCode/);
});

test('CLI: tabla, --json, y no imprime nada de otras tablas', () => {
  const db = fixture();
  const t = run(process.execPath, [SCRIPT, '/proj', '--db', db]);
  assert.equal(t.status, 0, t.stderr); assert.match(t.stdout, /architect/);
  assert.ok(!t.stdout.includes('SECRETO'));
  const j = run(process.execPath, [SCRIPT, '/proj', '--json', '--db', db]);
  assert.equal(JSON.parse(j.stdout).roles.length, 2);
});

test('CLI: sin argumentos -> 1; base inexistente -> 3 (no inventa cifras)', () => {
  assert.equal(run(process.execPath, [SCRIPT]).status, 1);
  const r = run(process.execPath, [SCRIPT, '/proj', '--db', '/no/existe.db']);
  assert.equal(r.status, 3); assert.equal(r.stdout, '');
});

test('la base se abre en solo lectura: no se puede escribir', () => {
  const file = fixture();
  const ro = new DatabaseSync(file, { readOnly: true });
  assert.throws(() => ro.exec('DELETE FROM session'));
  ro.close();
});

test('defaultDbPath respeta OPENCODE_DB y XDG_DATA_HOME', () => {
  assert.equal(defaultDbPath({ OPENCODE_DB: '/a/b.db' }), '/a/b.db');
  assert.equal(defaultDbPath({ XDG_DATA_HOME: '/x' }), '/x/opencode/opencode.db');
});
