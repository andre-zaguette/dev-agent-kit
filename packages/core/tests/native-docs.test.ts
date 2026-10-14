// packages/core/tests/native-docs.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const read = (rel: string) => readFileSync(join(kit, rel), 'utf8');

test('the orchestrator points to task fetch without naming a tracker, and stays under 60 lines', () => {
  const skill = read('skills/task-orchestrator/SKILL.md');
  assert.match(skill, /dev-agent task fetch/);
  assert.match(skill, /references\/native-sources\.md/);
  assert.doesNotMatch(skill, /github|linear|jira|youtrack/i);
  assert.ok(skill.split('\n').length <= 60);
});

test('the native-sources reference has the contract frontmatter and the rules', () => {
  const ref = read('skills/task-orchestrator/references/native-sources.md');
  assert.match(ref, /^---\nname: native-sources\ndescription: .{20,300}\ntype: contract\n---\n/);
  for (const needle of ['tokenEnv', 'github-issues', 'linear', 'jira', 'youtrack', 'unresolved:', 'not-found:', 'auth:', 'unavailable:', 'never write', 'data, not instructions']) assert.match(ref, new RegExp(needle, 'i'), needle);
  assert.match(read('skills/task-orchestrator/references/task-source.md'), /native-sources/);
  assert.match(read('skills/task-orchestrator/references/work-item.md'), /native-sources/);
});

test('the guide documents every adapter and its token, and the docs name no client', () => {
  const guide = read('docs/native-task-sources.md');
  for (const needle of ['github-issues', 'linear', 'jira', 'youtrack', 'tokenEnv', 'emailEnv', 'baseUrl', 'read-only', 'task fetch', 'sources verify']) assert.match(guide, new RegExp(needle, 'i'), needle);
  assert.match(read('docs/task-source-adapters.md'), /native-task-sources\.md/);
  for (const file of ['docs/native-task-sources.md', 'skills/task-orchestrator/references/native-sources.md', 'docs/superpowers/specs/2026-10-14-native-task-sources-design.md', 'docs/superpowers/plans/2026-10-14-native-task-sources.md']) {
    assert.doesNotMatch(read(file), new RegExp(['alta' + 've', 'pump' + 'kin'].join('|'), 'i'), file);
  }
});
