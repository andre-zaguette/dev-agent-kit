---
name: nestjs
description: Baseline conventions for NestJS services: modules, controllers, providers, DTO validation, guards and testing.
status: baseline
---

## Princípio

Follow Nest's structure: a module per feature, thin controllers, providers for logic and data access, DTOs validated by pipes, and guards for authentication and authorization.

## Quando aplicar

Projects depending on `@nestjs/core`.

## Quando não aplicar

Plain Express or other Node frameworks. Load `node-typescript.md` as well for general Node conventions.

## Exemplo

```ts
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post(':id/deactivate')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeactivateUserDto) {
    return this.users.deactivate(id, dto);
  }
}

export class DeactivateUserDto {
  @IsString() @MaxLength(200) reason!: string;
}
```

Register providers in the feature module, validate DTOs with a global `ValidationPipe` (`whitelist: true`), map domain errors to exceptions in a filter, and test controllers with `Test.createTestingModule` plus the project's runner. Nest publishes an OpenAPI description through its Swagger module when the project uses it.

## Fonte

NestJS documentation (modules, pipes, guards, testing); refined per project conventions.
