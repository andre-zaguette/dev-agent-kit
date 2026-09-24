# Backend domain (v0.8)

Backend work items get the same orchestrated workflow as frontend ones, with ten neutral skills and stack knowledge loaded only when the repository uses it.

## What ships

- Ten skills: `backend-architecture` (workflow and Definition of Done), `api-design`, `data-modeling`, `database-migrations`, `backend-testing`, `auth-security`, `external-integrations`, `async-jobs`, `observability`, `backend-performance`. Each `SKILL.md` stays under 60 lines and names no framework, database or queue.
- Thirteen lazy-loaded references, each owned by one skill: under `backend-architecture` (`python`, `django`, `fastapi`, `node-typescript`, `nestjs`, `docker`), `api-design` (`drf`, `openapi`), `data-modeling` (`postgresql`), `async-jobs` (`rabbitmq`, `celery`, `redis`) and `auth-security` (`security`). Reference names are unique across the whole kit.
- `selectBackendReferences(profile)` in `packages/core`: given the project profile, it returns which references apply. A repository with no backend signal (for example a React app) gets an empty list, so nothing is forced on a project that does not use it.
- Nine backend eval scenarios (Django, DRF, PostgreSQL migration, FastAPI, root-cause bug fix, external integration, NestJS, Celery, RabbitMQ) with four small fixtures. Scenarios need no Figma and are answerable from the files alone; validate them with `npm run evals:validate`.

## How a backend work item flows

The orchestrator classifies the item as backend, loads `backend-architecture` first, then only the skills the change needs, and reads only the references that match the detected stack. The ledger records the API, data and job decisions like any other task.

## Not in v0.8

- The fullstack contract flow, the integration verifier and the CLI commands: v0.9.
- A real-host benchmark of the backend scenarios (they are validated offline only).
