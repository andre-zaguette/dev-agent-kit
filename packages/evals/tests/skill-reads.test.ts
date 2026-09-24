import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillReadsIn } from '../src/transcript/skill-reads.ts';

const tools = (calls: { tool: string }[]) => calls.map((c) => c.tool).sort();

test('detects a plain skill/reference path', () => {
  assert.deepEqual(tools(skillReadsIn(`cat .agents/skills/figma-to-code/SKILL.md`)), ['skill/figma-to-code']);
  assert.deepEqual(tools(skillReadsIn(`cat .claude/skills/figma-to-code/references/react.md`)), ['reference/react']);
});

test('detects every skill named in a bash brace-expansion, as a real Codex transcript did', () => {
  const command = `bash -lc 'cat .agents/skills/{figma-to-code,component-selection,accessibility,frontend-design,responsive-design,visual-validation}/SKILL.md'`;
  assert.deepEqual(tools(skillReadsIn(command)), [
    'skill/accessibility',
    'skill/component-selection',
    'skill/figma-to-code',
    'skill/frontend-design',
    'skill/responsive-design',
    'skill/visual-validation'
  ]);
});

test('brace expansion also works for a references/ path', () => {
  const command = `cat .claude/skills/figma-to-code/references/{react,vuejs}.md`;
  assert.deepEqual(tools(skillReadsIn(command)), ['reference/react', 'reference/vuejs']);
});
