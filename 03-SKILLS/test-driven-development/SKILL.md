---
name: test-driven-development
description: Fuerza el ciclo Rojo-Verde-Rrefactor: escribir test primero, ver que falla, implementar código mínimo para pasar, refactorizar. No hay producción sin test previo.
tags: [tdd, testing, development]
recommends: [factory-protocol]
profiles: [core, full]
origin: custom
---

# Test-Driven Development (TDD)

## Overview

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.

## When to Use

**Always:**
- New features
- Bug fixes  
- Refactoring
- Behavior changes

**Exceptions (ask your human partner):**
- Throwaway prototypes
- Generated code
- Configuration files

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? Delete it. Start over.

**No exceptions:**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete

Implement fresh from tests. Period.

## Red-Green-Refactor Cycle

```dot
digraph tdd_cycle {
    rankdir=LR;
    red [label="RED\nWrite failing test", shape=box, style=filled, fillcolor="#ffcccc"];
    verify_red [label="Verify fails\ncorrectly", shape=diamond];
    green [label="GREEN\nMinimal code", shape=box, style=filled, fillcolor="#ccffcc"];
    verify_green [label="Verify passes\nAll green", shape=diamond];
    refactor [label="REFACTOR\nClean up", shape=box, style=filled, fillcolor="#ccccff"];
    next [label="Next", shape=ellipse];

    red -> verify_red;
    verify_red -> green [label="yes"];
    verify_green -> refactor;
    refactor -> next;
    next -> red;
}
```

## Rules

- **Never** write production code without a failing test first
- Write minimal code to make the test pass
- After passing (GREEN), refactor safely
- Commits atómicos: test primero, luego código
- Consultar el Brain (`02-DOCS/`) para convenciones del proyecto