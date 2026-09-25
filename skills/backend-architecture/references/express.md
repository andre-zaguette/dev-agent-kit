---
name: express
description: Baseline conventions for Express services: routers, async error handling, validation, error middleware and testing.
status: baseline
---

## Princípio

Keep route handlers thin, put business logic in services, validate input at the edge, and send every failure through one error-handling middleware so clients always get the same error shape.

## Quando aplicar

Node projects that list `express` as a dependency, in JavaScript or TypeScript. Load `node-typescript.md` for the language-level conventions.

## Quando não aplicar

NestJS projects (use `nestjs.md`) or other frameworks. Do not add `helmet`, `cors`, a validation library or an ORM the project does not already use.

## Exemplo

```ts
const router = Router();

router.post('/notes/:id/archive', requireAuth, async (req, res, next) => {
  try {
    const note = await notes.findOwned(req.params.id, req.user.id); // scoped by owner
    if (!note) return res.status(404).json({ code: 'NOTE_NOT_FOUND' });
    await notes.archive(note); // idempotent: a second call keeps archived_at
    res.json({ id: note.id, archivedAt: note.archivedAt });
  } catch (error) {
    next(error); // Express 4 needs this; Express 5 forwards rejected promises itself
  }
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ValidationError) return res.status(400).json({ code: 'INVALID_INPUT' });
  logger.error({ err: error }, 'unhandled');
  res.status(500).json({ code: 'INTERNAL_ERROR' });
});
```

Register the error middleware last, wrap async handlers (or use Express 5), never trust `req.body` types, set timeouts on outbound calls, keep secrets in environment variables, and test routes with the project's runner and `supertest`. Shut down gracefully: stop accepting connections, finish in-flight requests, then close database pools.

## Fonte

Express documentation (routing, error handling, production best practices); refined per project conventions.
