import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeAdapter } from '../src/adapters/claude.ts';
import { findKitRoot } from '../src/util.ts';
import type { AdapterContext } from '../src/types.ts';

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'frontend-agent-claude-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  const kitRoot = findKitRoot();
  const ctx: AdapterContext = { projectRoot, kitRoot, kitVersion: '0.4.0', env: { PATH: '' }, homeDir, force: false };
  return { base, projectRoot, homeDir, kitRoot, ctx, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('detect is true when claude is on PATH or ~/.claude exists, false otherwise', async () => {
  const { homeDir, ctx, cleanup } = setup();
  try {
    assert.equal(await new ClaudeCodeAdapter(ctx).detect(), false);
    mkdirSync(join(homeDir, '.claude'));
    assert.equal(await new ClaudeCodeAdapter(ctx).detect(), true);
  } finally {
    cleanup();
  }
});

test('installSkills and installInstructions target .claude/skills and CLAUDE.md', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    const adapter = new ClaudeCodeAdapter(ctx);
    const report = await adapter.installSkills(join(kitRoot, 'skills'));
    assert.ok(report.added.includes('figma-to-code/SKILL.md'));
    assert.ok(existsSync(join(projectRoot, '.claude', 'skills', 'visual-validation', 'SKILL.md')));
    assert.equal(await adapter.installInstructions(), 'created');
    assert.match(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8'), /Figma as the design source of truth/);
  } finally {
    cleanup();
  }
});

test('installMcp merges into an existing .mcp.json, keeping other servers and an existing figma entry', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    writeFileSync(
      join(projectRoot, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'x' }, figma: { type: 'http', url: 'https://custom' } } })
    );
    const actions = await new ClaudeCodeAdapter(ctx).installMcp({ kitRoot, projectRoot, includeFigma: true });
    const config = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
    assert.deepEqual(config.mcpServers.other, { command: 'x' });
    assert.equal(config.mcpServers.figma.url, 'https://custom');
    assert.deepEqual(config.mcpServers['frontend-agent'], {
      type: 'stdio',
      command: join(kitRoot, 'node_modules', '.bin', 'tsx'),
      args: [join(kitRoot, 'packages', 'mcp-server', 'src', 'index.ts')],
      env: { FRONTEND_AGENT_PROJECT_ROOT: projectRoot }
    });
    assert.ok(actions.some((a) => /frontend-agent/.test(a)));
    assert.ok(actions.some((a) => /figma.*kept/.test(a)));
  } finally {
    cleanup();
  }
});

test('installMcp adds figma when missing, and refuses to touch an unparseable .mcp.json', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    await new ClaudeCodeAdapter(ctx).installMcp({ kitRoot, projectRoot, includeFigma: true });
    const config = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'));
    assert.deepEqual(config.mcpServers.figma, { type: 'http', url: 'https://mcp.figma.com/mcp' });
    writeFileSync(join(projectRoot, '.mcp.json'), '{ broken');
    await assert.rejects(
      () => new ClaudeCodeAdapter(ctx).installMcp({ kitRoot, projectRoot, includeFigma: true }),
      /\.mcp\.json/
    );
    assert.equal(readFileSync(join(projectRoot, '.mcp.json'), 'utf8'), '{ broken');
  } finally {
    cleanup();
  }
});

test('verify passes after a full install (including a live server probe) and fails before it', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    const adapter = new ClaudeCodeAdapter(ctx);
    const before = await adapter.verify();
    assert.equal(before.ok, false);
    await adapter.installSkills(join(kitRoot, 'skills'));
    await adapter.installInstructions();
    await adapter.installMcp({ kitRoot, projectRoot, includeFigma: true });
    const after = await adapter.verify();
    assert.equal(after.ok, true, JSON.stringify(after.checks, null, 2));
    assert.deepEqual(after.checks.map((c) => c.name), ['skills', 'instructions', 'mcp-config', 'mcp-server']);
  } finally {
    cleanup();
  }
});

test('verify reports a corrupt .mcp.json as a parse error, not "run install"', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    const adapter = new ClaudeCodeAdapter(ctx);
    await adapter.installSkills(join(kitRoot, 'skills'));
    await adapter.installInstructions();
    await adapter.installMcp({ kitRoot, projectRoot, includeFigma: true });
    writeFileSync(join(projectRoot, '.mcp.json'), '{ broken');
    const result = await adapter.verify();
    assert.equal(result.ok, false);
    const mcpConfig = result.checks.find((c) => c.name === 'mcp-config');
    assert.ok(mcpConfig);
    assert.match(mcpConfig!.detail, /cannot parse .*\.mcp\.json/);
    assert.doesNotMatch(mcpConfig!.detail, /run install/);
  } finally {
    cleanup();
  }
});

test('installMcp refuses a .mcp.json symlinked outside the project root, leaving the outside file untouched', async () => {
  const { base, projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    const outsideFile = join(base, 'outside.json');
    const outsideContent = '{ "not": "managed" }';
    writeFileSync(outsideFile, outsideContent);
    try {
      symlinkSync(outsideFile, join(projectRoot, '.mcp.json'));
    } catch {
      // symlink creation unsupported in this environment — skip
      return;
    }
    await assert.rejects(
      () => new ClaudeCodeAdapter(ctx).installMcp({ kitRoot, projectRoot, includeFigma: true }),
      /outside the project root|dangling/
    );
    assert.equal(readFileSync(outsideFile, 'utf8'), outsideContent);
  } finally {
    cleanup();
  }
});

test('installSkills refuses when .claude/skills is symlinked to a directory outside the project root', async () => {
  const { base, projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    const outsideDir = join(base, 'outside-skills');
    mkdirSync(outsideDir);
    mkdirSync(join(projectRoot, '.claude'));
    try {
      symlinkSync(outsideDir, join(projectRoot, '.claude', 'skills'));
    } catch {
      cleanup();
      return;
    }
    await assert.rejects(
      () => new ClaudeCodeAdapter(ctx).installSkills(join(kitRoot, 'skills')),
      /resolves outside the project root/
    );
    assert.equal(existsSync(join(outsideDir, 'figma-to-code')), false);
  } finally {
    cleanup();
  }
});
