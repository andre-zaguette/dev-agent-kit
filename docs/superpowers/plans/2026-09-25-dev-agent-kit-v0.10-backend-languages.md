# Dev Agent Kit v0.10 — Backend Languages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline, native). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the backend domain the same per-stack coverage the frontend has, for the languages the user works in: Python (add Flask), Node.js (add Express), PHP (Laravel), C# (ASP.NET Core), Java (Spring Boot) and Ruby (Rails). Each stack gets deterministic detection in the project profile, a reference, a selector rule and an eval scenario with a small fixture. No new skills.

**Architecture:** Same shape as v0.8. Stack knowledge lives in lazy-loaded `references/*.md` files owned by existing skills; `detectProjectProfile` learns the new ecosystems (PHP, C#, Java, Ruby) and frameworks; `selectBackendReferences` maps profile → references and still returns `[]` for a project with no backend signal; eval scenarios reuse the `backend` category with `backend-stack-<name>` ids.

**Tech Stack:** TypeScript (ES2022, NodeNext), `node --test` via `tsx`, Markdown references, JSON scenarios, tiny non-installed fixture apps.

**Spec:** `docs/superpowers/specs/2026-09-24-dev-agent-kit-evolution.md` — §16 (initial stack focus, "detect the repository first, never force"), §26 (project inspector), §28 (evals), §43 (compatibility). §16 lists Python, Node/TypeScript, PostgreSQL, Redis, RabbitMQ, Docker; this release extends the stack list at the user's request (PHP, C#, Java, Ruby), which the spec's "initial supported stack focus" wording allows.

## Global Constraints

- Compatibility (§43): `frontend-agent`, the frontend skills, the v0.6–v0.9.1 skills, MCP tool names and all 30 existing eval scenarios stay untouched and green. Existing detection results for existing stacks do not change.
- Never force a technology: a project with no backend signal still gets `[]`; a PHP/C#/Java/Ruby project with no recognized framework and no queue gets nothing (a language alone is not a backend signal, as Python is not today).
- Backend `SKILL.md` files stay neutral and ≤ 60 lines: the forbidden-word test grows to include the new frameworks (`spring`, `rails`, `symfony`, `dotnet`, `aspnet`, `hibernate`, `eloquent`, `activerecord`, `entityframework`, `sidekiq`, `doctrine`) and every existing skill must still pass it.
- Reference names stay unique across the kit (the harness identifies a read by file name). New names: `flask`, `express`, `laravel`, `php-backend` (the frontend already owns `php`), `aspnet-core`, `csharp`, `spring-boot`, `java`, `rails`, `ruby`, `mysql`, `sqlserver`. Each reference uses the baseline format: frontmatter `name`, `description`, `status: baseline`, then `## Princípio`, `## Quando aplicar`, `## Quando não aplicar`, `## Exemplo`, `## Fonte`.
- Detection reads only files in the project (no network, no running tools). Every new regular expression over file contents is applied to size-capped text (the profile reader already caps file reads; new readers must too) and cannot backtrack.
- Fixtures contain no installed dependencies, no build output, no `__pycache__`/`bin`/`obj`/`target`/`vendor`/`node_modules`/`.venv`, and no symlinks.
- Commits: append the attribution trailer the session configures. Never `git reset --hard`, never force-push. The real benchmark is run by the user.

## Review Focus

1. Detection false positives: `flask` inside `flask-cors` only, `spring` in a comment or an unrelated dependency name, `rails` in `railties`-adjacent gems, `.csproj` for a class library or a console app (no `Microsoft.NET.Sdk.Web`, no AspNetCore package) → no framework, a Gradle build for a non-Spring project.
2. A repository with several ecosystems (Python + Node + Java): all signals kept, no crash, deterministic order.
3. Huge or hostile manifests (5 MB `pom.xml`, deeply nested `.csproj` discovery): bounded reading, no recursion explosions.
4. The scenarios: each fails on the untouched fixture, passes for a plausible correct solution, and does not forbid something a correct solution legitimately does.
5. The references teach correct, current practice (ORM/N+1, migrations, auth, validation, config secrets, testing) and their code examples compile/read as valid for that language.

---

### Task 1: Project profile — PHP, C#, Java, Ruby, Flask

**Files:**
- Modify: `packages/core/src/project-profile.ts`
- Test: `packages/core/tests/project-profile.test.ts` (append)

**Interfaces (additive to `ProjectProfile`):** none new; existing fields gain values:
- `languages`: `'php'` (already), `'csharp'`, `'java'`, `'ruby'`.
- `frameworks`: `'flask'`, `'laravel'`, `'symfony'`, `'aspnetcore'`, `'spring'`, `'rails'` (plus the existing ones).
- `packageManager`: `'composer'`, `'dotnet'`, `'maven'`, `'gradle'`, `'bundler'` when no Node/Python manager applies.
- `database`: `'postgresql' | 'mysql' | 'sqlserver'` from the new evidence below; `migrationTool`: `'laravel' | 'efcore' | 'flyway' | 'liquibase' | 'rails'`.
- `queues` / `cache`: RabbitMQ and Redis clients for the new ecosystems.

**Detection rules (all on size-capped text, lower-cased where noted):**
- Python: `mentions(pyText, 'flask')` → `flask` (`flask-cors` alone does not match because of the existing whole-name rule).
- PHP: `composer.json` present → language `php`, package manager `composer`. Require/require-dev names: `laravel/framework` → `laravel`; `symfony/framework-bundle` or `symfony/symfony` → `symfony`. Scripts `test`/`lint`/`analyse` become commands (`composer test`, `composer lint`, `composer analyse` → typecheck); otherwise `vendor/bin/phpunit` when `phpunit/phpunit` is required, `vendor/bin/pint --test` when `laravel/pint`, `vendor/bin/phpstan analyse` when `phpstan/phpstan`. Migration tool `laravel` when `laravel` framework. Database from `.env.example` or `.env`: `DB_CONNECTION=pgsql|mysql|mariadb|sqlsrv` → `postgresql|mysql|mysql|sqlserver`; queue `rabbitmq` when `php-amqplib/php-amqplib`; cache `redis` when `predis/predis` or `ext-redis`.
- C#: a `*.sln` or `*.csproj` in the project root or one directory level below (bounded: at most 50 entries scanned) → language `csharp`, package manager `dotnet`, `testCommands: ['dotnet test']`, `typecheckCommands: ['dotnet build']`. A `.csproj` whose text contains `Microsoft.NET.Sdk.Web` or a `PackageReference` to `Microsoft.AspNetCore` → `aspnetcore`. Database from package names: `Npgsql` → postgresql, `Pomelo.EntityFrameworkCore.MySql` or `MySql.Data` → mysql, `Microsoft.EntityFrameworkCore.SqlServer` or `System.Data.SqlClient` → sqlserver. `Microsoft.EntityFrameworkCore` → migration tool `efcore`. `RabbitMQ.Client` → queue `rabbitmq`; `StackExchange.Redis` or `Microsoft.Extensions.Caching.StackExchangeRedis` → cache `redis`.
- Java: `pom.xml` → language `java`, package manager `maven`, `mvn test`; `build.gradle` or `build.gradle.kts` → package manager `gradle`, `./gradlew test` when `gradlew` exists else `gradle test`. Text containing `spring-boot` → `spring`. Database: `org.postgresql` or `postgresql` dependency → postgresql, `mysql-connector` or `mariadb-java-client` → mysql, `mssql-jdbc` → sqlserver. `flyway` → migration tool `flyway`, `liquibase` → `liquibase`. `spring-boot-starter-amqp` → queue `rabbitmq`; `spring-boot-starter-data-redis` or `jedis` or `lettuce` → cache `redis`.
- Ruby: `Gemfile` → language `ruby`, package manager `bundler`. A `gem 'rails'` (either quote style) → `rails`, migration tool `rails`. Tests: `rspec-rails` or `rspec` → `bundle exec rspec`, else `bin/rails test` when `rails`; lint: `rubocop` → `bundle exec rubocop`. Database: `gem 'pg'` → postgresql, `gem 'mysql2'` → mysql. `bunny` → queue `rabbitmq`; `gem 'redis'` or `sidekiq` → cache `redis`.
- Existing behavior is unchanged for the existing ecosystems; a Docker Compose database image still wins over nothing but never overrides a more specific finding above (keep the current precedence order and append the new evidence sources after the existing ones).

- [ ] **Step 1: Write the failing tests.** Build each case with the file's `project({...})` helper. Cases (expected profile fields as `deepEqual`/`equal` assertions):
  - Laravel: `composer.json` with `require: { 'laravel/framework': '^11' }`, `require-dev: { 'phpunit/phpunit': '^11', 'laravel/pint': '^1' }`, `.env.example` with `DB_CONNECTION=mysql` → languages `['php']`, frameworks `['laravel']`, packageManager `composer`, test `vendor/bin/phpunit`, lint `vendor/bin/pint --test`, database `mysql`, migrationTool `laravel`. With a `scripts: { test: '...' }` entry the command is `composer test`.
  - Symfony: `symfony/framework-bundle` → `['symfony']`, no migration tool.
  - Plain PHP library (`composer.json` with only `monolog/monolog`) → languages `['php']`, frameworks `[]`.
  - ASP.NET Core: `Api/Api.csproj` with `<Project Sdk="Microsoft.NET.Sdk.Web">` and `Npgsql.EntityFrameworkCore.PostgreSQL` + `Microsoft.EntityFrameworkCore` → language `csharp`, framework `aspnetcore`, database `postgresql`, migrationTool `efcore`, test `dotnet test`, typecheck `dotnet build`. A console `.csproj` (`Microsoft.NET.Sdk`) → language `csharp`, frameworks `[]`. A `.sln` at the root alone → language `csharp`.
  - Spring Boot with Maven: `pom.xml` containing `spring-boot-starter-web`, `org.postgresql`, `flyway-core`, `spring-boot-starter-amqp` → language `java`, packageManager `maven`, framework `spring`, database `postgresql`, migrationTool `flyway`, queues `['rabbitmq']`, test `mvn test`. Gradle: `build.gradle.kts` + `gradlew` → packageManager `gradle`, test `./gradlew test`; without `gradlew` → `gradle test`. A Gradle project with no `spring-boot` → frameworks `[]`. Text with `spring` only in a comment (`// not spring-boot-related`) is a documented limitation: assert the exact chosen behavior (substring `spring-boot` matches).
  - Rails: `Gemfile` with `gem 'rails'`, `gem "pg"`, `gem 'rspec-rails'`, `gem 'rubocop'`, `gem 'sidekiq'` → language `ruby`, framework `rails`, database `postgresql`, migrationTool `rails`, test `bundle exec rspec`, lint `bundle exec rubocop`, cache `redis`. `Gemfile` without rails → frameworks `[]`.
  - Flask: `requirements.txt` with `flask==3` → frameworks `['flask']`; only `flask-cors` → `[]`.
  - Multi-ecosystem: a repo with `package.json` (express), `pom.xml` (spring-boot) and `pyproject.toml` (fastapi) keeps all three frameworks in the order Node, Python, then the new ecosystems, and languages in a stable order.
  - Bounds: a 5 MB `pom.xml` (repeated `<x/>` lines) is read within the existing cap and returns quickly; more than 50 entries in a directory do not make the C# scan slow (assert time < 500 ms).
  - Regression: every pre-existing profile test still passes unchanged.
- [ ] **Step 2: Run to verify failure** (`node --import tsx --test packages/core/tests/project-profile.test.ts`).
- [ ] **Step 3: Implement** in `project-profile.ts` following the rules above, reading each manifest through the existing `read(root, rel)` helper (which already caps size — confirm and, if it does not, add a 1 MB cap) and testing content with plain `includes`/anchored regexes on the capped text. C# discovery: `readdirSync` of the root and of each immediate subdirectory (skip `node_modules`, `.git`, `bin`, `obj`, dot-directories), stop after 50 entries.
- [ ] **Step 4: Run** the core suite and typecheck: `npm test --workspace=packages/core`, `npm run typecheck --workspace=packages/core`.
- [ ] **Step 5: Commit** — `git commit -m "core: detect PHP, C#, Java, Ruby and Flask projects"`.

---

### Task 2: Selector rules, coverage tests and neutral-skill guard

**Files:**
- Modify: `packages/core/src/backend-references.ts`, `packages/core/tests/backend-references.test.ts`, `packages/core/tests/backend-references-coverage.test.ts`, `packages/core/tests/backend-skills.test.ts`, `packages/core/tests/fullstack-skill.test.ts`
- (The reference files themselves arrive in Tasks 3–5; the coverage test is written now and stays red until then.)

**Selector rules (append after the existing rules, keeping the current order for existing stacks):**
- `BACKEND_FRAMEWORKS` adds `flask`, `laravel`, `symfony`, `aspnetcore`, `spring`, `rails`.
- Language-level references, added only when the language is present **and** a backend signal exists (like Python today): `php` → `php-backend`, `csharp` → `csharp`, `java` → `java`, `ruby` → `ruby` (all owned by `backend-architecture`).
- Framework references (owner `backend-architecture`): `flask` → `flask`, `express` → `express`, `laravel` → `laravel`, `aspnetcore` → `aspnet-core`, `spring` → `spring-boot`, `rails` → `rails`. `express` already counts as a backend signal and already yields `node-typescript`; it now also yields `express`. `symfony` yields only `php-backend` (no dedicated reference in this release).
- `openapi` also for `aspnetcore`.
- Databases (owner `data-modeling`): `postgresql` (exists), `mysql` → `mysql`, `sqlserver` → `sqlserver`.
- Order in the output: Python group, then Node group, then PHP, C#, Java, Ruby groups (language ref before its framework ref), then `openapi`, database, queues, cache, docker, `security` last (as today; existing expected orders for existing stacks do not change).

**Tests (write first, RED):**
- Selector: Laravel+MySQL+Docker profile → `['php-backend','laravel','mysql','docker','security']`; ASP.NET Core+SQL Server+RabbitMQ → `['csharp','aspnet-core','openapi','sqlserver','rabbitmq','security']`; Spring+PostgreSQL+Redis → `['java','spring-boot','postgresql','redis','security']`; Rails+PostgreSQL+Redis → `['ruby','rails','postgresql','redis','security']`; Flask → `['python','flask','security']`; Express → `['node-typescript','express','security']`; `java` language alone, `csharp` alone, `php` alone, `ruby` alone → `[]`; Symfony → `['php-backend','security']`; a profile with every framework yields the union without duplicates and every hint has a skill and a reason.
- Coverage: `EXPECTED` becomes the 25 names (the 13 existing plus the 12 new) and `BACKEND` owners unchanged; add `mysql` and `sqlserver` under `data-modeling`; the "every reference reachable" test's `everything` profile gains `flask, laravel, symfony, aspnetcore, spring, rails` and databases can only hold one value, so add a second profile for `mysql`/`sqlserver` and union the two results.
- Neutral-skill guard: extend the `FORBIDDEN` regex in `backend-skills.test.ts` and `fullstack-skill.test.ts` (and `shared-skills.test.ts` if it has its own) with `spring|rails|symfony|dotnet|aspnet|asp\.net|hibernate|eloquent|activerecord|entityframework|sidekiq|doctrine|mysql|sqlserver|mssql`; run the suite and confirm no existing skill trips it (reword a sentence if one does).
- [ ] **Steps 2–4:** run, implement the selector, run. The reference-existence checks fail until Tasks 3–5 add the files; mark that in the ledger and continue.
- [ ] **Step 5: Commit** — `git commit -m "core: backend reference selection for the new stacks"`.

---

### Task 3: References — Flask, Express, PHP, Laravel

**Files:** `skills/backend-architecture/references/{flask,express,php-backend,laravel}.md`

Each file: baseline format, English content, PT headings, one realistic code example, and content points below. `npm run validate:skills` is the structural test; the coverage test from Task 2 goes green for these four.

- **`flask`:** app factory + blueprints, config from environment, request validation (a schema library the project already uses, else explicit checks), error handlers returning one JSON error shape, SQLAlchemy session per request with commit/rollback in one place, testing with `app.test_client()`; when not to apply (FastAPI/Django projects); example: a blueprint route with validation and a 409.
- **`express`:** router modules, async error handling (a wrapper or Express 5), centralized error middleware with one error shape, input validation middleware, `helmet`/CORS only if already present, no business logic in handlers, graceful shutdown, testing with the project's runner and `supertest`; example: `POST /users` with validation, transaction and error middleware.
- **`php-backend`:** modern PHP (8.x): strict types, typed properties, enums, readonly, Composer autoloading (PSR-4), PSR-12 style via the project's formatter, static analysis if configured (PHPStan/Psalm), Composer scripts as the command source of truth, never `eval`/dynamic includes from input; when not to apply (frontend PHP templating-only tasks); example: a small typed service with constructor injection.
- **`laravel`:** routes → controllers (thin) → form requests (validation) → services/actions → Eloquent models; policies/gates for authorization; API resources for responses; `DB::transaction`; eager loading (`with`) against N+1; migrations (`php artisan make:migration`, never edit shipped ones, `->nullable()` for adds on big tables, `Schema::table`); queues (`ShouldQueue`, idempotent jobs, `$tries`/`backoff`); config via `env()` only in config files; tests (Pest/PHPUnit, `RefreshDatabase`, `actingAs`); mass assignment (`$fillable`); example: controller + form request + policy check + resource.

- [ ] **Steps:** write the four files, run `npm run validate:skills` and the core coverage test, commit — `git commit -m "skills: Flask, Express, PHP and Laravel references"`.

---

### Task 4: References — C#, ASP.NET Core, Java, Spring Boot, Ruby, Rails

**Files:** `skills/backend-architecture/references/{csharp,aspnet-core,java,spring-boot,ruby,rails}.md`

- **`csharp`:** nullable reference types on, `async`/`await` end to end with `CancellationToken`, records for DTOs, dependency injection by interface, `IOptions<T>` configuration, structured logging with `ILogger`, `dotnet test`/`dotnet build` as the command source, analyzers/`dotnet format` if configured; example: a typed service with injected repository and cancellation.
- **`aspnet-core`:** minimal APIs or controllers (follow the project), model validation (`[ApiController]`, data annotations or FluentValidation if present), `ProblemDetails` for errors, authorization policies (`[Authorize(Policy=...)]`) and resource-based checks, EF Core (`AsNoTracking` for reads, `Include` vs N+1, transactions, migrations `dotnet ef migrations add`, never edit applied ones), options pattern, health checks, testing with `WebApplicationFactory`; example: an endpoint with validation, policy and `ProblemDetails`.
- **`java`:** modern Java (17+): records, `Optional` at boundaries only, immutability, checked-exception policy per project, dependency injection by constructor, Maven/Gradle wrapper as the command source, JUnit 5 + AssertJ/Mockito if present; example: a record DTO and a service with constructor injection.
- **`spring-boot`:** layered controllers → services → repositories, constructor injection, `@Valid` request DTOs with Bean Validation, `@ControllerAdvice` with `ProblemDetail`, method security (`@PreAuthorize`), Spring Data JPA (`@EntityGraph`/`join fetch` vs N+1, `@Transactional` boundaries on services, DTO projections), Flyway/Liquibase migrations (never edit applied ones), configuration properties (`@ConfigurationProperties`) with secrets from the environment, testing with `@WebMvcTest`/`@DataJpaTest`/Testcontainers if present; example: controller + DTO + service with `@Transactional` and error advice.
- **`ruby`:** Ruby 3.x idioms, `frozen_string_literal`, keyword arguments, Bundler as the command source (`bundle exec`), RuboCop if configured, RSpec/Minitest per project; example: a small service object (`.call`) with keyword args.
- **`rails`:** conventions over configuration, thin controllers, strong parameters, service objects/concerns only where the project uses them, ActiveRecord (`includes` vs N+1, scopes, validations plus DB constraints, `transaction`, `find_by!` with scoping to the current user), migrations (`bin/rails g migration`, reversible, `disable_ddl_transaction!` + `algorithm: :concurrently` for large indexes on PostgreSQL, strong_migrations if present), background jobs (Active Job/Sidekiq, idempotent, retries), credentials/secrets not in the repo, request specs; example: controller with strong params, scoped lookup and a migration adding an index concurrently.

- [ ] **Steps:** write the six files, validate, run coverage, commit — `git commit -m "skills: C#, ASP.NET Core, Java, Spring Boot, Ruby and Rails references"`.

---

### Task 5: References — MySQL and SQL Server

**Files:** `skills/data-modeling/references/{mysql,sqlserver}.md`

- **`mysql`:** InnoDB, `utf8mb4`, `datetime` vs `timestamp`, `DECIMAL` for money, unique/foreign keys, index key length and column order, `EXPLAIN`/`EXPLAIN ANALYZE`, online DDL (`ALGORITHM=INPLACE, LOCK=NONE`) and its limits, avoid `SELECT *`, pagination without large `OFFSET`, transaction isolation default (`REPEATABLE READ`) and `SELECT ... FOR UPDATE`; example: adding an index with online DDL and an `EXPLAIN`.
- **`sqlserver`:** `datetime2`, `nvarchar` vs `varchar`, `decimal` for money, clustered vs non-clustered indexes, included columns, `SET STATISTICS`/execution plans, online index creation (`WITH (ONLINE = ON)` where the edition supports it), `READ_COMMITTED_SNAPSHOT`, `SCOPE_IDENTITY()`/`OUTPUT`, schema migrations via the project's tool; example: creating an online index and reading the plan.

- [ ] **Steps:** write, validate, run the full coverage test (now green for all 25 references), commit — `git commit -m "skills: MySQL and SQL Server references"`.

---

### Task 6: Eval fixtures and six stack scenarios

**Files:**
- Create fixtures: `evals/fixtures/{flask-app,express-app,laravel-app,aspnet-app,spring-app,rails-app}/**`
- Create scenarios: `evals/scenarios/backend-stack-{flask,express,laravel,aspnet-core,spring-boot,rails}.json` (category `backend`, no `figma`)
- Modify: `packages/evals/tests/catalog.test.ts`

Each fixture is a **tiny app in that stack with one existing feature the scenario must follow**: a `notes` resource owned by a user with a list endpoint, one model/entity, one validation/DTO, one authorization check pattern, one test, the manifest (`requirements.txt`/`package.json`/`composer.json`/`.csproj`/`pom.xml`/`Gemfile`) and a migration where the stack has them. No installed dependencies, no build output.

Every scenario prompt (Portuguese) asks for the same behavior in that stack — *add an endpoint that archives a note owned by the caller: idempotent, 404 for another user's note, validation of the input, and a migration or schema change for the new `archived_at` column* — says nothing has to be installed or run (`Não é preciso rodar o app nem instalar dependências.`), and ends with a short summary request. `expected`: the stack's reference read (`reference/<name>`), `skill/api-design`, the stack's route/handler definition for the new endpoint, the owner-scoped lookup pattern, the migration/schema file matching `archived_at`; `forbidden`: the unscoped lookup pattern for that stack and (where the stack has migrations) editing the initial migration.

- [ ] **Step 1: Tests (RED).** In `catalog.test.ts`: the backend id list becomes the 9 existing plus the 6 `backend-stack-*`; the "every backend scenario fails on the untouched fixture" loop already covers new ones; add per stack a "plausible correct solution passes, the unscoped variant fails" test using `gradeWith` and inline solution files; the "no dependency directories" test iterates the new fixtures and also forbids `bin`, `obj`, `target`, `build`, `.gradle`, `.bundle`, `tmp`, `log` directories.
- [ ] **Steps 2–4:** create fixtures and scenarios, run `npm test --workspace=packages/evals` and `npm run evals:validate` (36 scenarios).
- [ ] **Step 5: Commit** — `git commit -m "evals: six backend stack fixtures and scenarios"`.

---

### Task 7: Docs and v0.10.0 release

**Files:** `docs/backend.md` (stack matrix: language → framework → reference → detection evidence; the note that a language alone is not a backend signal), `README.md` (v0.10 section; update reference and scenario counts), `evals/README.md` (one line), version `0.9.1` → `0.10.0` (`packages/{cli,core,evals}/package.json`, lockfile, the two version assertions in `packages/cli/tests/`).

- [ ] **Step 1:** update the docs. **Step 2:** bump the version and `npm install --package-lock-only`.
- [ ] **Step 3: Run everything** — `npm test`, `npm run typecheck --workspaces --if-present`, `npm run validate:skills`, `npm run evals:validate` (36 scenarios). All green.
- [ ] **Step 4: Commit** — `git commit -m "chore: release v0.10.0 — backend languages"`.

---

## Self-review

**Coverage of the request:** Python (Flask added to Django/DRF/FastAPI), Node.js (Express added to NestJS), PHP (Laravel; Symfony detected), C# (ASP.NET Core), Java (Spring Boot), Ruby (Rails) → detection (Task 1), selection (Task 2), references (Tasks 3–5), evals (Task 6). MySQL and SQL Server references are included because they are the databases those ecosystems most often use; PostgreSQL already exists.

**Deliberately not in this release:** dedicated Symfony, Django-adjacent (Flask-SQLAlchemy specifics), Kotlin/Micronaut/Quarkus, Go, Rust references; per-language queue references (Sidekiq, Hangfire, Laravel Horizon, Spring AMQP): the generic `async-jobs` skill and the RabbitMQ/Redis references cover the concepts; a real-host benchmark (the user runs it).

**Decisions recorded (confirm or overrule):**
1. Language-level references are added for PHP, C#, Java and Ruby (as `python` is for Python), and a language alone is not a backend signal.
2. The PHP language reference is named `php-backend` because the frontend already owns a reference named `php`, and reference names must be unique kit-wide.
3. Scenarios reuse the `backend` category with `backend-stack-<name>` ids rather than a new category, because the existing `stack` category is tied to the frontend `figma-to-code` references by a test.
4. Detection uses plain manifest text (no parsers for XML/TOML/Gemfile), so a framework name in a comment can match; this is documented and tested rather than hidden.

**Placeholder scan:** reference contents are specified as required points plus a mandated example, and tests as concrete inputs and expected values; the executor writes the prose and the test bodies and must watch each test fail first.

**Type consistency:** `ProjectProfile` gains no fields; `selectBackendReferences` only gains branches; the reference names in Tasks 2–5 match the `EXPECTED` list of 25 (13 existing + 12 new).
