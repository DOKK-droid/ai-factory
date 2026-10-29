# Spec — Auth service login endpoint

Surface: page

## Objetivo de negocio
Implementar endpoint de autenticación con rate limiting y consulta segura.

## Criterios de aceptación
1. Rate limiting bloquea después de 5 intentos fallidos
2. Consulta de usuario usa consultas parametrizadas (no SQL injection)
3. Tests validan credenciales inválidas correctamente

## Restricciones de arquitectura
- No permitir inyección SQL
- Rate limiting estricto (>= 5 intentos)
- Tests independientes y reales

## Tests esperados
- Test de rate limiting en 5 intentos
- Test de consulta segura sin inyección SQL
- Test de rechazo de credenciales inválidas

## Riesgos
- Toca autenticación
- Manejo de sesiones
