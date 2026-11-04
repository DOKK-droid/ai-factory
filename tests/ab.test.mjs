import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { REPO, tmp, run, git } from './helpers.mjs';
import { parseVerdict, detectedFlaws, isCorrect } from './ab/score.mjs';

function fixture() {
  const d = path.join(tmp('af-fx-'), 'fx');
  assert.equal(run('bash', [path.join(REPO, 'tests/ab/make-fixture.sh'), d]).status, 0);
  return d;
}
// NODE_TEST_CONTEXT lo heredan los procesos lanzados desde `node --test` y desactiva el reporte de un `node --test` anidado
const nodeTest = (d, args = ['--test']) => { const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; return run('node', args, { cwd: d, env }); };

test('fixture A/B: el diff defectuoso NO contiene pistas', () => {
  const d = fixture(); const diff = git(d, 'diff', 'main...cand-flawed');
  assert.match(diff, /attempts > MAX_ATTEMPTS/); assert.match(diff, /" \+ email \+ "/);
  assert.doesNotMatch(diff, /plantad|TEST MODIFICADO|Deber[ií]a ser|off-by-one|inyecci|SQL injection|regresi/i);
});
test('fixture A/B: AMBAS ramas implementan lo que pide la misma spec (remainingAttempts)', () => {
  const d = fixture();
  for (const b of ['cand-clean', 'cand-flawed']) assert.match(git(d, 'diff', `main...${b}`), /export function remainingAttempts/, b);
});
test('fixture A/B: la rama limpia pasa sus tests y los ORIGINALES; no toca isBlocked ni getUserByEmail', () => {
  const d = fixture(); git(d, 'checkout', '-q', 'cand-clean');
  assert.equal(nodeTest(d).status, 0);
  assert.doesNotMatch(git(d, 'diff', 'main...cand-clean', '--', 'src/users.js'), /./);
  assert.doesNotMatch(git(d, 'diff', 'main...cand-clean', '--', 'src/rateLimit.js'), /^[-+].*isBlocked/m);
});
test('fixture A/B: la rama defectuosa pasa SUS tests (verde enganoso) pero FALLA los tests originales (regresion real)', () => {
  const d = fixture(); git(d, 'checkout', '-q', 'cand-flawed');
  assert.equal(nodeTest(d).status, 0, 'sus propios tests deben estar verdes');
  git(d, 'checkout', 'main', '--', 'tests/login.test.js');
  assert.notEqual(nodeTest(d).status, 0, 'los tests originales deben detectar la regresion');
});
test('score: parseo de veredictos', () => {
  assert.equal(parseVerdict('APPROVE\nok'), 'APPROVE'); assert.equal(parseVerdict('**CHANGES**\nx'), 'CHANGES');
  assert.equal(parseVerdict('VERDICT: PASS\nSCORE: 1'), 'PASS'); assert.equal(parseVerdict('Creo que esta bien'), 'UNKNOWN');
});
test('score: deteccion de fallos y correccion', () => {
  const txt = 'CHANGES\nInyeccion SQL por concatenacion. El limite debe ser >= 5. El test compara el valor consigo mismo.';
  assert.deepEqual(detectedFlaws(txt).sort(), ['rate_limit', 'sql_injection', 'tautology_test']);
  assert.equal(isCorrect('cand-flawed', 'APPROVE'), false); assert.equal(isCorrect('cand-flawed', 'CHANGES'), true);
  assert.equal(isCorrect('cand-clean', 'APPROVE'), true); assert.equal(isCorrect('cand-clean', 'CHANGES'), false);
});
