---
name: python
description: Baseline conventions for Python backend work: layout, typing, tooling, configuration and testing.
status: baseline
---

## Princípio

Keep Python services boring and explicit: typed function signatures, a clear split between I/O boundaries and pure domain logic, configuration from the environment, and the project's own tools for tests, linting and types.

## Quando aplicar

Any repository with `pyproject.toml`, `requirements*.txt` or `manage.py` that carries backend code.

## Quando não aplicar

Frontend-only repositories, or projects in another language. Do not introduce `mypy`, `ruff` or a formatter the repository does not already use.

## Exemplo

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class Reservation:
    item_id: int
    quantity: int

    def __post_init__(self) -> None:
        if self.quantity <= 0:
            raise ValueError("quantity must be positive")
```

Run what the project defines: the test command from its config (`pytest`, `make test`), then its linter and type checker if configured. Read settings from environment variables, never from committed secrets. Prefer the standard library and dependencies already in the lockfile.

## Fonte

Python documentation and PEP 8/PEP 484 general conventions; refined per project by its own tooling configuration.
