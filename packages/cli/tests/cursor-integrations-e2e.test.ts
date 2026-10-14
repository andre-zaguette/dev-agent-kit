// packages/cli/tests/cursor-integrations-e2e.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, type CliIo } from '../src/cli.ts';
import { project, fakeBin } from './integration-helpers.ts';

function harness(env: NodeJS.ProcessEnv) {
  const p = project(env);
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), env: { ...env, CODEX_HOME: join(p.base, 'codex-home') }, cwd: p.projectRoot, homeDir: p.homeDir };
  return { ...p, out, err, io };
}

test('e2e: install cursor --with headroom writes the entry, verify is ok, a re-install without the binary keeps it', async () => {
  const { base: dir, projectRoot, io, out, cleanup } = harness({ PATH: '' });
  try {
    const bin = fakeBin(join(dir, 'bin'), 'headroom');
    io.env.PATH = join(dir, 'bin');
    assert.equal(await run(['install', 'cursor', '--with', 'headroom', '--project', projectRoot], io), 0, out.join('\n'));
    const file = join(projectRoot, '.cursor', 'mcp.json');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).mcpServers.headroom, { type: 'stdio', command: bin, args: ['mcp', 'serve'] });
    out.length = 0;
    assert.equal(await run(['verify', 'cursor', '--project', projectRoot], io), 0, out.join('\n'));
    assert.match(out.join('\n'), /✔ integration:headroom/);
    const before = readFileSync(file, 'utf8');
    io.env.PATH = '';
    out.length = 0;
    assert.equal(await run(['install', 'cursor', '--project', projectRoot], io), 0, out.join('\n'));
    assert.doesNotMatch(out.join('\n'), /✖|fail|error/i);
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.ok(JSON.parse(readFileSync(join(projectRoot, '.dev-agent', 'integrations.json'), 'utf8')).enabled.includes('headroom'));
  } finally {
    cleanup();
  }
});

test('e2e: a user-owned headroom entry in .cursor/mcp.json is kept and reported', async () => {
  const { base: dir, projectRoot, io, out, cleanup } = harness({ PATH: '' });
  try {
    fakeBin(join(dir, 'bin'), 'headroom');
    io.env.PATH = join(dir, 'bin');
    mkdirSync(join(projectRoot, '.cursor'));
    writeFileSync(join(projectRoot, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { headroom: { command: 'custom' } } }));
    assert.equal(await run(['install', 'cursor', '--with', 'headroom', '--project', projectRoot], io), 0, out.join('\n'));
    assert.deepEqual(JSON.parse(readFileSync(join(projectRoot, '.cursor', 'mcp.json'), 'utf8')).mcpServers.headroom, { command: 'custom' });
    assert.match(out.join('\n'), /headroom MCP server already configured in .*mcp\.json — kept/);
  } finally {
    cleanup();
  }
});

test('e2e: --with claude-mem on cursor alone is a usage error naming claude; nothing is written', async () => {
  const { projectRoot, io, err, cleanup } = harness({ PATH: '' });
  try {
    assert.equal(await run(['install', 'cursor', '--with', 'claude-mem', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /needs one of these hosts: claude \(selected: cursor\)/);
    assert.equal(existsSync(join(projectRoot, '.cursor')), false);
    assert.equal(existsSync(join(projectRoot, 'AGENTS.md')), false);
  } finally {
    cleanup();
  }
});
