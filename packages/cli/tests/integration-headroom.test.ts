import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { headroom, HEADROOM_INSTALL } from '../src/integrations/headroom.ts';
import { run, type CliIo } from '../src/cli.ts';
import { ClaudeCodeAdapter } from '../src/adapters/claude.ts';
import { CodexAdapter } from '../src/adapters/codex.ts';
import { project, fakeBin } from './integration-helpers.ts';

test('detect: path lookup only; present with binPath, absent otherwise', async () => {
  const { base, ctx, cleanup } = project();
  try {
    assert.deepEqual(await headroom.detect({ ...ctx, env: { PATH: '' } }), { state: 'absent' });
    const bin = fakeBin(join(base, 'bin'), 'headroom');
    assert.deepEqual(await headroom.detect({ ...ctx, env: { PATH: join(base, 'bin') } }), { state: 'present', binPath: bin, detail: bin });
  } finally {
    cleanup();
  }
});

test('assertInstallable fails with the install command when the binary is missing', () => {
  assert.throws(() => headroom.assertInstallable!({ state: 'absent' }), new RegExp(HEADROOM_INSTALL.replace(/[[\]]/g, '\\$&')));
  assert.doesNotThrow(() => headroom.assertInstallable!({ state: 'present', binPath: '/x/headroom' }));
});

test('plan: stdio entry for claude, plain command entry for codex, nothing when absent', () => {
  const present = { state: 'present', binPath: '/abs/headroom' } as const;
  assert.deepEqual(headroom.plan('claude', present), [{ name: 'headroom', entry: { type: 'stdio', command: '/abs/headroom', args: ['mcp', 'serve'] } }]);
  assert.deepEqual(headroom.plan('codex', present), [{ name: 'headroom', entry: { command: '/abs/headroom', args: ['mcp', 'serve'] } }]);
  assert.deepEqual(headroom.plan('claude', { state: 'absent' }), []);
});

test('verify: ok, warn (binary gone), fail (malformed or missing entry), nothing when config unreadable', () => {
  const { base, ctx, cleanup } = project();
  try {
    const real = fakeBin(join(base, 'bin'), 'headroom');
    const v = (configured: Record<string, unknown> | null) => headroom.verify('claude', ctx, { state: 'present', binPath: real }, configured);
    assert.deepEqual(v({ headroom: { command: real, args: ['mcp', 'serve'] } }).map((c) => [c.ok, !!c.warn]), [[true, false]]);
    const gone = v({ headroom: { command: '/no/such/headroom', args: ['mcp', 'serve'] } });
    assert.deepEqual([gone[0].ok, gone[0].warn], [true, true]);
    assert.match(gone[0].detail, /uv tool install/);
    assert.equal(v({ headroom: { command: 5 } })[0].ok, false);
    assert.equal(v({ headroom: 'x' })[0].ok, false);
    assert.equal(v({})[0].ok, false);
    assert.deepEqual(v(null), []);
  } finally {
    cleanup();
  }
});

test('verify: a kept user-owned entry without args is not malformed; non-object or non-string command still fails', () => {
  const { ctx, cleanup } = project();
  try {
    const v = (configured: Record<string, unknown>) => headroom.verify('claude', ctx, { state: 'present', binPath: '/x/headroom' }, configured);
    const [custom] = v({ headroom: { command: 'custom' } });
    assert.equal(custom.ok, true);
    assert.equal(custom.warn, true, 'the command "custom" does not exist as a path, so it warns');
    assert.equal(v({ headroom: { command: 'custom', args: 'x' } })[0].ok, false);
    assert.equal(v({ headroom: { command: 5 } })[0].ok, false);
    assert.equal(v({ headroom: 'x' })[0].ok, false);
  } finally {
    cleanup();
  }
});

test('verify: a missing entry warns when headroom is not installed here, fails when it is installed', () => {
  const { ctx, cleanup } = project();
  try {
    const absent = headroom.verify('codex', ctx, { state: 'absent' }, {});
    assert.deepEqual([absent[0].ok, absent[0].warn], [true, true]);
    assert.match(absent[0].detail, /not installed on this machine/);
    assert.match(absent[0].detail, /uv tool install/);
    assert.match(absent[0].detail, /dev-agent install --with headroom/);
    const present = headroom.verify('codex', ctx, { state: 'present', binPath: '/x/headroom' }, {});
    assert.equal(present[0].ok, false);
  } finally {
    cleanup();
  }
});

test('notes: not-found hint when absent; host-aware path hint when present', () => {
  const [hint] = headroom.notes('claude', { state: 'absent' });
  assert.match(hint, /headroom: not found on PATH/);
  assert.match(hint, /uv tool install/);
  assert.match(hint, /re-run install --with headroom \(the kit does not install it\)/);
  const present = { state: 'present', binPath: '/abs/headroom' } as const;
  assert.match(headroom.notes('claude', present)[0], /remove the headroom entry from \.mcp\.json, then re-run install --with headroom/);
  const codex = headroom.notes('codex', present)[0];
  assert.match(codex, /re-run install --with headroom/);
  assert.doesNotMatch(codex, /\.mcp\.json/);
});

test('verify: binary-gone warn is host-aware', () => {
  const { ctx, cleanup } = project();
  try {
    const entry = { headroom: { command: '/no/such/headroom', args: ['mcp', 'serve'] } };
    const det = { state: 'present', binPath: '/x' } as const;
    assert.match(headroom.verify('claude', ctx, det, entry)[0].detail, /remove the headroom entry from \.mcp\.json, then re-run install --with headroom/);
    const codex = headroom.verify('codex', ctx, det, entry)[0].detail;
    assert.match(codex, /then re-run install --with headroom/);
    assert.doesNotMatch(codex, /\.mcp\.json/);
  } finally {
    cleanup();
  }
});

test('install --with headroom: both hosts get the entry, a second run adds no duplicate, plain re-install keeps it (sticky)', async () => {
  const { base, projectRoot, homeDir, cleanup } = project();
  const binDir = join(base, 'bin');
  const bin = fakeBin(binDir, 'headroom');
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(l), env: { PATH: binDir, CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    assert.equal(await run(['install', '--all', '--with', 'headroom', '--with', 'headroom', '--project', projectRoot], io), 0, out.join('\n'));
    const claudeJson = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
    assert.deepEqual(claudeJson.mcpServers.headroom, { type: 'stdio', command: bin, args: ['mcp', 'serve'] });
    const toml = parse(readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8')) as { mcp_servers: Record<string, unknown> };
    assert.deepEqual(JSON.parse(JSON.stringify(toml.mcp_servers.headroom)), { command: bin, args: ['mcp', 'serve'] });
    const before = readFileSync(join(projectRoot, '.mcp.json'), 'utf8');
    assert.equal(await run(['install', '--all', '--project', projectRoot], io), 0);
    assert.equal(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'), before);
    assert.match(readFileSync(join(projectRoot, '.dev-agent', 'integrations.json'), 'utf8'), /headroom/);
  } finally {
    cleanup();
  }
});

test('install --with headroom without the binary exits 1 with the install command and writes nothing', async () => {
  const { projectRoot, base, homeDir, cleanup } = project();
  const err: string[] = [];
  const io: CliIo = { stdout: () => {}, stderr: (l) => err.push(l), env: { PATH: '', CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    assert.equal(await run(['install', 'claude', '--with', 'headroom', '--project', projectRoot], io), 1);
    assert.match(err.join('\n'), /uv tool install/);
    assert.throws(() => readFileSync(join(projectRoot, '.mcp.json')));
  } finally {
    cleanup();
  }
});

test('a pre-existing different headroom entry is kept and reported, in both hosts', async () => {
  const { base, projectRoot, ctx, cleanup } = project();
  try {
    const bin = fakeBin(join(base, 'bin'), 'headroom');
    const extra = headroom.plan('claude', { state: 'present', binPath: bin });
    writeFileSync(join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: { headroom: { command: 'custom' } } }));
    const actions = await new ClaudeCodeAdapter(ctx).installMcp({ kitRoot: ctx.kitRoot, projectRoot, extraServers: extra });
    assert.deepEqual(JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8')).mcpServers.headroom, { command: 'custom' });
    assert.ok(actions.some((a) => /headroom.*already configured.*kept/.test(a)));

    mkdirSync(join(projectRoot, '.codex'));
    writeFileSync(join(projectRoot, '.codex', 'config.toml'), '[mcp_servers.headroom]\ncommand = "custom"\n');
    const codexActions = await new CodexAdapter(ctx).installMcp({ kitRoot: ctx.kitRoot, projectRoot, extraServers: headroom.plan('codex', { state: 'present', binPath: bin }) });
    assert.ok(codexActions.some((a) => /headroom.*already configured.*kept/.test(a)));
    assert.match(readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8'), /command = "custom"/);
  } finally {
    cleanup();
  }
});
