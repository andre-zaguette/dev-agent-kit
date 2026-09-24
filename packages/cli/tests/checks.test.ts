import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSkills, checkInstructions, checkLaunchConfig, probeServer, EXPECTED_TOOLS } from '../src/checks.ts';
import { kitServerLaunch } from '../src/mcp-launch.ts';
import { syncSkills } from '../src/sync-skills.ts';
import { upsertMarkdownBlock } from '../src/managed-block.ts';
import { findKitRoot } from '../src/util.ts';

function withDir(fn: (dir: string) => Promise<void> | void) {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-checks-'));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('checkSkills passes after a sync and fails when a managed file goes missing or nothing is installed', async () => {
  await withDir((dir) => {
    const kitRoot = findKitRoot();
    const target = join(dir, '.claude', 'skills');
    assert.equal(checkSkills(target, join(kitRoot, 'skills')).ok, false);
    syncSkills(join(kitRoot, 'skills'), target, { kitVersion: '0.4.0' });
    const ok = checkSkills(target, join(kitRoot, 'skills'));
    assert.equal(ok.ok, true, ok.detail);
    rmSync(join(target, 'figma-to-code', 'SKILL.md'));
    const missing = checkSkills(target, join(kitRoot, 'skills'));
    assert.equal(missing.ok, false);
    assert.match(missing.detail, /figma-to-code\/SKILL\.md/);
  });
});

test('checkInstructions requires the managed block', async () => {
  await withDir((dir) => {
    const file = join(dir, 'CLAUDE.md');
    assert.equal(checkInstructions(file).ok, false);
    upsertMarkdownBlock(file, 'rules', dir);
    assert.equal(checkInstructions(file).ok, true);
  });
});

test('checkInstructions surfaces a parse error instead of "run install" when the file is malformed', async () => {
  await withDir((dir) => {
    const file = join(dir, 'CLAUDE.md');
    writeFileSync(file, '```\nunclosed fence\n');
    const result = checkInstructions(file);
    assert.equal(result.ok, false);
    assert.match(result.detail, /unclosed code fence/);
  });
});

test('checkLaunchConfig verifies the entry exists, its command exists and it points at this project', async () => {
  await withDir((dir) => {
    const launch = kitServerLaunch({ kitRoot: findKitRoot(), projectRoot: dir, includeFigma: false });
    assert.equal(checkLaunchConfig(launch, dir, '.mcp.json').ok, true);
    assert.equal(checkLaunchConfig(null, dir, '.mcp.json').ok, false);
    assert.match(checkLaunchConfig({ ...launch, command: '/nonexistent/tsx' }, dir, '.mcp.json').detail, /does not exist/);
    assert.match(checkLaunchConfig({ ...launch, env: { FRONTEND_AGENT_PROJECT_ROOT: '/elsewhere' } }, dir, '.mcp.json').detail, /FRONTEND_AGENT_PROJECT_ROOT/);
  });
});

test('probeServer starts the real kit MCP server and sees all five tools', async () => {
  await withDir(async (dir) => {
    mkdirSync(join(dir, '.frontend-agent'));
    writeFileSync(join(dir, '.frontend-agent', 'config.yml'), 'validationProfile: standard\n');
    const result = await probeServer(kitServerLaunch({ kitRoot: findKitRoot(), projectRoot: dir, includeFigma: false }));
    assert.equal(result.ok, true, result.detail);
    for (const tool of EXPECTED_TOOLS) assert.match(result.detail, new RegExp(tool));
  });
});

test('probeServer reports a command that cannot start, and times out on a server that never answers', async () => {
  const missing = await probeServer({ command: '/nonexistent/binary', args: [], env: {} });
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /could not start/);
  const silent = await probeServer({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: {} }, 1000);
  assert.equal(silent.ok, false);
  assert.match(silent.detail, /timed out/);
});

test('probeServer drains chatty stderr and exits promptly', async () => {
  const code = 'const s = "x".repeat(500); setInterval(() => process.stderr.write(s), 1);';
  const result = await probeServer({ command: process.execPath, args: ['-e', code], env: {} }, 1000);
  assert.equal(result.ok, false);
  assert.match(result.detail, /timed out/);
  assert.match(result.detail, /server stderr \(tail\)/);
});

test('probeServer reports server that exits with stderr', async () => {
  const code = 'process.stderr.write("boom\\n"); process.exit(1);';
  const result = await probeServer({ command: process.execPath, args: ['-e', code], env: {} });
  assert.equal(result.ok, false);
  assert.match(result.detail, /exited during startup|could not start/);
  assert.match(result.detail, /boom/);
});

test('checkLaunchConfig accepts trailing slash in FRONTEND_AGENT_PROJECT_ROOT', async () => {
  await withDir((dir) => {
    const launch = kitServerLaunch({ kitRoot: findKitRoot(), projectRoot: dir, includeFigma: false });
    const launchWithTrailingSlash = {
      ...launch,
      env: { FRONTEND_AGENT_PROJECT_ROOT: dir.endsWith('/') ? dir : dir + '/' }
    };
    assert.equal(checkLaunchConfig(launchWithTrailingSlash, dir, '.mcp.json').ok, true);
  });
});

test('checkSkills reports kit files newer than the installed copy, and accepts local edits with a note', async () => {
  await withDir((dir) => {
    const source = join(dir, 'kit-skills');
    mkdirSync(join(source, 'demo'), { recursive: true });
    writeFileSync(join(source, 'demo', 'SKILL.md'), 'v1\n');
    const target = join(dir, 'installed');
    syncSkills(source, target, { kitVersion: '0.5.0' });
    assert.equal(checkSkills(target, source).ok, true);

    writeFileSync(join(source, 'demo', 'SKILL.md'), 'v2\n');
    const outdated = checkSkills(target, source);
    assert.equal(outdated.ok, false);
    assert.match(outdated.detail, /outdated.*demo\/SKILL\.md.*run install/);

    writeFileSync(join(source, 'demo', 'extra.md'), 'new file\n');
    assert.match(checkSkills(target, source).detail, /demo\/extra\.md/);
    rmSync(join(source, 'demo', 'extra.md'));

    writeFileSync(join(target, 'demo', 'SKILL.md'), 'my edit\n');
    const edited = checkSkills(target, source);
    assert.equal(edited.ok, true, edited.detail);
    assert.match(edited.detail, /locally edited.*demo\/SKILL\.md/);
  });
});

test('checkSkills reports a skill added to the kit that was never installed at all', async () => {
  await withDir((dir) => {
    const source = join(dir, 'kit-skills');
    mkdirSync(join(source, 'demo'), { recursive: true });
    writeFileSync(join(source, 'demo', 'SKILL.md'), 'v1\n');
    const target = join(dir, 'installed');
    syncSkills(source, target, { kitVersion: '0.5.0' });
    assert.equal(checkSkills(target, source).ok, true);

    mkdirSync(join(source, 'new-skill'), { recursive: true });
    writeFileSync(join(source, 'new-skill', 'SKILL.md'), 'brand new\n');
    const withNewSkill = checkSkills(target, source);
    assert.equal(withNewSkill.ok, false);
    assert.match(withNewSkill.detail, /outdated.*new-skill\/SKILL\.md.*run install/);
  });
});

test('checkSkills does not fail for a new kit skill shadowed by a user-owned skill, but notes it', async () => {
  await withDir((dir) => {
    const source = join(dir, 'kit-skills');
    mkdirSync(join(source, 'demo'), { recursive: true });
    writeFileSync(join(source, 'demo', 'SKILL.md'), 'v1\n');
    const target = join(dir, 'installed');
    syncSkills(source, target, { kitVersion: '0.6.0' });

    mkdirSync(join(source, 'verification'), { recursive: true });
    writeFileSync(join(source, 'verification', 'SKILL.md'), 'kit version\n');
    mkdirSync(join(target, 'verification'), { recursive: true });
    writeFileSync(join(target, 'verification', 'SKILL.md'), 'user-owned\n');
    syncSkills(source, target, { kitVersion: '0.6.0' });

    const result = checkSkills(target, source);
    assert.equal(result.ok, true, result.detail);
    assert.match(result.detail, /user-owned skill `verification` shadows the kit's/);

    // A genuinely new, uninstalled kit skill (no shadowing directory) still fails.
    mkdirSync(join(source, 'other'), { recursive: true });
    writeFileSync(join(source, 'other', 'SKILL.md'), 'x\n');
    const stillFails = checkSkills(target, source);
    assert.equal(stillFails.ok, false);
    assert.match(stillFails.detail, /other\/SKILL\.md/);
  });
});
