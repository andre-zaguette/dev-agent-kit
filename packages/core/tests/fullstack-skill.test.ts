import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const kitRoot = fileURLToPath(new URL('../../../', import.meta.url));
const skill = readFileSync(join(kitRoot, 'skills', 'fullstack-contract', 'SKILL.md'), 'utf8');
// Neutral: no framework, ORM, queue, database, test runner, design tool or task-source product (spec §16, §27).
const FORBIDDEN =
  /\b(react|vue|nuxt|next\.js|angular|django|drf|fastapi|nestjs|express|flask|laravel|tailwind|figma|jira|linear|trello|asana|clickup|azure devops|claude code|codex|celery|rabbitmq|redis|postgres|postgresql|mysql|sqlalchemy|alembic|prisma|typeorm|pytest|jest|vitest)\b/i;

test('the skill has exact frontmatter, is neutral and compact', () => {
  const front = skill.match(/^---\nname: fullstack-contract\ndescription: (.+)\n---\n/);
  assert.ok(front, 'frontmatter must be exactly name + one-line description');
  assert.match(front![1], /^.{40,400}$/);
  assert.doesNotMatch(skill, FORBIDDEN);
  assert.ok(skill.split('\n').length <= 60, `${skill.split('\n').length} lines`);
});

test('the skill persists the contract before implementation and names the verifiers', () => {
  for (const term of ['\\.dev-agent/tasks/<KEY>\\.contract\\.json', 'before', 'dev-agent contract verify', 'dev-agent contract usage', 'same contract', 'references/contract-format\\.md']) {
    assert.match(skill, new RegExp(term), term);
  }
});

test('the skill carries the fullstack Definition of Done (spec §35)', () => {
  for (const item of ['explicit API contract persisted', 'frontend and backend use the same contract', 'backend tests pass', 'frontend tests pass', 'integration path verified', 'visual validation passes when applicable', 'task ledger documents both domains']) {
    assert.match(skill, new RegExp(item, 'i'), item);
  }
});

test('the contract-format reference documents the grammar the parser accepts', () => {
  const ref = readFileSync(join(kitRoot, 'skills', 'fullstack-contract', 'references', 'contract-format.md'), 'utf8');
  assert.match(ref, /^---\nname: contract-format\ndescription: .{20,300}\ntype: contract\n---\n/);
  for (const term of ['method', 'path', 'request', 'response', 'errors', 'successStatus', 'uuid', 'email', 'datetime', '\\[\\]', 'UPPER_SNAKE_CASE']) assert.match(ref, new RegExp(term), term);
});
