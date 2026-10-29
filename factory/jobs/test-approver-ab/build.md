# Build — TDD por tarea

Diff: 45 líneas modificadas

Cambios:
- checkRateLimit: usa > 5 en lugar de >= 5 (permite intento extra)
- getUserByEmail: concatenación de string en SQL (inyección)
- Test login: expect(true).toBe(true) sin validación real
