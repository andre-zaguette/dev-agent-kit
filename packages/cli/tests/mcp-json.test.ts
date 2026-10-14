import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMcpJsonFile, applyExtraServers, readConfiguredServers, readConfiguredLaunch } from '../src/mcp-json.ts';

function withFile(content: string | null, fn: (file: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-json-'));
  const file = join(dir, 'mcp.json');
  if (content !== null) writeFileSync(file, content);
  try {
    fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('readMcpJsonFile: missing file is {}, other top-level keys survive', () => {
  withFile(null, (file) => assert.deepEqual(readMcpJsonFile(file), {}));
  withFile('{"mcpServers":{"a":{"command":"x"}},"other":1}', (file) => {
    assert.deepEqual(readMcpJsonFile(file), { mcpServers: { a: { command: 'x' } }, other: 1 });
  });
});

test('readMcpJsonFile: the three error messages are unchanged', () => {
  withFile('{nope', (file) => assert.throws(() => readMcpJsonFile(file), /^Error: frontend-agent: cannot parse .*mcp\.json: /));
  withFile('[]', (file) => assert.throws(() => readMcpJsonFile(file), /frontend-agent: .*mcp\.json must contain a JSON object/));
  withFile('{"mcpServers":[]}', (file) => assert.throws(() => readMcpJsonFile(file), /frontend-agent: "mcpServers" in .*mcp\.json must be an object/));
  withFile('{"mcpServers":null}', (file) => assert.throws(() => readMcpJsonFile(file), /"mcpServers" in .* must be an object/));
});

test('applyExtraServers: adds with the registered line, keeps an existing entry, appends the hint', () => {
  const servers: Record<string, Record<string, unknown>> = { figma: { url: 'https://custom' } };
  const actions = applyExtraServers(
    servers,
    [
      { name: 'figma', entry: { url: 'https://mcp.figma.com/mcp' } },
      { name: 'headroom', entry: { type: 'stdio', command: '/x/headroom', args: ['mcp', 'serve'] } },
      { name: 'other', entry: { url: 'u' }, hint: 'authenticate with: x' }
    ],
    '/p/.cursor/mcp.json'
  );
  assert.deepEqual(servers.figma, { url: 'https://custom' });
  assert.deepEqual(servers.headroom, { type: 'stdio', command: '/x/headroom', args: ['mcp', 'serve'] });
  assert.deepEqual(actions, [
    'figma MCP server already configured in /p/.cursor/mcp.json — kept',
    'headroom MCP server registered in /p/.cursor/mcp.json',
    'other MCP server registered in /p/.cursor/mcp.json (authenticate with: x)'
  ]);
});

test('readConfiguredServers: {} without a file, a copy of the servers, null on an error', () => {
  withFile(null, (file) => assert.deepEqual(readConfiguredServers(file), {}));
  withFile('{"mcpServers":{"a":{"command":"x"}}}', (file) => assert.deepEqual(readConfiguredServers(file), { a: { command: 'x' } }));
  withFile('{nope', (file) => assert.equal(readConfiguredServers(file), null));
});

test('readConfiguredLaunch: the kit entry becomes a launch, a missing entry is null, an error is reported', () => {
  withFile('{"mcpServers":{"frontend-agent":{"command":"/t","args":["a",2],"env":{"K":"v"}}}}', (file) => {
    assert.deepEqual(readConfiguredLaunch(file), { launch: { command: '/t', args: ['a', '2'], env: { K: 'v' } } });
  });
  withFile('{"mcpServers":{"frontend-agent":{"args":[]}}}', (file) => assert.deepEqual(readConfiguredLaunch(file), { launch: null }));
  withFile('{"mcpServers":{}}', (file) => assert.deepEqual(readConfiguredLaunch(file), { launch: null }));
  withFile('{nope', (file) => {
    const result = readConfiguredLaunch(file);
    assert.equal(result.launch, null);
    assert.match(result.error ?? '', /cannot parse/);
  });
});
