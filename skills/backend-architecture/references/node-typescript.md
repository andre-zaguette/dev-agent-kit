---
name: node-typescript
description: Baseline conventions for Node.js backend work in TypeScript: strictness, async code, validation, configuration and tooling.
status: baseline
---

## Princípio

Type the boundaries, validate untrusted input at runtime, keep async code explicit, and use the toolchain the project already has for tests, lint and type checking.

## Quando aplicar

Node backends (NestJS, Express or plain) with `package.json` and, usually, `tsconfig.json`.

## Quando não aplicar

Frontend projects or other runtimes. Do not add a validation, ORM or test library the project does not use.

## Exemplo

```ts
export async function reserve(repo: ItemRepo, input: unknown): Promise<Reservation> {
  const { itemId, quantity } = parseReserveInput(input); // throws a typed validation error
  return repo.transaction(async (tx) => {
    const item = await tx.lock(itemId);
    if (item.stock < quantity) throw new OutOfStockError(itemId);
    return tx.save({ itemId, quantity });
  });
}
```

Never trust `req.body` types: validate at runtime. Handle promise rejections (no floating promises), set timeouts on outbound calls, keep configuration in environment variables, and run the project's `test`, `lint` and `typecheck` scripts (`tsc --noEmit`).

## Fonte

Node.js and TypeScript documentation; refined per project `tsconfig` and scripts.
