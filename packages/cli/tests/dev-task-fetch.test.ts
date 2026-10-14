// packages/cli/tests/dev-task-fetch.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDev } from '../src/dev-cli.ts';
import { fakeFetch } from '../../core/tests/native-helpers.ts';
import { setup } from './dev-helpers.ts';

const CONFIG = String.raw`
taskSources:
  work:
    adapter: linear
    tokenEnv: LINEAR_KEY
    default: true
    identifiers:
      - '^ENG-\d+$'
  notes:
    adapter: generic-mcp
    server: my-notes
    identifiers:
      - '^ME-\d+$'
    tools:
      get: { name: read_ticket }
    mapping: { key: reference, title: subject }
`;
const ISSUE = { id: 'u1', identifier: 'ENG-123', title: 'Add export', description: 'Body', url: 'https://linear.app/acme/issue/ENG-123', state: { name: 'Open' }, labels: { nodes: [] }, children: { nodes: [] }, relations: { nodes: [] }, inverseRelations: { nodes: [] }, attachments: { nodes: [] }, comments: { nodes: [], pageInfo: { hasNextPage: false } } };
const files = { '.dev-agent/config.yml': CONFIG };

function rig(routes: Parameters<typeof fakeFetch>[0], env: Record<string, string> = { LINEAR_KEY: 'lin-secret-key-1' }) {
  const t = setup(files);
  const f = fakeFetch(routes);
  t.io.fetch = f.fetch;
  Object.assign(t.io.env, env);
  return { ...t, calls: f.calls };
}

test('task fetch prints a summary, and the WorkItem with --json', async () => {
  const t = rig([{ match: () => true, json: { data: { issue: ISSUE } } }]);
  try {
    assert.equal(await runDev(['task', 'fetch', 'ENG-123', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /ENG-123\s+Add export/);
    assert.match(t.text(), /source: work/);
    t.out.length = 0;
    assert.equal(await runDev(['task', 'fetch', 'ENG-123', '--json', '--project', t.projectRoot], t.io), 0);
    const item = JSON.parse(t.text());
    assert.equal(item.key, 'ENG-123');
    assert.equal(item.source, 'work');
    assert.equal(t.text().includes('lin-secret-key-1'), false);
  } finally {
    t.cleanup();
  }
});

test('every handled failure exits 2 with a stable first token', async () => {
  const cases: Array<[string, Parameters<typeof fakeFetch>[0], Record<string, string>, string[], RegExp]> = [
    ['not found', [{ match: () => true, json: { data: { issue: null } } }], { LINEAR_KEY: 'k-1234' }, ['ENG-9'], /^not-found:/],
    ['auth from the server', [{ match: () => true, status: 401, text: 'unauthorized' }], { LINEAR_KEY: 'k-1234' }, ['ENG-9'], /^auth:/],
    ['auth from a missing variable', [], {}, ['ENG-9'], /^auth: .*LINEAR_KEY is not set/],
    ['unavailable', [{ match: () => true, status: 503, text: 'down' }], { LINEAR_KEY: 'k-1234' }, ['ENG-9'], /^unavailable:/],
    ['unresolved identifier', [], { LINEAR_KEY: 'k-1234' }, ['NOPE-1', '--source', 'missing'], /^unresolved:/],
    ['generic-mcp source', [], { LINEAR_KEY: 'k-1234' }, ['ME-5'], /^unresolved: .*generic-mcp.*MCP/]
  ];
  for (const [name, routes, env, args, pattern] of cases) {
    const t = rig(routes, env);
    try {
      assert.equal(await runDev(['task', 'fetch', ...args, '--project', t.projectRoot], t.io), 2, name);
      assert.match(t.err.join('\n'), pattern, name);
      assert.equal(t.err.join('\n').includes('k-1234'), false, name);
    } finally {
      t.cleanup();
    }
  }
});

test('with --json a failure is a JSON object on stdout', async () => {
  const t = rig([{ match: () => true, json: { data: { issue: null } } }]);
  try {
    assert.equal(await runDev(['task', 'fetch', 'ENG-9', '--json', '--project', t.projectRoot], t.io), 2);
    assert.deepEqual(Object.keys(JSON.parse(t.text())).sort(), ['error', 'message']);
    assert.equal(JSON.parse(t.text()).error, 'not-found');
  } finally {
    t.cleanup();
  }
});

test('task fetch needs an identifier', async () => {
  const t = rig([]);
  try {
    assert.equal(await runDev(['task', 'fetch', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /task fetch needs an identifier/);
  } finally {
    t.cleanup();
  }
});

test('sources verify reports whether the token variable is set, never its value', async () => {
  const set = rig([]);
  const unset = rig([], {});
  try {
    assert.equal(await runDev(['sources', 'verify', '--project', set.projectRoot], set.io), 0);
    assert.match(set.text(), /work: linear adapter configured/);
    assert.match(set.text(), /work: LINEAR_KEY is set/);
    assert.equal(set.text().includes('lin-secret-key-1'), false);
    assert.equal(await runDev(['sources', 'verify', '--project', unset.projectRoot], unset.io), 0);
    assert.match(unset.text(), /! work: LINEAR_KEY is not set/);
  } finally {
    set.cleanup();
    unset.cleanup();
  }
});
