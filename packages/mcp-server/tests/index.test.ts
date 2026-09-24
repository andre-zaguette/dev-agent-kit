import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

test('server process starts, logs to stderr only, and stays alive', async () => {
  const child = spawn('npx', ['tsx', 'src/index.ts'], { cwd: packageRoot });
  let stderrOutput = '';
  let stdoutOutput = '';
  child.stderr.on('data', (chunk) => { stderrOutput += chunk.toString(); });
  child.stdout.on('data', (chunk) => { stdoutOutput += chunk.toString(); });

  await delay(1500);

  assert.equal(child.exitCode, null, 'process should still be running after 1.5s');
  assert.match(stderrOutput, /frontend-agent MCP server running on stdio/);
  assert.equal(stdoutOutput, '', 'stdout must stay clean for MCP JSON-RPC framing');

  child.kill();
});
