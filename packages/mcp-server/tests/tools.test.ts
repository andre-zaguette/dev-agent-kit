import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/index.ts';

async function connectClient() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

test('the server exposes exactly the five v0.3 tools and reports version 0.3.0', async () => {
  const { client, server } = await connectClient();
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ['capture_screenshot', 'compare_screenshots', 'inspect_dom', 'run_accessibility_audit', 'run_responsive_suite']
    );
    assert.equal(client.getServerVersion()?.version, '0.3.0');
  } finally {
    await client.close();
    await server.close();
  }
});

test('tool errors come back as isError results, not transport failures', async () => {
  const { client, server } = await connectClient();
  try {
    const result = await client.callTool({
      name: 'run_accessibility_audit',
      arguments: { url: 'http://example.com/' }
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /host not allowed/);
  } finally {
    await client.close();
    await server.close();
  }
});
