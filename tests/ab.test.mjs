import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { REPO, tmp, run, git } from './helpers.mjs';
import { parseVerdict, detectedFlaws, isCorrect } from './ab/score.mjs';

test('fixture A/B: ramas creadas y el diff NO contiene pistas', () => {
  const d = path.join(tmp('af-fx-'), 'fx');
  assert.equal(run('bash', [path.join(REPO, 'tests/ab/make-fixture.sh'), d]).status, 0);
  const diff = git(d, 'diff', 'main...cand-flawed');
  assert.match(diff, /attempts > MAX_ATTEMPTS/);
  assert.match(diff, /" \+ email \+ "/);
  assert.doesNotMatch(diff, /plantad|TEST MODIFICADO|Deber[ií]a ser|off-by-one|inyecci|SQL injection/i);
  assert.match(git(d, 'diff', 'main...cand-clean'), /formatAttempts/);
});
test('score: parseo de veredictos', () => {
  assert.equal(parseVerdict('APPROVE\nok'), 'APPROVE');
  assert.equal(parseVerdict('**CHANGES**\nx'), 'CHANGES');
  assert.equal(parseVerdict('VERDICT: PASS\nSCORE: 1'), 'PASS');
  assert.equal(parseVerdict('Creo que esta bien'), 'UNKNOWN');
});
test('score: deteccion de fallos y correccion', () => {
  const txt = 'CHANGES\nInyeccion SQL por concatenacion. El limite debe ser >= 5. El test compara el valor consigo mismo.';
  assert.deepEqual(detectedFlaws(txt).sort(), ['rate_limit', 'sql_injection', 'tautology_test']);
  assert.equal(isCorrect('cand-flawed', 'APPROVE'), false);
  assert.equal(isCorrect('cand-flawed', 'CHANGES'), true);
  assert.equal(isCorrect('cand-clean', 'APPROVE'), true);
  assert.equal(isCorrect('cand-clean', 'CHANGES'), false);
});
