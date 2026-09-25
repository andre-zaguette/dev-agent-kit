import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const kitRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const BACKEND_SKILLS = [
  'backend-architecture',
  'api-design',
  'data-modeling',
  'database-migrations',
  'backend-testing',
  'auth-security',
  'external-integrations',
  'async-jobs',
  'observability',
  'backend-performance'
];
// Backend skills must not name a framework, ORM, queue, database, test runner, design tool or task-source product (spec §16, §27).
const FORBIDDEN =
  /\b(react|vue|nuxt|next\.js|angular|django|drf|fastapi|nestjs|express|flask|laravel|tailwind|figma|jira|linear|trello|asana|clickup|azure devops|claude code|codex|celery|rabbitmq|redis|postgres|postgresql|mysql|sqlalchemy|alembic|prisma|typeorm|pytest|jest|vitest|spring|rails|symfony|dotnet|aspnet|asp\.net|hibernate|eloquent|activerecord|entityframework|sidekiq|doctrine|sqlserver|mssql)\b/i;
const MAX_LINES = 60;

for (const name of BACKEND_SKILLS) {
  test(`backend skill ${name}: valid frontmatter, neutral, compact`, () => {
    const text = readFileSync(join(kitRoot, 'skills', name, 'SKILL.md'), 'utf8');
    const front = text.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
    assert.ok(front, 'frontmatter must be exactly name + one-line description');
    assert.equal(front![1], name);
    assert.match(front![2], /^.{40,400}$/);
    assert.doesNotMatch(text, FORBIDDEN);
    assert.ok(text.split('\n').length <= MAX_LINES, `${name} has more than ${MAX_LINES} lines; move detail into references/`);
  });
}

test('backend-architecture carries the backend Definition of Done and the pre-code checklist', () => {
  const text = readFileSync(join(kitRoot, 'skills', 'backend-architecture', 'SKILL.md'), 'utf8');
  for (const item of ['existing architecture followed', 'domain invariants protected', 'authorization checked', 'idempotency considered', 'migrations reviewed', 'sensitive data is not logged', 'final diff is task-scoped']) {
    assert.match(text, new RegExp(item, 'i'), item);
  }
  for (const concern of ['transaction boundary', 'concurrent writers', 'idempotency', 'unique constraints']) assert.match(text, new RegExp(concern, 'i'), concern);
});

test('api-design carries the API workflow and its Definition of Done', () => {
  const text = readFileSync(join(kitRoot, 'skills', 'api-design', 'SKILL.md'), 'utf8');
  for (const item of ['neighboring endpoints', 'error contract', 'request validated', 'status codes correct', 'runtime request verified']) assert.match(text, new RegExp(item, 'i'), item);
});

const has = (skill: string, terms: string[]) => {
  const text = readFileSync(join(kitRoot, 'skills', skill, 'SKILL.md'), 'utf8');
  for (const term of terms) assert.match(text, new RegExp(term, 'i'), `${skill}: ${term}`);
};

test('auth-security covers the spec §22 checklist and the no-credentials rule', () => {
  has('auth-security', ['BOLA|IDOR', 'mass assignment', 'SQL injection', 'command injection', 'unsafe deserialization', 'SSRF', 'secret', 'unsafe upload', 'rate limit', 'CORS', 'CSRF', 'sensitive logging', 'ledger']);
});

test('async-jobs covers the spec §20 checklist and assumes at-least-once delivery', () => {
  has('async-jobs', ['message schema', 'ack', 'retry', 'dead-letter', 'idempotency', 'ordering', 'poison', 'at-least-once']);
});

test('external-integrations covers the spec §21 checklist and boundary normalization', () => {
  has('external-integrations', ['timeout', 'retryable', '429', '5xx', 'auth refresh', 'schema drift', 'idempotency', 'partial failure', 'normalize']);
});

test('backend-testing, observability and backend-performance state their core rules', () => {
  has('backend-testing', ['error path', 'real database', 'concurren', 'runtime']);
  has('observability', ['structured', 'correlation', 'sensitive']);
  has('backend-performance', ['measure', 'N\\+1', 'pagination', 'timeout']);
});
