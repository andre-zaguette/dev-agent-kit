import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { run, type CliIo } from '../src/cli.ts';
import { project, fakeBin } from './integration-helpers.ts';

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

test('end to end: install --with headroom --with graphify, then verify warns for a missing graphify and exits 0', async () => {
  const { base, projectRoot, homeDir, cleanup } = project();
  const binDir = join(base, 'bin');
  fakeBin(binDir, 'headroom');
  const g = fakeBin(binDir, 'graphify');
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(l), env: { PATH: binDir, CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    assert.equal(await run(['install', 'claude', '--with', 'headroom', '--with', 'graphify', '--project', projectRoot], io), 0, out.join('\n'));
    out.length = 0;
    assert.equal(await run(['verify', 'claude', '--project', projectRoot], io), 0, out.join('\n'));
    assert.match(out.join('\n'), /✔ integration:headroom/);
    assert.match(out.join('\n'), /✔ integration:graphify/);
    // the machine loses graphify: still exit 0, now with a warning
    rmSync(g);
    out.length = 0;
    assert.equal(await run(['verify', 'claude', '--project', projectRoot], io), 0, out.join('\n'));
    assert.match(out.join('\n'), /! integration:graphify/);
    assert.match(out.join('\n'), /\[claude\] ok \(with warnings\)/);
  } finally {
    cleanup();
  }
});

test('end to end: --with cartographer on codex only is a usage error naming claude', async () => {
  const { projectRoot, io, err, cleanup } = harness();
  try {
    assert.equal(await run(['install', 'codex', '--with', 'cartographer', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /cartographer.*claude/);
  } finally {
    cleanup();
  }
});

test('end to end: a headroom entry removed by hand fails verify with exit 1', async () => {
  const { base, projectRoot, homeDir, cleanup } = project();
  const binDir = join(base, 'bin');
  fakeBin(binDir, 'headroom');
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(l), env: { PATH: binDir, CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    assert.equal(await run(['install', 'claude', '--with', 'headroom', '--project', projectRoot], io), 0);
    const file = join(projectRoot, '.mcp.json');
    const json = JSON.parse(readFileSync(file, 'utf8'));
    delete json.mcpServers.headroom;
    writeFileSync(file, JSON.stringify(json));
    out.length = 0;
    assert.equal(await run(['verify', 'claude', '--project', projectRoot], io), 1);
    assert.match(out.join('\n'), /✘ integration:headroom/);
  } finally {
    cleanup();
  }
});

test('end to end: a recorded headroom stays sticky when the binary leaves PATH, and --no-headroom drops it without touching .mcp.json', async () => {
  const { base, projectRoot, homeDir, cleanup } = project();
  const binDir = join(base, 'bin');
  fakeBin(binDir, 'headroom');
  const out: string[] = [];
  const codexHome = join(base, 'codex-home');
  const withBin: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(l), env: { PATH: binDir, CODEX_HOME: codexHome }, cwd: projectRoot, homeDir };
  const noBin: CliIo = { ...withBin, env: { PATH: '', CODEX_HOME: codexHome } };
  const mcp = join(projectRoot, '.mcp.json');
  const state = join(projectRoot, '.dev-agent', 'integrations.json');
  try {
    assert.equal(await run(['install', 'claude', '--with', 'headroom', '--project', projectRoot], withBin), 0, out.join('\n'));
    const mcpBefore = readFileSync(mcp, 'utf8');
    assert.ok(JSON.parse(mcpBefore).mcpServers.headroom);

    assert.equal(await run(['install', 'claude', '--project', projectRoot], noBin), 0, out.join('\n'));
    assert.equal(readFileSync(mcp, 'utf8'), mcpBefore, '.mcp.json changed');
    assert.ok(JSON.parse(readFileSync(state, 'utf8')).enabled.includes('headroom'), 'headroom no longer recorded');

    assert.equal(await run(['install', 'claude', '--no-headroom', '--project', projectRoot], noBin), 0, out.join('\n'));
    assert.ok(!JSON.parse(readFileSync(state, 'utf8')).enabled.includes('headroom'), 'headroom still recorded');
    assert.equal(readFileSync(mcp, 'utf8'), mcpBefore, 'adapters must not remove the entry');
  } finally {
    cleanup();
  }
});

test('end to end: Codex drops a sticky headroom entry when the binary is gone; verify warns (never fails) and install prints the hint', async () => {
  const { base, projectRoot, homeDir, cleanup } = project();
  const binDir = join(base, 'bin');
  fakeBin(binDir, 'headroom');
  const out: string[] = [];
  const codexHome = join(base, 'codex-home');
  const withBin: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(l), env: { PATH: binDir, CODEX_HOME: codexHome }, cwd: projectRoot, homeDir };
  const noBin: CliIo = { ...withBin, env: { PATH: '', CODEX_HOME: codexHome } };
  try {
    assert.equal(await run(['install', '--all', '--with', 'headroom', '--project', projectRoot], withBin), 0, out.join('\n'));
    out.length = 0;
    assert.equal(await run(['install', '--all', '--project', projectRoot], noBin), 0, out.join('\n'));
    assert.match(out.join('\n'), /headroom: not found on PATH/);
    // Documented behavior: the Codex managed block is regenerated, so the entry is dropped; .mcp.json keeps its entry.
    assert.doesNotMatch(readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8'), /headroom/);
    assert.ok(JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8')).mcpServers.headroom);
    out.length = 0;
    // The exit code is not asserted: codex-trust fails here for an unrelated reason (the project is not trusted by Codex).
    await run(['verify', '--all', '--project', projectRoot], noBin);
    const text = out.join('\n');
    assert.match(text, /! integration:headroom/);
    assert.doesNotMatch(text, /✘ integration:headroom/);
    assert.doesNotMatch(text, /✘ (?!codex-trust)/);
  } finally {
    cleanup();
  }
});
