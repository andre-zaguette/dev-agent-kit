import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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

test('install cursor writes .agents/skills, AGENTS.md and .cursor/mcp.json and nothing for the other hosts', async () => {
  const { projectRoot, io, out, cleanup } = harness();
  try {
    assert.equal(await run(['install', 'cursor', '--project', projectRoot], io), 0, out.join('\n'));
    assert.ok(existsSync(join(projectRoot, '.agents', 'skills', 'figma-to-code', 'SKILL.md')));
    assert.ok(existsSync(join(projectRoot, 'AGENTS.md')));
    const mcp = JSON.parse(readFileSync(join(projectRoot, '.cursor', 'mcp.json'), 'utf8'));
    assert.deepEqual(Object.keys(mcp.mcpServers).sort(), ['figma', 'frontend-agent']);
    for (const absent of ['.mcp.json', 'CLAUDE.md', '.claude', '.codex']) assert.equal(existsSync(join(projectRoot, absent)), false, absent);
    out.length = 0;
    assert.equal(await run(['verify', 'cursor', '--project', projectRoot], io), 0, out.join('\n'));
    assert.match(out.join('\n'), /\[cursor\] ok/);
  } finally {
    cleanup();
  }
});

test('--all still selects claude and codex only: no .cursor is created', async () => {
  const { projectRoot, io, out, cleanup } = harness();
  try {
    assert.equal(await run(['install', '--all', '--project', projectRoot], io), 0, out.join('\n'));
    assert.equal(existsSync(join(projectRoot, '.cursor')), false);
    assert.ok(existsSync(join(projectRoot, '.mcp.json')));
    assert.ok(existsSync(join(projectRoot, '.codex', 'config.toml')));
  } finally {
    cleanup();
  }
});

test('with no host named, a detected Cursor (~/.cursor) is installed too', async () => {
  const { projectRoot, homeDir, io, out, cleanup } = harness();
  try {
    mkdirSync(join(homeDir, '.cursor'));
    assert.equal(await run(['install', '--project', projectRoot], io), 0, out.join('\n'));
    assert.ok(existsSync(join(projectRoot, '.cursor', 'mcp.json')));
    assert.equal(existsSync(join(projectRoot, '.mcp.json')), false);
    assert.equal(existsSync(join(projectRoot, '.codex')), false);
    assert.equal(existsSync(join(projectRoot, 'CLAUDE.md')), false);
  } finally {
    cleanup();
  }
});

test('with no host named and nothing detected, the error names cursor', async () => {
  const { projectRoot, io, err, cleanup } = harness();
  try {
    assert.equal(await run(['install', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /pass claude, codex or cursor explicitly/);
  } finally {
    cleanup();
  }
});

test('unknown host lists cursor; vscode is still a stub', async () => {
  const { projectRoot, io, err, cleanup } = harness();
  try {
    assert.equal(await run(['install', 'zed', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /expected one of: claude, codex, cursor, vscode/);
    err.length = 0;
    assert.equal(await run(['install', 'vscode', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /vscode is not supported yet/);
  } finally {
    cleanup();
  }
});

test('an unparsable .cursor/mcp.json stops `install claude cursor` before anything is written, claude included', async () => {
  const { projectRoot, io, err, cleanup } = harness();
  try {
    mkdirSync(join(projectRoot, '.cursor'));
    writeFileSync(join(projectRoot, '.cursor', 'mcp.json'), '{nope');
    assert.equal(await run(['install', 'claude', 'cursor', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /\[cursor\] .*cannot parse/);
    for (const absent of ['.mcp.json', 'CLAUDE.md', '.claude', '.agents', 'AGENTS.md']) assert.equal(existsSync(join(projectRoot, absent)), false, absent);
    assert.equal(readFileSync(join(projectRoot, '.cursor', 'mcp.json'), 'utf8'), '{nope');
  } finally {
    cleanup();
  }
});

test('codex and cursor installed together: both verify ok and repeated installs change nothing', async () => {
  const { projectRoot, io, out, cleanup } = harness();
  try {
    assert.equal(await run(['install', 'codex', 'cursor', '--project', projectRoot], io), 0, out.join('\n'));
    const agents = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
    const manifest = readFileSync(join(projectRoot, '.agents', 'skills', '.frontend-agent-kit-manifest.json'), 'utf8');
    assert.equal(await run(['install', 'cursor', 'codex', '--project', projectRoot], io), 0);
    assert.equal(readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8'), agents);
    assert.equal(readFileSync(join(projectRoot, '.agents', 'skills', '.frontend-agent-kit-manifest.json'), 'utf8'), manifest);
    out.length = 0;
    const verifyCode = await run(['verify', 'cursor', '--project', projectRoot], io);
    assert.equal(verifyCode, 0, out.join('\n'));
    assert.match(out.join('\n'), /\[cursor\] ok/);
  } finally {
    cleanup();
  }
});

for (const [dirName, hosts] of [['.cursor', ['claude', 'cursor']], ['.codex', ['claude', 'codex']]] as const) {
  test(`a dangling ${dirName} symlink stops install ${hosts.join(' ')} before anything is written`, async () => {
    const { base, projectRoot, io, err, cleanup } = harness();
    try {
      mkdirSync(join(base, 'outside'));
      symlinkSync(join(base, 'outside', 'missing'), join(projectRoot, dirName));
      assert.equal(await run(['install', ...hosts, '--project', projectRoot], io), 1);
      assert.match(err.join('\n'), /dangling symbolic link/);
      for (const absent of ['.mcp.json', 'CLAUDE.md', '.claude', '.agents', 'AGENTS.md', '.dev-agent']) {
        assert.equal(existsSync(join(projectRoot, absent)), false, absent);
      }
    } finally {
      cleanup();
    }
  });
}
