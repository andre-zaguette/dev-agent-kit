import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSource } from '../src/task-sources/resolver.ts';
import type { SourceRoute } from '../src/task-sources/types.ts';

const route = (id: string, patterns: string[] = [], isDefault = false): SourceRoute => ({
  id,
  identifiers: patterns.map((p) => new RegExp(p)),
  default: isDefault
});
const routes = [route('company', ['^HEF-\\d+$', '^PAY-\\d+$'], true), route('personal', ['^ME-\\d+$'])];

test('an explicit source wins over a matching pattern', () => {
  assert.deepEqual(resolveSource('ME-1', routes, { explicit: 'company' }), { status: 'resolved', source: 'company', via: 'explicit' });
});

test('an unknown explicit source is reported with the known ids, never guessed around', () => {
  assert.deepEqual(resolveSource('HEF-1', routes, { explicit: 'nope' }), { status: 'unknown-source', source: 'nope', known: ['company', 'personal'] });
});

test('an identifier pattern selects its source', () => {
  assert.deepEqual(resolveSource('ME-7', routes), { status: 'resolved', source: 'personal', via: 'pattern' });
  assert.deepEqual(resolveSource('  PAY-9 ', routes), { status: 'resolved', source: 'company', via: 'pattern' });
});

test('two sources matching the same identifier are ambiguous, even when one is the default', () => {
  const both = [route('a', ['^X-\\d+$'], true), route('b', ['^X-\\d+$'])];
  assert.deepEqual(resolveSource('X-1', both), { status: 'ambiguous', candidates: ['a', 'b'] });
});

test('no pattern match falls back to the configured default', () => {
  assert.deepEqual(resolveSource('12345', routes), { status: 'resolved', source: 'company', via: 'default' });
});

test('no match and no default is unresolved, and says why', () => {
  const noDefault = [route('personal', ['^ME-\\d+$'])];
  const result = resolveSource('12345', noDefault);
  assert.equal(result.status, 'unresolved');
  assert.match((result as { reason: string }).reason, /no source matches/);
  assert.equal((resolveSource('X-1', []) as { reason: string }).reason, 'no task sources are configured');
  assert.equal(resolveSource('   ', routes).status, 'unresolved');
});

test('probing is opt-in, limited to sources without patterns, and bounded', () => {
  const rs = [route('p1', ['^A-\\d+$']), route('open1'), route('open2')];
  assert.equal(resolveSource('zzz', rs).status, 'unresolved');
  assert.deepEqual(resolveSource('zzz', rs, { probe: true }), { status: 'probe', candidates: ['open1', 'open2'] });
  const many = [route('o1'), route('o2'), route('o3'), route('o4')];
  assert.equal(resolveSource('zzz', many, { probe: true }).status, 'unresolved');
});

test('a default source beats probing', () => {
  const rs = [route('open1'), route('dflt', [], true)];
  assert.deepEqual(resolveSource('zzz', rs, { probe: true }), { status: 'resolved', source: 'dflt', via: 'default' });
});
