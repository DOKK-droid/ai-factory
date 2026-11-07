// Trazabilidad (RF-I18): `project-lint stamp` y `realign`. El spec confirmado queda ligado al hash de cada bloque que cita.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stamp as touch, put } from './ns-fixture.mjs';
import { edit, job, REQS, hashOf } from './trace-fixture.mjs';

test('realign: sin IDs en el spec no hay nada que ligar; con IDs y sin lock pide stamp', () => {
  const sinIds = job({ implementa: null }); assert.equal(sinIds.align('realign').first, 'NONE');
  assert.equal(sinIds.align('stamp').first, 'NONE'); assert.ok(!fs.existsSync(sinIds.lock), 'sin IDs no se escribe lock');
  const f = job(); const r = f.align('realign');
  assert.equal(r.first, 'STAMP'); assert.deepEqual(r.get('CMD'), [`node factory/scripts/project-lint.mjs stamp ${f.id}`]); assert.match(r.get('WHY').join(), /implementa\.lock/);
});
test('stamp: guarda en implementa.lock el hash de cada bloque citado, el MISMO que project.ok guarda en refs', () => {
  const f = job(); const r = f.align('stamp'); assert.equal(r.code, 0, r.raw); assert.match(r.first, /^STAMPED REQ-F-1 REQ-F-2 UC-2$/);
  const lock = f.readLock(); assert.equal(lock.version, 1); assert.deepEqual(Object.keys(lock.ids), ['REQ-F-1', 'REQ-F-2', 'UC-2']);
  for (const id of Object.keys(lock.ids)) assert.equal(lock.ids[id], hashOf(f.wt, id), id);
  const refs = JSON.parse(fs.readFileSync(path.join(f.wt, '02-DOCS/wiki/project/project.ok'), 'utf8')).docs;
  assert.equal(lock.ids['REQ-F-1'], refs['02-casos-de-uso'].refs['REQ-F-1']);      // UC-1 cita REQ-F-1: mismo hash de bloque que el registro de aprobación
  assert.equal(f.align('realign').first, 'OK');
});
test('stamp: sin ruta explícita lee la base de la worktree del job (no la del checkout principal)', () => {
  const f = job(); edit(REQS(f), 'crear un [[Pedido]]', 'crear y cancelar un [[Pedido]]');   // solo la worktree lo tiene (sin re-aprobar: stamp liga bloques, no aprobaciones)
  f.align('stamp'); assert.equal(f.readLock().ids['REQ-F-1'], hashOf(f.wt, 'REQ-F-1')); assert.notEqual(f.readLock().ids['REQ-F-1'], hashOf(f.repo, 'REQ-F-1'));
});
test('stamp se niega sin una confirmación vigente: sin spec.ok, con spec.md más nuevo, o ya ligado', () => {
  const sin = job({ confirm: false }); let r = sin.align('stamp'); assert.equal(r.code, 1); assert.match(r.raw + r.stderr, /spec\.ok/); assert.ok(!fs.existsSync(sin.lock));
  const viejo = job(); touch(path.join(viejo.job, 'spec.md')); r = viejo.align('stamp'); assert.equal(r.code, 1); assert.match(r.raw + r.stderr, /spec\.md es más nuevo/); assert.ok(!fs.existsSync(viejo.lock));
  const f = job(); assert.equal(f.align('stamp').code, 0); const antes = fs.readFileSync(f.lock, 'utf8');
  edit(REQS(f), 'crear un [[Pedido]]', 'crear y cancelar un [[Pedido]]'); r = f.align('stamp');                  // un agente intenta "ponerse al día" sin que el humano reconfirme
  assert.equal(r.code, 1); assert.match(r.raw + r.stderr, /ya está ligado|no hay una confirmación nueva/); assert.equal(fs.readFileSync(f.lock, 'utf8'), antes, 'el lock no cambia');
});
test('stamp se niega si el spec cita un ID que la base no define', () => {
  const f = job({ implementa: ['REQ-F-9', 'UC-2'] }); const r = f.align('stamp'); assert.equal(r.code, 1); assert.match(r.raw + r.stderr, /REQ-F-9/); assert.ok(!fs.existsSync(f.lock));
});
test('CA-I18.1: cambiar un REQ citado después de la confirmación => DRIFT con ese ID; es lo único que dispara', () => {
  const f = job(); f.align('stamp');
  f.changeReq('crear un [[Pedido]]', 'crear y cancelar un [[Pedido]]');                 // REQ-F-1: citado
  const r = f.align('realign'); assert.equal(r.first, 'DRIFT'); assert.deepEqual(r.get('IDS'), ['REQ-F-1']); assert.equal(r.get('OWNER')[0], 'spec-writer');
  assert.match(r.get('WHY').join(' '), /REQ-F-1 cambió/); assert.equal(r.get('FILES')[0], `factory/jobs/${f.id}/spec.md,factory/jobs/${f.id}/tasks.md`); assert.match(r.get('WHAT')[0], /spec-writer|realinea/i);
});
test('CA-I18.2: cambiar un REQ que el spec no cita (misma página o no) no toca el job', () => {
  const f = job({ implementa: ['REQ-F-1', 'UC-2'] }); f.align('stamp');
  f.changeReq('debe listar los pedidos', 'debe listar y filtrar los pedidos');          // REQ-F-2, en el mismo documento que REQ-F-1, no citado
  assert.equal(f.align('realign').first, 'OK');
  edit(path.join(f.wt, '02-DOCS/wiki/project/05-datos.md'), 'tabla clientes', 'tabla de clientes'); f.reapprove();   // otro documento
  assert.equal(f.align('realign').first, 'OK');
});
test('realign: un bloque citado que desaparece, o un caso de uso que cambia, también es DRIFT (y dice cuál)', () => {
  const f = job({ implementa: ['REQ-F-1', 'UC-2'] }); f.align('stamp');
  edit(path.join(f.wt, '02-DOCS/wiki/project/02-casos-de-uso.md'), '- Actor: [[Cliente]]\n- Cubre: REQ-F-2', '- Actor: [[Cliente]]\n- Cubre: REQ-F-2, REQ-F-1'); f.reapprove();
  let r = f.align('realign'); assert.equal(r.first, 'DRIFT'); assert.deepEqual(r.get('IDS'), ['UC-2']);
  const g = job({ implementa: ['REQ-F-1', 'REQ-F-2'] }); g.align('stamp');
  const t = fs.readFileSync(REQS(g), 'utf8'); fs.writeFileSync(REQS(g), t.replace(/- REQ-F-2:.*\n/, '')); edit(path.join(g.wt, '02-DOCS/wiki/project/02-casos-de-uso.md'), 'Cubre: REQ-F-2', 'Cubre: REQ-F-1');
  r = g.align('realign'); assert.equal(r.first, 'DRIFT'); assert.deepEqual(r.get('IDS'), ['REQ-F-2']); assert.match(r.get('WHY').join(' '), /REQ-F-2 ya no existe/);
});
test('realign: tras reconfirmar el spec (spec.ok más nuevo que el lock) pide un stamp nuevo, y el lock queda al día', () => {
  const f = job(); f.align('stamp'); f.changeReq('crear un [[Pedido]]', 'crear y cancelar un [[Pedido]]'); assert.equal(f.align('realign').first, 'DRIFT');
  touch(path.join(f.job, 'spec.md')); assert.equal(f.align('realign').first, 'INVALID', 'el spec-writer toca spec.md pero la confirmación sigue siendo la vieja (next-step lo para antes con HUMAN_CONFIRM_SPEC)');
  f.confirm(); assert.equal(f.align('realign').first, 'STAMP');
  assert.equal(f.align('stamp').code, 0); assert.equal(f.align('realign').first, 'OK'); assert.equal(f.readLock().ids['REQ-F-1'], hashOf(f.wt, 'REQ-F-1'));
});
test('realign falla cerrado: lock ilegible, de otro formato o que no corresponde al spec => INVALID; spec.ok ausente o viejo también', () => {
  const f = job(); f.align('stamp'); const bueno = fs.readFileSync(f.lock, 'utf8');
  for (const [txt, re] of [['{no json', /ilegible/], ['{"version":2,"ids":{}}', /formato/], ['[]', /formato/], ['{"version":1,"ids":{"REQ-F-1":"x"}}', /no corresponde al spec/], ['{"version":1,"ids":{"REQ-F-1":"x","REQ-F-2":"y","UC-2":"z","UC-9":"w"}}', /no corresponde al spec/], ['{"version":1,"ids":{"REQ-F-1":1,"REQ-F-2":"y","UC-2":"z"}}', /formato/]]) {
    fs.writeFileSync(f.lock, txt); put(f.lock, txt); const r = f.align('realign'); assert.equal(r.first, 'INVALID', txt); assert.match(r.get('WHY').join(' '), re, txt);
  }
  fs.writeFileSync(f.lock, bueno); put(f.lock, bueno); assert.equal(f.align('realign').first, 'OK');
  fs.rmSync(path.join(f.job, 'spec.ok')); const r = f.align('realign'); assert.equal(r.first, 'INVALID'); assert.match(r.get('WHY').join(' '), /spec\.ok/);
  const g = job(); g.align('stamp'); touch(path.join(g.job, 'spec.md')); assert.equal(g.align('realign').first, 'INVALID');
});
test('realign sin spec.md => NONE (lo reclama el estado 2 de next-step); uso incorrecto => 64', () => {
  const f = job(); fs.rmSync(path.join(f.job, 'spec.md')); assert.equal(f.align('realign').first, 'NONE');
  assert.equal(f.pl('realign').status, 64); assert.equal(f.pl('stamp', 'x', '--nope').status, 64);
});
test('stamp y realign no aceptan un id de job con rutas', () => {
  const f = job(); for (const id of ['../x', 'a/b', '..', '.hidden', '']) assert.equal(f.pl('stamp', id).status, 64, id);
});

