import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findKitRoot } from '../src/util.ts';

const MAX_CHARS = 1800;
const files = { claude: 'integrations/claude/CLAUDE.md', codex: 'integrations/codex/AGENTS.md' };

for (const [host, rel] of Object.entries(files)) {
  test(`${host} instructions: short, generic first, frontend rules kept, no task-source products`, () => {
    const text = readFileSync(join(findKitRoot(), rel), 'utf8');
    assert.ok(text.length <= MAX_CHARS, `${rel} is ${text.length} chars, limit ${MAX_CHARS}`);
    assert.match(text, /^# Dev Agent Kit/);
    assert.match(text, /Inspect the repository before editing/i);
    assert.match(text, /real behavior/i);
    assert.match(text, /requested scope/i);
    assert.ok(text.indexOf('Inspect the repository') < text.indexOf('Figma'), 'generic principles come before the frontend section');
    for (const kept of ['Figma', 'compare_screenshots', 'run_responsive_suite', 'run_accessibility_audit']) assert.match(text, new RegExp(kept));
    assert.doesNotMatch(text, /task-orchestrator|jira|linear|trello|asana|clickup/i);
  });
}
