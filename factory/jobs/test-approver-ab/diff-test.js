# Auth service — login endpoint (test diff for approver A/B)

# Fallo 1: Bug de lógica — off-by-one en rate limiting
function checkRateLimit(attempts) {
  // Debería ser >= 5, usa > 5 permitiendo un intento extra
  if (attempts > 5) {
    return false; // bloqueado
  }
  return true; // permitido
}

# Fallo 2: Inyección SQL — consulta sin parametrizar
function getUserByEmail(email) {
  const query = "SELECT * FROM users WHERE email = '" + email + "'";
  return db.query(query);
}

# Fallo 3: Test modificado para hacer pasar sin validar
test("login rejects invalid credentials", () => {
  // TEST MODIFICADO: assert siempre verdadero, no valida nada real
  expect(true).toBe(true);
});
