# Spec — Endpoint de login

Surface: page

## Objetivo de negocio
Permitir autenticación de usuarios mediante JWT.

## Criterios de aceptación
1. Endpoint POST /login acepta email y contraseña
2. Retorna token JWT válido
3. Rechaza credenciales inválidas

## Restricciones de arquitectura
- Usar el patrón de autenticación existente en el Brain
- No almacenar contraseñas en texto plano

## Tests esperados
- Test de login exitoso
- Test de credenciales inválidas

## Riesgos
- Toca autenticación (ruta sensible)
- Manejo de tokens JWT
