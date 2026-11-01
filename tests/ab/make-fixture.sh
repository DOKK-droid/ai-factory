#!/usr/bin/env bash
# Crea un repo desechable para el A/B: base correcta + rama con 3 fallos SIN pistas
# + rama limpia de control. Uso: make-fixture.sh <directorio-nuevo>
set -euo pipefail
OUT="${1:?Uso: make-fixture.sh <directorio-nuevo>}"
[ -e "$OUT" ] && { echo "ERROR: $OUT ya existe" >&2; exit 1; }
mkdir -p "$OUT/src" "$OUT/tests"; cd "$OUT"
git init -q -b main; git config user.email ab@test.local; git config user.name ab; git config commit.gpgsign false

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
import { isBlocked } from '../src/rateLimit.js';
import { getUserByEmail } from '../src/users.js';

test('bloquea al llegar al maximo de intentos', () => {
  expect(isBlocked(5)).toBe(true);
  expect(isBlocked(4)).toBe(false);
});

test('consulta usuario con parametros', () => {
  const calls = [];
  const db = { query: (sql, params) => { calls.push({ sql, params }); return []; } };
  getUserByEmail(db, 'a@b.c');
  expect(calls[0].params).toEqual(['a@b.c']);
});
JS
git add -A && git commit -qm "base: login con rate limit y consulta parametrizada"

# --- Rama con 3 fallos (sin comentarios que los delaten) ---
git checkout -qb cand-flawed
cat > src/rateLimit.js <<'JS'
const MAX_ATTEMPTS = 5;
export function isBlocked(attempts) {
  return attempts > MAX_ATTEMPTS;
}
JS
cat > src/users.js <<'JS'
export function getUserByEmail(db, email) {
  const sql = "SELECT id, email FROM users WHERE email = '" + email + "'";
  return db.query(sql);
}
JS
cat > tests/login.test.js <<'JS'
import { isBlocked } from '../src/rateLimit.js';
import { getUserByEmail } from '../src/users.js';

test('bloquea al llegar al maximo de intentos', () => {
  expect(isBlocked(5)).toBe(isBlocked(5));
  expect(isBlocked(4)).toBe(false);
});

test('consulta usuario', () => {
  const db = { query: () => [] };
  expect(getUserByEmail(db, 'a@b.c')).toEqual([]);
});
JS
git add -A && git commit -qm "feat: endurecer login"

# --- Rama limpia (control: no debe generar falsos positivos) ---
git checkout -q main && git checkout -qb cand-clean
cat > src/format.js <<'JS'
export function formatAttempts(attempts, max = 5) {
  return `${Math.min(attempts, max)}/${max}`;
}
JS
cat > tests/format.test.js <<'JS'
import { formatAttempts } from '../src/format.js';

test('formatea intentos', () => {
  expect(formatAttempts(2)).toBe('2/5');
});
test('no supera el maximo', () => {
  expect(formatAttempts(9)).toBe('5/5');
});
JS
git add -A && git commit -qm "feat: formatear intentos restantes"
git checkout -q main
echo "OK fixture en $OUT (ramas: cand-flawed, cand-clean)"
