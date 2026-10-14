import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectFrontendReferences } from '../src/frontend-references.ts';
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
const refs = (p: ProjectProfile) => selectFrontendReferences(p).map((h) => `${h.skill}/${h.reference}`);

test('no frontend signal gives nothing, however much backend there is', () => {
  assert.deepEqual(refs(profile({})), []);
  assert.deepEqual(refs(profile({ languages: ['python'], frameworks: ['fastapi', 'django'], docker: true })), []);
  assert.deepEqual(refs(profile({ languages: ['typescript'], frameworks: ['react', 'tailwind'] })), []);
});

test('vue gets vue-stack, next gets next-stack, nuxt gets nuxt-stack first and vue-stack second', () => {
  assert.deepEqual(refs(profile({ frameworks: ['vue'] })), ['frontend-architecture/vue-stack']);
  assert.deepEqual(refs(profile({ frameworks: ['next', 'react'] })), ['frontend-architecture/next-stack']);
  assert.deepEqual(refs(profile({ frameworks: ['vue', 'nuxt'] })), ['frontend-architecture/nuxt-stack', 'frontend-architecture/vue-stack']);
  assert.deepEqual(refs(profile({ frameworks: ['nuxt'] })), ['frontend-architecture/nuxt-stack']);
});

test('hints carry a reason, never repeat, and keep a stable order', () => {
  const p = profile({ frameworks: ['next', 'vue', 'nuxt', 'vue', 'next'] });
  const hints = selectFrontendReferences(p);
  assert.deepEqual(hints.map((h) => h.reference), ['nuxt-stack', 'vue-stack', 'next-stack']);
  for (const hint of hints) assert.match(hint.reason, /detected/);
  assert.deepEqual(selectFrontendReferences(p), hints);
});

test('a fullstack profile gets both lists, and no reference name appears in both', () => {
  const p = profile({ languages: ['typescript', 'python'], frameworks: ['next', 'react', 'fastapi'], database: 'postgresql' });
  const front = selectFrontendReferences(p).map((h) => h.reference);
  const back = selectBackendReferences(p).map((h) => h.reference);
  assert.deepEqual(front, ['next-stack']);
  assert.ok(back.includes('fastapi'));
  assert.deepEqual(front.filter((name) => back.includes(name)), []);
});
