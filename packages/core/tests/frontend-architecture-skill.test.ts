import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const kitRoot = fileURLToPath(new URL('../../../', import.meta.url));
const file = join(kitRoot, 'skills', 'frontend-architecture', 'SKILL.md');
// Like the backend skills, this one must stay neutral: frameworks live in references/ (spec §16, §27).
const FORBIDDEN =
  /\b(react|vue|nuxt|next\.js|nextjs|angular|svelte|solid|astro|tailwind|figma|pinia|vuex|redux|zustand|mobx|vitest|jest|playwright|cypress|storybook|vite|webpack|django|fastapi|nestjs|express|flask|laravel|jira|linear|trello|asana|clickup|claude code|codex|cursor)\b/i;

test('frontend-architecture exists with exact frontmatter, neutral text and at most 60 lines', () => {
  assert.ok(existsSync(file), 'skills/frontend-architecture/SKILL.md');
  const text = readFileSync(file, 'utf8');
  const front = text.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
  assert.ok(front, 'frontmatter must be exactly name + one-line description');
  assert.equal(front![1], 'frontend-architecture');
  assert.match(front![2], /^.{40,400}$/);
  // `figma-to-code` is a sibling skill name the skill must reference; \bfigma\b would otherwise match inside it.
  assert.doesNotMatch(text.replaceAll('figma-to-code', ''), FORBIDDEN);
  assert.ok(text.split('\n').length <= 60, 'move detail into references/');
});

test('it loads references on demand and carries the pre-code checklist and the Definition of Done', () => {
  const text = readFileSync(file, 'utf8');
  assert.match(text, /load only the matching file from `references\/`/i);
  assert.match(text, /never assume a stack the repository does not use/i);
  assert.match(text, /## Definition of Done/);
  for (const item of [
    'existing structure and conventions followed',
    'data and state have one clear owner',
    'loading, empty, error and permission states handled',
    'no secrets exposed to the client',
    'accessibility and responsive behavior checked',
    'final diff is task-scoped'
  ]) assert.match(text, new RegExp(item, 'i'), item);
});

test('it points at the neighbouring skills instead of repeating them', () => {
  const text = readFileSync(file, 'utf8');
  for (const skill of ['repository-investigation', 'component-selection', 'accessibility', 'responsive-design', 'surgical-diff', 'figma-to-code', 'frontend-design']) {
    assert.match(text, new RegExp(skill), skill);
  }
});
