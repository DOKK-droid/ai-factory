// spec-lint.mjs: estructura del spec segun el perfil, trazabilidad RF -> criterio -> tarea.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { REPO, tmp, write, run } from './helpers.mjs';
import { lint, adr, summary, section } from '../factory/scripts/spec-lint.mjs';
import { SPEC, SPEC_FULL, TASKS_FULL } from './ns-fixture.mjs';

const has = (problems, re) => assert.ok(problems.some((p) => re.test(p)), `esperaba un problema /${re}/ en:\n${problems.join('\n')}`);

test('standard: acepta el spec clasico y exige Surface, criterios, Alcance y tasks', () => {
  assert.deepEqual(lint(SPEC(), '- t\n'), []);
  has(lint(SPEC().replace(/^Surface:.*\n/m, ''), 't'), /Surface/);
  has(lint(SPEC({ surface: 'mobile' }), 't'), /Surface/);
  has(lint(SPEC({ criteria: '- algo' }), 't'), /criterios/);
  has(lint(SPEC({ alcance: '' }), 't'), /Alcance/);
  has(lint(SPEC(), ''), /tasks\.md/);
  assert.deepEqual(lint('', 't'), ['falta spec.md o esta vacio']);
});
test('standard no exige actores ni requisitos (un spec antiguo sigue valiendo)', () => assert.deepEqual(lint(SPEC(), 't', 'standard'), []));
test('full: el spec completo valida', () => assert.deepEqual(lint(SPEC_FULL(), TASKS_FULL, 'full'), []));
test('full: cada seccion que falta se nombra', () => {
  has(lint(SPEC_FULL().replace(/^ADR:.*\n/m, ''), TASKS_FULL, 'full'), /ADR/);
  has(lint(SPEC_FULL().replace(/## Actores[\s\S]*?\n(?=## Req)/, ''), TASKS_FULL, 'full'), /Actores/);
  has(lint(SPEC_FULL().replace(/## Requisitos funcionales[\s\S]*?\n(?=## Dise)/, ''), TASKS_FULL, 'full'), /Requisitos funcionales/);
  has(lint(SPEC_FULL().replace(/## Diseño[\s\S]*?\n(?=## Crit)/, ''), TASKS_FULL, 'full'), /Diseño/);
});
test('full: trazabilidad. Criterio sin [RF], RF no declarado, RF sin criterio, RF sin tarea, ids repetidos', () => {
  has(lint(SPEC_FULL().replace('1. [RF-1] devuelve', '1. devuelve'), TASKS_FULL, 'full'), /criterio 1 no cita/);
  has(lint(SPEC_FULL().replace('[RF-2] devuelve', '[RF-9] devuelve'), TASKS_FULL, 'full'), /cita RF-9, que no esta declarado/);
  has(lint(SPEC_FULL().replace('[RF-2] devuelve', '[RF-1] devuelve'), TASKS_FULL, 'full'), /RF-2 no esta cubierto/);
  has(lint(SPEC_FULL(), '- [ ] T1 (RF-1): solo uno\n', 'full'), /RF-2 no aparece en tasks\.md/);
  has(lint(SPEC_FULL().replace('- RF-2: acota', '- RF-1: acota'), TASKS_FULL, 'full'), /repetidos/);
  has(lint(SPEC_FULL().replace('- RF-2: acota por encima', '- acota por encima'), TASKS_FULL, 'full'), /empezar por su id/);
});
test('las secciones valen como "## Actores" y como "Actores:" y el cuerpo termina en la siguiente', () => {
  const plain = SPEC_FULL().replace('## Actores', 'Actores:').replace('## Requisitos funcionales', 'Requisitos funcionales:').replace('## Diseño', 'Diseño:').replace('## Criterios de aceptación', 'Criterios de aceptación:').replace('## Alcance', 'Alcance:');
  assert.deepEqual(lint(plain, TASKS_FULL, 'full'), []);
  assert.deepEqual(section(SPEC_FULL(), 'actores'), ['- Desarrollador: usa la funcion en su codigo', '- Suite de tests: verifica el comportamiento']);
  assert.equal(section('# x\nSurface: none\n', 'actores'), null);
});
test('adr: none por defecto, vacio o "ninguno"; un titulo se devuelve tal cual; sin linea => null', () => {
  assert.equal(adr(SPEC_FULL()), 'none'); assert.equal(adr(SPEC_FULL({ adr: 'Usar clamp central' })), 'Usar clamp central');
  assert.equal(adr('ADR: Ninguno\n'), 'none'); assert.equal(adr('ADR:\n'), 'none'); assert.equal(adr(SPEC()), null);
});
test('summary: actores, requisitos, alcance y ADR a registrar', () => {
  const s = summary(SPEC_FULL({ adr: 'Una decision' })).join('\n');
  assert.match(s, /Surface: none \| criterios: 2/); assert.match(s, /Actores \(2\): Desarrollador, Suite de tests/); assert.match(s, /Requisitos funcionales: 2/);
  assert.match(s, /Alcance: src\/\*\*/); assert.match(s, /ADR a registrar: Una decision/);
});
test('CLI: check sale 0/1 y adr/summary imprimen', () => {
  const d = tmp('af-lint-'); write(path.join(d, 'spec.md'), SPEC_FULL()); write(path.join(d, 'tasks.md'), TASKS_FULL);
  const cli = (...a) => run('node', [path.join(REPO, 'factory/scripts/spec-lint.mjs'), ...a], { cwd: d });
  assert.equal(cli('check', 'spec.md', 'tasks.md', 'full').status, 0);
  write(path.join(d, 'tasks.md'), 'x\n'); const r = cli('check', 'spec.md', 'tasks.md', 'full'); assert.equal(r.status, 1); assert.match(r.stdout, /RF-1 no aparece/);
  assert.equal(cli('adr', 'spec.md').stdout.trim(), 'none'); assert.equal(cli('bogus').status, 64);
});
