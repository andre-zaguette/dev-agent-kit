import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const pkg = join(here, '..');
const tsx = join(pkg, '..', '..', 'node_modules', '.bin', 'tsx');

async function withMock(fn: (client: Client, ws: string) => Promise<void>) {
  const ws = mkdtempSync(join(tmpdir(), 'fak-figma-'));
  const transport = new StdioClientTransport({
    command: tsx,
    args: [join(pkg, 'src', 'figma-mock', 'main.ts')],
    env: { ...getDefaultEnvironment(), FIGMA_MOCK_FIXTURE: join(here, 'data', 'figma', 'mini.json'), FIGMA_MOCK_OUTPUT_ROOT: ws }
  });
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(transport);
  try {
    await fn(client, ws);
  } finally {
    await client.close();
    rmSync(ws, { recursive: true, force: true });
  }
}

const textOf = (r: any) => r.content.map((c: any) => c.text ?? '').join('');

test('lists the Figma tool names the skills use', async () => {
  await withMock(async (client) => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['download_assets', 'get_design_context', 'get_metadata', 'get_screenshot', 'get_variable_defs']);
  });
});

test('serves recorded data; accepts URL-style node ids; errors on unknown and too-large nodes', async () => {
  await withMock(async (client) => {
    assert.match(textOf(await client.callTool({ name: 'get_metadata', arguments: {} })), /Page 1/);
    assert.match(textOf(await client.callTool({ name: 'get_design_context', arguments: { nodeId: '1-2' } })), /class="frame"/);
    assert.match(textOf(await client.callTool({ name: 'get_variable_defs', arguments: { nodeId: '1:2' } })), /#4F46E5/);
    const shot: any = await client.callTool({ name: 'get_screenshot', arguments: { nodeId: '1:2' } });
    assert.equal(shot.content[0].type, 'image');
    assert.equal(shot.content[0].mimeType, 'image/png');
    const unknown: any = await client.callTool({ name: 'get_design_context', arguments: { nodeId: '5:5' } });
    assert.equal(unknown.isError, true);
    assert.match(textOf(unknown), /not found/);
    const huge: any = await client.callTool({ name: 'get_design_context', arguments: { nodeId: '9:9' } });
    assert.equal(huge.isError, true);
    assert.match(textOf(huge), /too large.*get_metadata/);
  });
});

test('download_assets writes inside the workspace only', async () => {
  await withMock(async (client, ws) => {
    const ok: any = await client.callTool({ name: 'download_assets', arguments: { nodeId: '1:2', outputDir: 'assets/figma' } });
    assert.notEqual(ok.isError, true, textOf(ok));
    assert.ok(existsSync(join(ws, 'assets', 'figma', 'logo.png')));
    for (const outputDir of ['../escape', '/tmp/abs']) {
      const bad: any = await client.callTool({ name: 'download_assets', arguments: { nodeId: '1:2', outputDir } });
      assert.equal(bad.isError, true, outputDir);
    }
  });
});
