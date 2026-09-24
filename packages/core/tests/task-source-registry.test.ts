import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskSourceRegistry } from '../src/task-sources/registry.ts';
import type { TaskSourceAdapter } from '../src/task-sources/types.ts';

const fake = (id: string): TaskSourceAdapter => ({
  id,
  capabilities: () => ({ search: false, comments: false, attachments: false, links: false, write: false }),
  getWorkItem: async () => {
    throw new Error('unused');
  }
});

test('register, list and get keep registration order and return undefined for unknown ids', () => {
  const registry = new TaskSourceRegistry();
  registry.register(fake('company'));
  registry.register(fake('personal'));
  assert.deepEqual(registry.list(), ['company', 'personal']);
  assert.equal(registry.get('company')?.id, 'company');
  assert.equal(registry.get('nope'), undefined);
});

test('registering the same id twice or a second default is refused', () => {
  const registry = new TaskSourceRegistry();
  registry.register(fake('a'), { default: true });
  assert.throws(() => registry.register(fake('a')), /already registered/);
  assert.throws(() => registry.register(fake('b'), { default: true }), /only one default/);
});

test('resolve delegates to the resolver using the registered routes', () => {
  const registry = new TaskSourceRegistry();
  registry.register(fake('company'), { identifiers: [/^HEF-\d+$/], default: true });
  registry.register(fake('personal'), { identifiers: [/^ME-\d+$/] });
  assert.deepEqual(registry.resolve('ME-2'), { status: 'resolved', source: 'personal', via: 'pattern' });
  assert.deepEqual(registry.resolve('42'), { status: 'resolved', source: 'company', via: 'default' });
  assert.deepEqual(registry.resolve('42', { explicit: 'personal' }), { status: 'resolved', source: 'personal', via: 'explicit' });
});
