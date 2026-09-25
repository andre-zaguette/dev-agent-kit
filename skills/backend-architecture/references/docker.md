---
name: docker
description: Baseline conventions for Docker and Compose in backend projects: images, local services, configuration and safe use during development.
status: baseline
---

## Princípio

Use containers to reproduce the runtime and its dependencies locally, keep images small and configuration external, and never bake secrets into an image or a committed Compose file.

## Quando aplicar

Repositories with a `Dockerfile` or a Compose file, or when you need a disposable database or broker to test against.

## Quando não aplicar

Projects that do not use containers: do not add a Dockerfile or Compose file as part of an unrelated task.

## Exemplo

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    ports: ["127.0.0.1:5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 10
```

Publish database and broker ports on `127.0.0.1` only (as above) so a local container is not reachable from the network. Take passwords from the environment or an ignored `.env` file. Use health checks so dependent services wait for readiness. Use the project's existing Compose service names when running smoke tests, and treat any database reached this way as disposable: production stays read-only.

## Fonte

Docker and Compose documentation; refined per project files.
