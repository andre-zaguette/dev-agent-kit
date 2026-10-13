import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { run, type CliIo } from '../src/cli.ts';
import { project } from './integration-helpers.ts';

function harness(env: NodeJS.ProcessEnv = { PATH: '' }) {
  const p = project(env);
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), env: { ...env, CODEX_HOME: join(p.base, 'codex-home') }, cwd: p.projectRoot, homeDir: p.homeDir };
  return { ...p, out, err, io };
}

test('--with <unknown> exits 1, lists valid ids and writes nothing', async () => {
  const { projectRoot, io, err, cleanup } = harness();
  try {
    assert.equal(await run(['install', 'claude', '--with', 'nope', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /unknown integration "nope"/);
    assert.equal(existsSync(join(projectRoot, '.mcp.json')), false);
  } finally {
    cleanup();
  }
});

test('a malformed .dev-agent/integrations.json stops install before any write', async () => {
  const { projectRoot, io, err, cleanup } = harness();
  try {
    mkdirSync(join(projectRoot, '.dev-agent'));
    writeFileSync(join(projectRoot, '.dev-agent', 'integrations.json'), '{oops');
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /integrations\.json/);
    assert.equal(existsSync(join(projectRoot, '.mcp.json')), false);
  } finally {
    cleanup();
  }
});

test('--no-figma still works as before', async () => {
  const { projectRoot, io, cleanup } = harness();
  try {
    assert.equal(await run(['install', 'claude', '--no-figma', '--project', projectRoot], io), 0);
    assert.equal(JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8')).mcpServers.figma, undefined);
  } finally {
    cleanup();
  }
});

test('a recorded id missing from the registry survives a plain install', async () => {
  const { projectRoot, io, cleanup } = harness();
  try {
    mkdirSync(join(projectRoot, '.dev-agent'));
    writeFileSync(join(projectRoot, '.dev-agent', 'integrations.json'), JSON.stringify({ enabled: ['figma', 'headroom'] }));
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 0);
    assert.deepEqual(JSON.parse(readFileSync(join(projectRoot, '.dev-agent', 'integrations.json'), 'utf8')), { enabled: ['figma', 'headroom'] });
  } finally {
    cleanup();
  }
});

test('--no-figma records an empty selection', async () => {
  const { projectRoot, io, cleanup } = harness();
  try {
    assert.equal(await run(['install', 'claude', '--no-figma', '--project', projectRoot], io), 0);
    assert.deepEqual(JSON.parse(readFileSync(join(projectRoot, '.dev-agent', 'integrations.json'), 'utf8')), { enabled: [] });
  } finally {
    cleanup();
  }
});

test('a .dev-agent symlink pointing outside the project stops install before any write', async () => {
  const { base, projectRoot, io, cleanup } = harness();
  try {
    const outside = join(base, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(projectRoot, '.dev-agent'));
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 1);
    assert.equal(existsSync(join(projectRoot, '.mcp.json')), false);
  } finally {
    cleanup();
  }
});
