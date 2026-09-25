import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { selectBackendReferences } from '../src/backend-references.ts';
import type { ProjectProfile } from '../src/project-profile.ts';

const kitRoot = fileURLToPath(new URL('../../../', import.meta.url));
const skillsDir = join(kitRoot, 'skills');
const BACKEND = ['backend-architecture', 'api-design', 'data-modeling', 'database-migrations', 'backend-testing', 'auth-security', 'external-integrations', 'async-jobs', 'observability', 'backend-performance'];
const EXPECTED = ['python', 'django', 'drf', 'fastapi', 'node-typescript', 'nestjs', 'postgresql', 'redis', 'rabbitmq', 'celery', 'docker', 'openapi', 'security', 'flask', 'express', 'php-backend', 'laravel', 'csharp', 'aspnet-core', 'java', 'spring-boot', 'ruby', 'rails', 'mysql', 'sqlserver'];

const referencesOf = (skill: string): string[] => {
  const dir = join(skillsDir, skill, 'references');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')) : [];
};

test('the twenty-five backend references exist under the skills that own them', () => {
  const found = BACKEND.flatMap((skill) => referencesOf(skill));
  assert.deepEqual([...found].sort(), [...EXPECTED].sort());
});

test('reference names are unique across the whole kit, so a read identifies exactly one file', () => {
  const all = readdirSync(skillsDir).flatMap((skill) => referencesOf(skill));
  assert.equal(new Set(all).size, all.length, `duplicate reference names: ${all.filter((n, i) => all.indexOf(n) !== i).join(', ')}`);
});

test('every reference frontmatter name matches its file name and is marked baseline', () => {
  for (const skill of BACKEND) {
    for (const name of referencesOf(skill)) {
      const text = readFileSync(join(skillsDir, skill, 'references', `${name}.md`), 'utf8');
      assert.match(text, new RegExp(`^---\\nname: ${name}\\ndescription: .{20,300}\\nstatus: baseline\\n---\\n`), `${skill}/${name}`);
    }
  }
});

const everything: ProjectProfile = {
  languages: ['python', 'typescript', 'php', 'csharp', 'java', 'ruby'],
  frameworks: ['django', 'drf', 'fastapi', 'flask', 'nestjs', 'express', 'laravel', 'symfony', 'aspnetcore', 'spring', 'rails'],
  database: 'postgresql',
  queue: 'rabbitmq',
  queues: ['rabbitmq', 'celery', 'bullmq'],
  cache: 'redis',
  docker: true,
  testCommands: [],
  lintCommands: [],
  typecheckCommands: []
};

test('every hint the selector can produce points at a real file, and every reference is reachable', () => {
  const hints = [...selectBackendReferences(everything), ...selectBackendReferences({ ...everything, database: 'mysql' }), ...selectBackendReferences({ ...everything, database: 'sqlserver' })];
  for (const hint of hints) assert.ok(existsSync(join(skillsDir, hint.skill, 'references', `${hint.reference}.md`)), `${hint.skill}/${hint.reference}`);
  assert.deepEqual([...new Set(hints.map((h) => h.reference))].sort(), [...EXPECTED].sort());
});

const refText = (skill: string, name: string) => readFileSync(join(skillsDir, skill, 'references', `${name}.md`), 'utf8');

test('the RabbitMQ example validates inside the try, counts attempts and keeps the redelivery promise honest', () => {
  const text = refText('async-jobs', 'rabbitmq');
  assert.match(text, /try:\s*\n\s*message = /, 'message parsing must happen inside the try so a malformed body is rejected, not fatal');
  assert.match(text, /x-death/);
  assert.match(text, /MAX_ATTEMPTS/);
});

test('the Celery reference does not claim a check-then-act is idempotent and mentions worker loss', () => {
  const text = refText('async-jobs', 'celery');
  assert.match(text, /task_reject_on_worker_lost/);
  assert.match(text, /conditional update|claim/i);
  assert.doesNotMatch(text, /idempotent: a duplicate delivery is a no-op/);
});

test('the references carry the operational details reviewers asked for', () => {
  assert.match(refText('data-modeling', 'postgresql'), /indisvalid/);
  assert.match(refText('data-modeling', 'postgresql'), /INVALID/);
  const django = refText('backend-architecture', 'django');
  assert.match(django, /AddIndexConcurrently/);
  assert.match(django, /atomic = False/);
  const security = refText('auth-security', 'security');
  assert.match(security, /link-local/);
  assert.match(security, /redirect/i);
  assert.match(security, /allowlist/i);
  assert.match(refText('backend-architecture', 'docker'), /127\.0\.0\.1:5432:5432/);
});
