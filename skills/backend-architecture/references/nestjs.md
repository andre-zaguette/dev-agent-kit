---
name: nestjs
description: NestJS guide: feature modules, dependency injection and scopes, DTO validation with ValidationPipe, request pipeline, exception filters, configuration and testing with supertest.
status: guide
---

Targets: NestJS 12 (ESM packages; docs list Node.js 20.19+ or 22.12+ on 22.x) with TypeScript.

## Princípio

Follow Nest's structure: a module per feature, thin controllers, providers for logic and data access, DTO classes validated by pipes, guards for authentication and authorization, and exception filters that map domain errors to HTTP. Controllers translate HTTP to a service call and back; business rules live in providers.

## Quando aplicar

Projects depending on `@nestjs/core`. Read the project's `package.json` for the installed major and module system before copying syntax: v12 docs use ESM imports with `.js` extensions, a CommonJS project does not.

## Quando não aplicar

Plain Express or other Node frameworks. Load `node-typescript.md` as well for general Node conventions. Do not introduce class-validator, `@nestjs/config` or an ORM if the project does not already use them; follow the project's schema validator and persistence layer.

## Exemplo

```ts
import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard.js';
import { UsersService } from './users.service.js';

export class DeactivateUserDto {
  @IsString()
  @MaxLength(200)
  reason!: string;
}

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post(':id/deactivate')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeactivateUserDto) {
    return this.users.deactivate(id, dto.reason);
  }
}
```

The DTO is a class, not an interface: interfaces vanish at transpilation, so Nest cannot validate against them. `AuthGuard` and `UsersService` are the project's own providers. Nest publishes an OpenAPI description through its Swagger module when the project uses it.

## Estrutura do projeto

One module per feature, declaring its controllers and providers and exporting only what other modules need:

```ts
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- Modules are singletons: importing `UsersModule` shares one `UsersService`; re-registering the service in several modules creates separate instances.
- `@Global()` makes a module's exports available everywhere; register it once and use it sparingly, since explicit `imports` keep dependencies visible.
- Providers carry `@Injectable()` and are injected by class type in the constructor; the type must be a runtime class, not an interface.
- Default scope is singleton. `Scope.REQUEST` creates an instance per request and bubbles up: a controller that injects a request-scoped provider becomes request-scoped. The docs say request scope affects performance and recommend singleton unless a provider must be request-scoped.
- The request pipeline runs: middleware, guards, interceptors (before the handler), pipes, the handler, interceptors (after); exception filters run only when an exception escapes any of these steps. Use guards for authentication and authorization, interceptors for cross-cutting concerns (logging, response mapping, caching), pipes for transformation and validation.

## Dados e estado

- Persistence goes through the project's ORM or client, wrapped in a provider (repository or service); controllers never touch it.
- Return DTOs or mapped objects, not entities, so internal columns do not leak.
- Configuration through `@nestjs/config` only if present: `ConfigModule.forRoot({ isGlobal: true })`, then inject `ConfigService` and read `configService.get<string>('DATABASE_USER')`. Group settings with `registerAs('database', () => ({ ... }))` and `load: [databaseConfig]`. Validate environment at startup with `validationSchema` (the docs recommend a Standard Schema library such as Zod; Joi v18+ still works) or a `validate` function that throws, so the app does not boot with bad settings.
- Keep state in providers (singletons) only if it is safe to share across requests; per-request data belongs in the request or in a request-scoped provider.

## Erros e validação

Register one global `ValidationPipe` in `main.ts` (it needs `class-validator` and `class-transformer`):

```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
```

- `whitelist: true` strips properties without validation decorators; add `forbidNonWhitelisted: true` when the API should reject extra properties with a 400 instead.
- `transform: true` turns payloads into DTO instances and converts primitives to the declared parameter types.
- Query and path values arrive as strings; validate them with `ParseIntPipe`, `ParseUUIDPipe` or `DefaultValuePipe` on `@Param` and `@Query`, or with a DTO.
- Throw `HttpException` subclasses for expected failures and map domain errors in a filter with `@Catch(DomainError)`. A catch-all `@Catch()` filter built on `HttpAdapterHost` stays platform-agnostic; declare it before type-specific filters. Bind globally with `APP_FILTER` in a module when the filter needs injection (`useGlobalFilters(new ...)` cannot inject).
- Change a status code with `@HttpCode(...)` (POST returns 201 by default).

## Testes

Unit-test a provider or controller with `Test.createTestingModule(...).compile()` and `moduleRef.get(...)`. Replace collaborators with `overrideProvider(X).useValue(fake)`, and guards with `overrideGuard(AuthGuard).useValue({ canActivate: () => true })`. End-to-end tests use `supertest` against `app.getHttpServer()`:

```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../../src/auth/auth.guard.js';
import { UsersModule } from '../../src/users/users.module.js';
import { UsersService } from '../../src/users/users.service.js';

describe('Users', () => {
  let app: INestApplication;
  const users = { deactivate: () => ({ ok: true }) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [UsersModule] })
      .overrideProvider(UsersService)
      .useValue(users)
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  it('rejects an invalid body', () =>
    request(app.getHttpServer()).post('/users/not-a-uuid/deactivate').send({}).expect(400));

  afterAll(() => app.close());
});
```

The app here comes from `createNestApplication()`, not from `main.ts`, so repeat the global pipes, filters and prefixes in the test setup or the test exercises a different app than production. Vitest is the default runner for ESM projects and Jest for CommonJS (per the v12 migration guide); use the project's.

## Armadilhas

- Circular dependencies: avoid them; `forwardRef(() => X)` is a smell that usually means a shared concern should move to a third provider.
- Forgetting `@Injectable()` on a provider, or listing it in no module's `providers`, fails at bootstrap with an unresolved dependency.
- Request-scoped providers spread through the graph, making their consumers request-scoped too and slowing every request.
- Business logic in controllers; keep them to routing, binding and delegating.
- Leaking entities instead of DTOs, including fields such as password hashes.
- Unvalidated `@Param` and `@Query` values: they are strings until a pipe converts them.
- Injecting an interface or an `import type` class: injection needs the runtime class.

## Fonte

NestJS documentation: https://docs.nestjs.com/modules, /providers, /controllers, /pipes, /guards, /interceptors, /exception-filters, /faq/request-lifecycle, /fundamentals/injection-scopes, /fundamentals/circular-dependency, /fundamentals/testing, /techniques/validation, /techniques/configuration, /first-steps, /migration-guide.
