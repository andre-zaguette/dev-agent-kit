---
name: openapi
description: Baseline conventions for keeping an OpenAPI description accurate: schemas, error responses, versioning and generated documents.
status: baseline
---

## Princípio

The OpenAPI description is a contract: keep it generated from code where the framework can, otherwise edit it with the change, and make it show every success and error response.

## Quando aplicar

Projects that publish or consume an OpenAPI/Swagger description, or frameworks that generate one.

## Quando não aplicar

Projects with no API description: do not introduce a tool or a spec file as a side effect of an endpoint change.

## Exemplo

```yaml
paths:
  /items/{id}/reserve:
    post:
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/ReserveIn' }
      responses:
        '201': { description: Reserved, content: { application/json: { schema: { $ref: '#/components/schemas/ReservationOut' } } } }
        '404': { $ref: '#/components/responses/NotFound' }
        '409': { $ref: '#/components/responses/Conflict' }
```

Reuse shared error schemas, describe authentication once in `securitySchemes`, avoid leaking internal fields, and regenerate or diff the document after the change. Treat a removed field or a changed type as a breaking change.

## Fonte

OpenAPI Specification 3.x; refined per project tooling.
