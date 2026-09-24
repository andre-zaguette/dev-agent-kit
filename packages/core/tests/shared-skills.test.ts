import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const kitRoot = fileURLToPath(new URL('../../../', import.meta.url));
const SHARED = [
  'engineering-architecture',
  'repository-investigation',
  'verification',
  'root-cause-analysis',
  'surgical-diff',
  'context-efficiency',
  'repo-memory'
];
// Shared skills must not assume a framework, a host, a design tool or a task-source product (spec §6.1, §27).
const FORBIDDEN =
  /\b(react|vue|nuxt|next\.js|angular|django|drf|fastapi|nestjs|express|laravel|tailwind|figma|jira|linear|trello|asana|clickup|azure devops|claude code|codex)\b/i;
const MAX_LINES = 60;

for (const name of SHARED) {
  test(`skill ${name}: valid frontmatter, neutral, compact`, () => {
    const text = readFileSync(join(kitRoot, 'skills', name, 'SKILL.md'), 'utf8');
    const front = text.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
    assert.ok(front, 'frontmatter must be exactly name + one-line description');
    assert.equal(front![1], name);
    assert.match(front![2], /^.{40,400}$/);
    assert.doesNotMatch(text, FORBIDDEN);
    assert.ok(text.split('\n').length <= MAX_LINES, `${name} has more than ${MAX_LINES} lines; move detail into references/`);
  });
}
