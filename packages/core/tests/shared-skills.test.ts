import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
  'repo-memory',
  'task-orchestrator'
];
// Shared skills must not assume a framework, a host, a design tool or a task-source product (spec §6.1, §27).
const FORBIDDEN =
  /\b(react|vue|nuxt|next\.js|angular|django|drf|fastapi|nestjs|express|laravel|tailwind|figma|jira|linear|trello|asana|clickup|azure devops|claude code|codex|spring|rails|symfony|dotnet|aspnet|asp\.net|hibernate|eloquent|activerecord|entityframework|sidekiq|doctrine|sqlserver|mssql)\b/i;
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

test('task-orchestrator ships exactly the six contract references, all with valid frontmatter', () => {
  const dir = join(kitRoot, 'skills', 'task-orchestrator', 'references');
  const names = ['work-item', 'task-source', 'source-resolution', 'generic-mcp', 'git-workflow', 'task-ledger'];
  for (const name of names) {
    const text = readFileSync(join(dir, `${name}.md`), 'utf8');
    assert.match(text, new RegExp(`^---\\nname: ${name}\\ndescription: .{20,300}\\ntype: contract\\n---\\n`), name);
  }
  assert.deepEqual(readdirSync(dir).sort(), names.map((n) => `${n}.md`).sort());
});

test('the orchestrator tells the agent which skills each classification loads', () => {
  const text = readFileSync(join(kitRoot, 'skills', 'task-orchestrator', 'references', 'task-ledger.md'), 'utf8');
  const section = text.slice(text.indexOf('## Classification'), text.indexOf('## Resume'));
  for (const skill of ['backend-architecture', 'api-design', 'data-modeling', 'database-migrations', 'backend-testing', 'auth-security', 'external-integrations', 'async-jobs', 'observability', 'backend-performance']) {
    assert.match(section, new RegExp(skill), skill);
  }
  for (const skill of ['figma-to-code', 'visual-validation', 'root-cause-analysis', 'repository-investigation']) assert.match(section, new RegExp(skill), skill);
  assert.match(section, /fullstack-contract/);
});
