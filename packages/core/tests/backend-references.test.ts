import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBackendReferences } from '../src/backend-references.ts';
import type { ProjectProfile } from '../src/project-profile.ts';

const profile = (over: Partial<ProjectProfile>): ProjectProfile => ({
  languages: [],
  frameworks: [],
  testCommands: [],
  lintCommands: [],
  typecheckCommands: [],
  docker: false,
  ...over
});
const refs = (p: ProjectProfile) => selectBackendReferences(p).map((h) => h.reference);

test('a project with no backend signal gets nothing, however much else it has', () => {
  assert.deepEqual(refs(profile({})), []);
  assert.deepEqual(refs(profile({ languages: ['typescript'], frameworks: ['react', 'tailwind'], docker: true })), []);
  assert.deepEqual(refs(profile({ languages: ['python'], database: 'postgresql', docker: true })), []);
});

test('a Django + DRF + PostgreSQL + Celery/RabbitMQ + Docker project gets its own references in a stable order', () => {
  const p = profile({
    languages: ['python'],
    frameworks: ['django', 'drf'],
    database: 'postgresql',
    queue: 'rabbitmq',
    queues: ['rabbitmq', 'celery'],
    cache: 'redis',
    docker: true
  });
  assert.deepEqual(refs(p), ['python', 'django', 'drf', 'postgresql', 'rabbitmq', 'celery', 'redis', 'docker', 'security']);
  const first = selectBackendReferences(p)[0];
  assert.deepEqual(first, { skill: 'backend-architecture', reference: 'python', reason: 'Python project' });
});

test('FastAPI and Nest projects get only what they use', () => {
  assert.deepEqual(refs(profile({ languages: ['python'], frameworks: ['fastapi'] })), ['python', 'fastapi', 'openapi', 'security']);
  assert.deepEqual(refs(profile({ languages: ['typescript'], frameworks: ['nestjs'], database: 'postgresql' })), ['node-typescript', 'nestjs', 'openapi', 'postgresql', 'security']);
  assert.deepEqual(refs(profile({ languages: ['javascript'], frameworks: ['express'] })), ['node-typescript', 'express', 'security']);
});

test('a queue alone is a backend signal, and a single legacy `queue` value still works', () => {
  assert.deepEqual(refs(profile({ languages: ['typescript'], queue: 'bullmq' })), ['security']);
  assert.deepEqual(refs(profile({ languages: ['python'], queue: 'celery' })), ['python', 'celery', 'security']);
});

test('every hint names a skill and a reason, and no reference repeats', () => {
  const hints = selectBackendReferences(profile({ languages: ['python'], frameworks: ['django', 'drf', 'fastapi'], queues: ['celery', 'rabbitmq'], queue: 'celery', docker: true }));
  for (const h of hints) assert.ok(h.skill && h.reason, JSON.stringify(h));
  assert.equal(new Set(hints.map((h) => h.reference)).size, hints.length);
});

test('DRF alone does not imply an OpenAPI description, FastAPI and Nest do, and the reason says "can generate"', () => {
  assert.equal(refs(profile({ languages: ['python'], frameworks: ['django', 'drf'] })).includes('openapi'), false);
  assert.ok(refs(profile({ languages: ['python'], frameworks: ['fastapi'] })).includes('openapi'));
  assert.ok(refs(profile({ languages: ['typescript'], frameworks: ['nestjs'] })).includes('openapi'));
  const hint = selectBackendReferences(profile({ languages: ['python'], frameworks: ['fastapi'] })).find((h) => h.reference === 'openapi')!;
  assert.match(hint.reason, /can generate/);
});

test('the new stacks get their language and framework references, and a language alone gets nothing', () => {
  assert.deepEqual(refs(profile({ languages: ['php'], frameworks: ['laravel'], database: 'mysql', docker: true })), ['php-backend', 'laravel', 'mysql', 'docker', 'security']);
  assert.deepEqual(refs(profile({ languages: ['csharp'], frameworks: ['aspnetcore'], database: 'sqlserver', queue: 'rabbitmq', queues: ['rabbitmq'] })), ['csharp', 'aspnet-core', 'openapi', 'sqlserver', 'rabbitmq', 'security']);
  assert.deepEqual(refs(profile({ languages: ['java'], frameworks: ['spring'], database: 'postgresql', cache: 'redis' })), ['java', 'spring-boot', 'postgresql', 'redis', 'security']);
  assert.deepEqual(refs(profile({ languages: ['ruby'], frameworks: ['rails'], database: 'postgresql', cache: 'redis' })), ['ruby', 'rails', 'postgresql', 'redis', 'security']);
  assert.deepEqual(refs(profile({ languages: ['python'], frameworks: ['flask'] })), ['python', 'flask', 'security']);
  assert.deepEqual(refs(profile({ languages: ['php'], frameworks: ['symfony'] })), ['php-backend', 'security']);
  for (const language of ['php', 'csharp', 'java', 'ruby']) assert.deepEqual(refs(profile({ languages: [language], database: 'postgresql', docker: true })), [], language);
  const all = selectBackendReferences(profile({ languages: ['python', 'javascript', 'php', 'csharp', 'java', 'ruby'], frameworks: ['django', 'drf', 'fastapi', 'flask', 'nestjs', 'express', 'laravel', 'symfony', 'aspnetcore', 'spring', 'rails'], database: 'mysql', docker: true }));
  assert.equal(new Set(all.map((h) => h.reference)).size, all.length);
  for (const h of all) assert.ok(h.skill && h.reason, JSON.stringify(h));
});
