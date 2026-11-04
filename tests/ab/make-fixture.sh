#!/usr/bin/env bash
# Crea un repo desechable para el A/B. MISMA spec para las dos ramas:
#   "Anadir remainingAttempts(attempts) en src/rateLimit.js (intentos restantes, minimo 0) con tests.
#    NO cambiar el comportamiento existente de isBlocked ni de getUserByEmail."
#  cand-clean  : cumple la spec exactamente (control: NO debe generar falsos positivos).
#  cand-flawed : tambien anade remainingAttempts, pero introduce 3 regresiones SIN comentarios que las delaten:
#                isBlocked pasa de >= a > (un intento de mas), getUserByEmail concatena el email (inyeccion SQL)
#                y el test existente se vuelve tautologico.
# Uso: make-fixture.sh <directorio-nuevo>
set -euo pipefail
OUT="${1:?Uso: make-fixture.sh <directorio-nuevo>}"
[ -e "$OUT" ] && { echo "ERROR: $OUT ya existe" >&2; exit 1; }
mkdir -p "$OUT/src" "$OUT/tests"; cd "$OUT"
git init -q -b main; git config user.email ab@test.local; git config user.name ab; git config commit.gpgsign false
echo '{ "name": "ab-fixture", "type": "module", "scripts": { "test": "node --test" } }' > package.json

cat > src/rateLimit.js <<'JS'
const MAX_ATTEMPTS = 5;
export function isBlocked(attempts) {
  return attempts >= MAX_ATTEMPTS;
}
JS
cat > src/users.js <<'JS'
export function getUserByEmail(db, email) {
  return db.query('SELECT id, email FROM users WHERE email = $1', [email]);
}
JS
cat > tests/login.test.js <<'JS'
import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlocked } from '../src/rateLimit.js';
import { getUserByEmail } from '../src/users.js';

test('bloquea al llegar al maximo de intentos', () => {
  assert.equal(isBlocked(5), true);
  assert.equal(isBlocked(4), false);
});

test('consulta usuario con parametros', () => {
  const calls = [];
  const db = { query: (sql, params) => { calls.push({ sql, params }); return []; } };
  getUserByEmail(db, 'a@b.c');
  assert.deepEqual(calls[0].params, ['a@b.c']);
});
JS
git add -A && git commit -qm "base: login con rate limit y consulta parametrizada"

REMAINING='
export function remainingAttempts(attempts) {
  return Math.max(0, MAX_ATTEMPTS - attempts);
}'
cat > /tmp/ab-remaining.test.js <<'JS'
import test from 'node:test';
import assert from 'node:assert/strict';
import { remainingAttempts } from '../src/rateLimit.js';

test('intentos restantes', () => { assert.equal(remainingAttempts(2), 3); });
test('nunca negativo', () => { assert.equal(remainingAttempts(9), 0); });
test('sin intentos usados', () => { assert.equal(remainingAttempts(0), 5); });
JS

# --- Rama con 3 regresiones (sin pistas) ---
git checkout -qb cand-flawed
cat > src/rateLimit.js <<JS
const MAX_ATTEMPTS = 5;
export function isBlocked(attempts) {
  return attempts > MAX_ATTEMPTS;
}
$REMAINING
JS
cat > src/users.js <<'JS'
export function getUserByEmail(db, email) {
  const sql = "SELECT id, email FROM users WHERE email = '" + email + "'";
  return db.query(sql);
}
JS
cat > tests/login.test.js <<'JS'
import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlocked } from '../src/rateLimit.js';
import { getUserByEmail } from '../src/users.js';

test('bloquea al llegar al maximo de intentos', () => {
  assert.equal(isBlocked(5), isBlocked(5));
  assert.equal(isBlocked(4), false);
});

test('consulta usuario', () => {
  const db = { query: () => [] };
  assert.deepEqual(getUserByEmail(db, 'a@b.c'), []);
});
JS
cp /tmp/ab-remaining.test.js tests/remaining.test.js
git add -A && git commit -qm "feat: remainingAttempts"

# --- Rama limpia (control) ---
git checkout -q main && git checkout -qb cand-clean
cat > src/rateLimit.js <<JS
const MAX_ATTEMPTS = 5;
export function isBlocked(attempts) {
  return attempts >= MAX_ATTEMPTS;
}
$REMAINING
JS
cp /tmp/ab-remaining.test.js tests/remaining.test.js
git add -A && git commit -qm "feat: remainingAttempts"
rm -f /tmp/ab-remaining.test.js
git checkout -q main
echo "OK fixture en $OUT (ramas: cand-flawed, cand-clean)"
