import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, type CliIo } from '../src/cli.ts';
import { ClaudeCodeAdapter } from '../src/adapters/claude.ts';
import { CodexAdapter } from '../src/adapters/codex.ts';
import { project, figmaServers } from './integration-helpers.ts';

test('configuredServers: {} without a file, the servers with one, null when unparseable (claude and codex)', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const claude = new ClaudeCodeAdapter(ctx);
    const codex = new CodexAdapter(ctx);
    assert.deepEqual(claude.configuredServers(), {});
    assert.deepEqual(codex.configuredServers(), {});
    await claude.installMcp({ kitRoot: ctx.kitRoot, projectRoot, extraServers: figmaServers('claude') });
    await codex.installMcp({ kitRoot: ctx.kitRoot, projectRoot, extraServers: figmaServers('codex') });
    assert.deepEqual(Object.keys(claude.configuredServers()!).sort(), ['figma', 'frontend-agent']);
    assert.deepEqual(Object.keys(codex.configuredServers()!).sort(), ['figma', 'frontend-agent']);
    writeFileSync(join(projectRoot, '.mcp.json'), '{nope');
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(join(projectRoot, '.codex', 'config.toml'), 'a = = 1');
    assert.equal(claude.configuredServers(), null);
    assert.equal(codex.configuredServers(), null);
  } finally {
    cleanup();
  }
});

test('verify output without integration checks is unchanged and exits 0', async () => {
  const { projectRoot, base, homeDir, cleanup } = project();
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(l), env: { PATH: '', CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 0);
    out.length = 0;
    const code = await run(['verify', 'claude', '--project', projectRoot], io);
    assert.equal(code, 0, out.join('\n'));
    assert.match(out.join('\n'), /\[claude\] ok/);
  } finally {
    cleanup();
  }
});

test('a broken integrations.json becomes a failing check and verify exits 1', async () => {
  const { projectRoot, base, homeDir, cleanup } = project();
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(l), env: { PATH: '', CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 0);
    mkdirSync(join(projectRoot, '.dev-agent'), { recursive: true });
    writeFileSync(join(projectRoot, '.dev-agent', 'integrations.json'), '{oops');
    out.length = 0;
    assert.equal(await run(['verify', 'claude', '--project', projectRoot], io), 1);
    assert.match(out.join('\n'), /✘ integrations-state: .*integrations\.json/);
  } finally {
    cleanup();
  }
});
