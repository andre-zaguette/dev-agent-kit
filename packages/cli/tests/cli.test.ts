import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, type CliIo } from '../src/cli.ts';
import { findKitRoot } from '../src/util.ts';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'frontend-agent-cli-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    env: { PATH: '', CODEX_HOME: join(base, 'codex-home') },
    cwd: projectRoot,
    homeDir
  };
  return { base, projectRoot, homeDir, io, out, err, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('install claude sets up skills, CLAUDE.md and .mcp.json in the target project; a re-run changes nothing', async () => {
  const { projectRoot, io, out, cleanup } = setup();
  try {
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 0);
    assert.ok(existsSync(join(projectRoot, '.claude', 'skills', 'figma-to-code', 'SKILL.md')));
    assert.match(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8'), /frontend-agent-kit:start/);
    const mcp = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
    assert.equal(mcp.mcpServers['frontend-agent'].env.FRONTEND_AGENT_PROJECT_ROOT, projectRoot);
    const firstRunOutput = out.join('\n');
    assert.match(firstRunOutput, /added/);
    out.length = 0;
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 0);
    assert.match(out.join('\n'), /0 added, 0 updated, 0 removed/);
    assert.match(out.join('\n'), /CLAUDE\.md: unchanged/);
  } finally {
    cleanup();
  }
});

test('install with no host installs every detected host, and fails clearly when none is detected', async () => {
  const { projectRoot, homeDir, io, err, cleanup } = setup();
  try {
    assert.equal(await run(['install', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /no supported host detected/);
    mkdirSync(join(homeDir, '.claude'));
    assert.equal(await run(['install', '--project', projectRoot], io), 0);
    assert.ok(existsSync(join(projectRoot, '.mcp.json')));
    assert.equal(existsSync(join(projectRoot, 'AGENTS.md')), false, 'codex was not detected, so not installed');
  } finally {
    cleanup();
  }
});

test('--all installs both real hosts; --no-figma skips the figma server', async () => {
  const { projectRoot, io, cleanup } = setup();
  try {
    assert.equal(await run(['install', '--all', '--no-figma', '--project', projectRoot], io), 0);
    assert.ok(existsSync(join(projectRoot, '.agents', 'skills', 'figma-to-code', 'SKILL.md')));
    assert.ok(existsSync(join(projectRoot, 'AGENTS.md')));
    assert.doesNotMatch(readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8'), /figma/);
    const mcp = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
    assert.equal(mcp.mcpServers.figma, undefined);
  } finally {
    cleanup();
  }
});

test('preflight fails closed: a corrupt .codex/config.toml + install --all writes nothing at all, not even for claude', async () => {
  const { projectRoot, io, err, cleanup } = setup();
  try {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(join(projectRoot, '.codex', 'config.toml'), 'not = [valid toml');
    assert.equal(await run(['install', '--all', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /^\[codex\] frontend-agent: cannot parse/);
    assert.equal(existsSync(join(projectRoot, '.claude', 'skills')), false, 'claude skills not installed');
    assert.equal(existsSync(join(projectRoot, 'CLAUDE.md')), false, 'CLAUDE.md not created');
    assert.equal(existsSync(join(projectRoot, '.mcp.json')), false, '.mcp.json not created');
    assert.equal(existsSync(join(projectRoot, '.agents', 'skills')), false, 'codex skills not installed either');
    assert.equal(existsSync(join(projectRoot, 'AGENTS.md')), false, 'AGENTS.md not created');
  } finally {
    cleanup();
  }
});

test('stub hosts, unknown hosts, a missing project dir and the kit checkout itself are rejected with exit 1', async () => {
  const { base, projectRoot, io, err, cleanup } = setup();
  try {
    assert.equal(await run(['install', 'cursor', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /cursor is not supported yet/);
    assert.equal(await run(['install', 'emacs', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /unknown host "emacs"/);
    assert.equal(await run(['install', 'claude', '--project', join(base, 'nope')], io), 1);
    assert.match(err.join('\n'), /does not exist/);
    assert.equal(await run(['install', 'claude', '--project', findKitRoot()], io), 1);
    assert.match(err.join('\n'), /kit checkout itself/);
  } finally {
    cleanup();
  }
});

test('verify exits 0 when every check passes and 1 otherwise, printing each check', async () => {
  const { projectRoot, io, out, cleanup } = setup();
  try {
    assert.equal(await run(['verify', 'claude', '--project', projectRoot], io), 1);
    await run(['install', 'claude', '--project', projectRoot], io);
    out.length = 0;
    assert.equal(await run(['verify', 'claude', '--project', projectRoot], io), 0);
    assert.match(out.join('\n'), /✔ mcp-server/);
    out.length = 0;
    await run(['install', 'codex', '--project', projectRoot], io);
    assert.equal(await run(['verify', 'codex', '--project', projectRoot], io), 1);
    assert.match(out.join('\n'), /✘ codex-trust/);
  } finally {
    cleanup();
  }
});

test('--help and --version print and exit 0; an unknown command exits 1', async () => {
  const { io, out, err, cleanup } = setup();
  try {
    assert.equal(await run(['--version'], io), 0);
    assert.equal(out.at(-1), '0.7.1');
    assert.equal(await run(['--help'], io), 0);
    assert.match(out.join('\n'), /frontend-agent install/);
    assert.equal(await run(['frobnicate'], io), 1);
    assert.match(err.join('\n'), /unknown command "frobnicate"/);
  } finally {
    cleanup();
  }
});

test('the bin script runs the CLI through tsx from any cwd', () => {
  const result = spawnSync(process.execPath, [join(packageRoot, 'bin', 'frontend-agent.mjs'), '--version'], {
    cwd: tmpdir(),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '0.7.1');
});

test('a relative --project resolves against INIT_CWD (npm run), not the process cwd the kit runs from', () => {
  const base = mkdtempSync(join(tmpdir(), 'frontend-agent-initcwd-'));
  try {
    const projectRoot = join(base, 'my-app');
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(base, 'home'));
    // Simulate `npm run frontend-agent -- install --project ./my-app` invoked from `base`,
    // where npm has changed the actual process cwd to the kit root but sets INIT_CWD to `base`.
    const result = spawnSync(process.execPath, [join(packageRoot, 'bin', 'frontend-agent.mjs'), 'install', 'claude', '--project', './my-app'], {
      cwd: packageRoot,
      env: { ...process.env, INIT_CWD: base, PATH: '', HOME: join(base, 'home') },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(projectRoot, 'CLAUDE.md')), 'installed into INIT_CWD-relative path, not the kit-root-relative path');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('preflight fails closed on a settings line appended below the managed TOML block (merge check), before claude writes anything', async () => {
  const { projectRoot, io, err, cleanup } = setup();
  try {
    assert.equal(await run(['install', 'codex', '--project', projectRoot, '--no-figma'], io), 0);
    appendFileSync(join(projectRoot, '.codex', 'config.toml'), 'EXTRA_SETTING = "x"\n');
    assert.equal(await run(['install', '--all', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /^\[codex\] .*would merge into it/m);
    assert.equal(existsSync(join(projectRoot, 'CLAUDE.md')), false, 'CLAUDE.md not created');
    assert.equal(existsSync(join(projectRoot, '.claude', 'skills')), false, 'claude skills not installed');
  } finally {
    cleanup();
  }
});

test('preflight fails closed on a corrupt skills manifest of a later host', async () => {
  const { projectRoot, io, err, cleanup } = setup();
  try {
    mkdirSync(join(projectRoot, '.agents', 'skills'), { recursive: true });
    writeFileSync(join(projectRoot, '.agents', 'skills', '.frontend-agent-kit-manifest.json'), '{');
    assert.equal(await run(['install', '--all', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /^\[codex\] .*corrupt or was tampered with/m);
    assert.equal(existsSync(join(projectRoot, 'CLAUDE.md')), false, 'CLAUDE.md not created');
  } finally {
    cleanup();
  }
});
