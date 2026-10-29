# Build — TDD por tarea

Tarea 1: Implementar endpoint de login

Test en ROJO:
```
POST /login con credenciales inválidas → 401
```

Código implementado:
```
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = findUser(email);
  if (user && verifyPassword(password, user.hash)) {
    res.json({ token: generateJWT(user) });
  } else {
    res.status(401).json({ error: 'invalid credentials' });
  }
});
```

Test en VERDE:
```
POST /login → 200 + token JWT
```

Diff: 450 líneas modificadas
