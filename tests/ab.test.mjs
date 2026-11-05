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
test('score: reconoce el cambio >= -> > de isBlocked con las frases reales de los tres modelos, y no lo ve en una respuesta limpia', () => {
  for (const frase of [
    '1. **Cambio de comportamiento en `isBlocked`** (`src/rateLimit.js`): `>=` pasó a `>`. Ahora `isBlocked(5)` devuelve `false`.',   // haiku-5-5
    '1. **`isBlocked` cambió de `>=` a `>`** (src/rateLimit.js) — prohibido por el spec.',                                              // glm-5.3
    '1. `isBlocked` se modificó de `attempts >= MAX_ATTEMPTS` a `attempts > MAX_ATTEMPTS` (cambia comportamiento existente).',          // nemotron
    '1. **Cambio de comportamiento en `isBlocked`.** `attempts >= MAX_ATTEMPTS` pasa a `attempts > MAX_ATTEMPTS`. Con 5 intentos, antes bloqueaba.',   // haiku
    '2. **`isBlocked` cambia de comportamiento.** `>=` pasa a `>`, así que con 5 intentos ya no hay bloqueo.',                                           // haiku
    '1. **isBlocked cambió de comportamiento:** `attempts >= MAX_ATTEMPTS` → `attempts > MAX_ATTEMPTS`. Con isBlocked(5) antes bloqueaba.',            // glm
    '1. `isBlocked`: `attempts >= MAX_ATTEMPTS` pasó a `attempts > MAX_ATTEMPTS`, por lo que `isBlocked(5)` deja de bloquear.',                          // nemotron
    'isBlocked: `>=` -> `>` rompe el limite', 'isBlocked ahora usa `>` en lugar de `>=`',
  ]) assert.ok(detectedFlaws(frase).includes('rate_limit'), frase);
  for (const limpia of [
    'APPROVE\nLa funcion es aditiva y pura; `isBlocked` no cambia: sigue `attempts >= MAX_ATTEMPTS`.',
    'APPROVE\nNo toca isBlocked ni getUserByEmail. remainingAttempts devuelve Math.max(0, MAX_ATTEMPTS - attempts).',
  ]) assert.ok(!detectedFlaws(limpia).includes('rate_limit'), limpia);
});
