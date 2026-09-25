# Backend domain (v0.8)

Backend work items get the same orchestrated workflow as frontend ones, with ten neutral skills and stack knowledge loaded only when the repository uses it.

## What ships

- Ten skills: `backend-architecture` (workflow and Definition of Done), `api-design`, `data-modeling`, `database-migrations`, `backend-testing`, `auth-security`, `external-integrations`, `async-jobs`, `observability`, `backend-performance`. Each `SKILL.md` stays under 60 lines and names no framework, database or queue.
- Twenty-five lazy-loaded references (v0.10 added twelve for more stacks), each owned by one skill; the original thirteen are: under `backend-architecture` (`python`, `django`, `fastapi`, `node-typescript`, `nestjs`, `docker`), `api-design` (`drf`, `openapi`), `data-modeling` (`postgresql`), `async-jobs` (`rabbitmq`, `celery`, `redis`) and `auth-security` (`security`). Reference names are unique across the whole kit.
- `selectBackendReferences(profile)` in `packages/core`: given the project profile, it returns which references apply. A repository with no backend signal (for example a React app) gets an empty list, so nothing is forced on a project that does not use it.
- Fifteen backend eval scenarios (nine feature scenarios and six per-stack scenarios) with ten small fixtures. Scenarios need no Figma and are answerable from the files alone; validate them offline with `npm run evals:validate`.

## How a backend work item flows

The orchestrator classifies the item as backend, loads `backend-architecture` first, then only the skills the change needs, and reads only the references that match the detected stack. The ledger records the API, data and job decisions like any other task.

## Not in v0.8

- The fullstack contract flow, the integration verifier and the CLI commands: v0.9.
- A real-host benchmark of the backend scenarios (they are validated offline only).

## Stacks (v0.10)

The backend domain covers the languages the project owner works in. Detection reads only manifests in the repository; a language alone is **not** a backend signal (a Java or Ruby library gets nothing), a recognized framework or a message queue is.

| Language | Framework | References loaded | Detected from |
|---|---|---|---|
| Python | Django, DRF, FastAPI, Flask | `python`, `django`, `drf`, `fastapi`, `flask` | `requirements.txt` / `pyproject.toml`, `manage.py` |
| Node.js | NestJS, Express | `node-typescript`, `nestjs`, `express` | `package.json` dependencies |
| PHP | Laravel (Symfony detected) | `php-backend`, `laravel` | `composer.json` (`laravel/framework`, `symfony/framework-bundle`) |
| C# | ASP.NET Core | `csharp`, `aspnet-core` | `*.sln` / `*.csproj` (`Microsoft.NET.Sdk.Web`, `Microsoft.AspNetCore`) |
| Java | Spring Boot | `java`, `spring-boot` | `pom.xml` / `build.gradle(.kts)` (`spring-boot`) |
| Ruby | Rails | `ruby`, `rails` | `Gemfile` (`gem 'rails'`) |

Databases: `postgresql`, `mysql`, `sqlserver` (from ORM and driver packages, `.env.example` `DB_CONNECTION`, or a Compose image). Queues: `rabbitmq`, `celery`, `bullmq`. Cache: `redis`. The profile also reports test, lint and typecheck commands for each ecosystem (`composer test`, `dotnet test`, `mvn test` / `./gradlew test`, `bundle exec rspec`, and so on).

Limits: detection is plain manifest text, so a framework name inside a comment can match; Symfony has no dedicated reference yet; there are no per-language queue references (Sidekiq, Hangfire, Horizon, Spring AMQP) — the generic `async-jobs` skill and the RabbitMQ and Redis references cover the concepts.

Each stack has a backend eval scenario (`backend-stack-<name>`) and a small fixture; all are validated offline with `npm run evals:validate`.
