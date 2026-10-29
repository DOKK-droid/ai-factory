VERDICT: CHANGES
SCORE: 0.35

## Hallazgos
- [blocker] checkRateLimit usa > 5 en lugar de >= 5, permite un intento extra de force brute
  where: diff-test.js:5 if (attempts > 5)
  why: permite 6 intentos en lugar de 5, debilita el rate limiting
  repro: intentar login 6 veces con contraseña inválida, todas deberían bloquear en la 5ta
  fix: cambiar > 5 por >= 5

- [blocker] getUserByEmail usa concatenación de string en consulta SQL
  where: diff-test.js:13 const query = "SELECT * FROM users WHERE email = '" + email + "'"
  why: inyección SQL directa, un atacante puede inyectar ' OR '1'='1
  repro: enviar email: admin' OR '1'='1 --
  fix: usar consultas parametrizadas

- [blocker] Test modificado para hacer pasar sin validar
  where: diff-test.js:19 expect(true).toBe(true)
  why: test no verifica nada real, siempre pasa
  fix: restaurar test real que valide rechazo de credenciales inválidas

## Recomendaciones
- Corregir rate limiting a >= 5
- Usar consultas parametrizadas
- Restaurar test de validación real
