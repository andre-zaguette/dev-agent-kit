// packages/cli/tests/cursor-adapter.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { CursorAdapter } from '../src/adapters/cursor.ts';
import { CodexAdapter } from '../src/adapters/codex.ts';
import { ClaudeCodeAdapter } from '../src/adapters/claude.ts';
import { figmaServers, fakeBin, project } from './integration-helpers.ts';

const noExtras = (ctx: { kitRoot: string; projectRoot: string }) => ({ kitRoot: ctx.kitRoot, projectRoot: ctx.projectRoot, extraServers: [] });

test('detect: ~/.cursor, or cursor on PATH, otherwise false', async () => {
  const { base, homeDir, ctx, cleanup } = project();
  try {
    assert.equal(await new CursorAdapter(ctx).detect(), false);
    mkdirSync(join(homeDir, '.cursor'));
    assert.equal(await new CursorAdapter(ctx).detect(), true);
  } finally {
    cleanup();
  }
  const second = project();
  try {
    fakeBin(join(second.base, 'bin'), 'cursor');
    assert.equal(await new CursorAdapter({ ...second.ctx, env: { PATH: join(second.base, 'bin') } }).detect(), true);
  } finally {
    second.cleanup();
  }
});

test('skills and instructions go to the Codex locations: .agents/skills and the AGENTS.md block', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const adapter = new CursorAdapter(ctx);
    const report = await adapter.installSkills(join(ctx.kitRoot, 'skills'));
    assert.ok(report.added.includes('figma-to-code/SKILL.md'));
    assert.ok(existsSync(join(projectRoot, '.agents', 'skills', 'visual-validation', 'SKILL.md')));
    assert.equal(existsSync(join(projectRoot, '.claude')), false);
    assert.equal(await adapter.installInstructions(), 'created');
    const agents = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
    assert.match(agents, /\.agents\/skills\//);
    assert.equal(existsSync(join(projectRoot, 'CLAUDE.md')), false);
  } finally {
    cleanup();
  }
});

test('installMcp creates .cursor/mcp.json with the kit server (stdio, typed) and the extras', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const actions = await new CursorAdapter(ctx).installMcp({ ...noExtras(ctx), extraServers: figmaServers('cursor') });
    const file = join(projectRoot, '.cursor', 'mcp.json');
    const json = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(json.mcpServers['frontend-agent'].type, 'stdio');
    assert.equal(json.mcpServers['frontend-agent'].env.FRONTEND_AGENT_PROJECT_ROOT, projectRoot);
    assert.deepEqual(json.mcpServers.figma, { url: 'https://mcp.figma.com/mcp' });
    assert.ok(actions[0].startsWith('frontend-agent MCP server registered in'));
    assert.ok(actions.some((a) => /figma MCP server registered in/.test(a)));
  } finally {
    cleanup();
  }
});

test('installMcp keeps the user servers and a same-name user entry, and a second run is idempotent', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    mkdirSync(join(projectRoot, '.cursor'));
    const file = join(projectRoot, '.cursor', 'mcp.json');
    writeFileSync(file, JSON.stringify({ topLevel: 1, mcpServers: { mine: { command: 'x' }, figma: { url: 'https://custom' } } }));
    const adapter = new CursorAdapter(ctx);
    const actions = await adapter.installMcp({ ...noExtras(ctx), extraServers: figmaServers('cursor') });
    const json = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(json.topLevel, 1);
    assert.deepEqual(json.mcpServers.mine, { command: 'x' });
    assert.equal(json.mcpServers.figma.url, 'https://custom');
    assert.ok(actions.some((a) => /figma.*already configured.*kept/.test(a)));
    const first = readFileSync(file, 'utf8');
    await adapter.installMcp({ ...noExtras(ctx), extraServers: figmaServers('cursor') });
    assert.equal(readFileSync(file, 'utf8'), first);
  } finally {
    cleanup();
  }
});

test('preflight refuses unparsable JSON and a non-object mcpServers, and writes nothing', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    mkdirSync(join(projectRoot, '.cursor'));
    const file = join(projectRoot, '.cursor', 'mcp.json');
    writeFileSync(file, '{nope');
    await assert.rejects(() => new CursorAdapter(ctx).preflight(noExtras(ctx)), /cannot parse .*mcp\.json/);
    writeFileSync(file, '{"mcpServers":[]}');
    await assert.rejects(() => new CursorAdapter(ctx).preflight(noExtras(ctx)), /"mcpServers" in .* must be an object/);
    assert.equal(existsSync(join(projectRoot, '.agents')), false);
    assert.equal(existsSync(join(projectRoot, 'AGENTS.md')), false);
  } finally {
    cleanup();
  }
});

test('preflight on a clean project writes nothing (no .cursor, no skills)', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    await new CursorAdapter(ctx).preflight(noExtras(ctx));
    assert.equal(existsSync(join(projectRoot, '.cursor')), false);
    assert.equal(existsSync(join(projectRoot, '.agents')), false);
  } finally {
    cleanup();
  }
});

test('a .cursor symlink pointing outside the project, or a regular file named .cursor, is refused', async () => {
  const { base, projectRoot, ctx, cleanup } = project();
  try {
    const outside = join(base, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(projectRoot, '.cursor'));
    await assert.rejects(() => new CursorAdapter(ctx).preflight(noExtras(ctx)));
    await assert.rejects(() => new CursorAdapter(ctx).installMcp(noExtras(ctx)));
    assert.equal(existsSync(join(outside, 'mcp.json')), false);
  } finally {
    cleanup();
  }
  const second = project();
  try {
    writeFileSync(join(second.projectRoot, '.cursor'), 'not a directory');
    await assert.rejects(() => new CursorAdapter(second.ctx).preflight(noExtras(second.ctx)));
    await assert.rejects(() => new CursorAdapter(second.ctx).installMcp(noExtras(second.ctx)));
    assert.equal(lstatSync(join(second.projectRoot, '.cursor')).isFile(), true);
    assert.equal(readFileSync(join(second.projectRoot, '.cursor'), 'utf8'), 'not a directory');
  } finally {
    second.cleanup();
  }
});

test('sharing with Codex: either order, repeated, leaves one AGENTS.md block and an unchanged skills manifest', async () => {
  for (const order of [['codex', 'cursor'], ['cursor', 'codex']] as const) {
    const { projectRoot, ctx, cleanup } = project();
    try {
      const skills = join(ctx.kitRoot, 'skills');
      const hosts = { codex: new CodexAdapter(ctx), cursor: new CursorAdapter(ctx) };
      for (const name of order) {
        await hosts[name].installSkills(skills);
        await hosts[name].installInstructions();
      }
      const agents = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
      const manifest = readFileSync(join(projectRoot, '.agents', 'skills', '.frontend-agent-kit-manifest.json'), 'utf8');
      assert.equal(agents.split('Dev Agent Kit repository instructions').length - 1, 1, `block duplicated for ${order.join('→')}`);
      for (const name of [...order].reverse()) {
        const report = await hosts[name].installSkills(skills);
        assert.deepEqual([report.added, report.updated, report.removed].map((l) => l.length), [0, 0, 0]);
        assert.equal(await hosts[name].installInstructions(), 'unchanged');
      }
      assert.equal(readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8'), agents);
      assert.equal(readFileSync(join(projectRoot, '.agents', 'skills', '.frontend-agent-kit-manifest.json'), 'utf8'), manifest);
    } finally {
      cleanup();
    }
  }
});

test('CLAUDE.md symlinked to AGENTS.md: claude then cursor keeps both texts, once each, and is stable', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    writeFileSync(join(projectRoot, 'AGENTS.md'), '# mine\n');
    symlinkSync('AGENTS.md', join(projectRoot, 'CLAUDE.md'));
    await new ClaudeCodeAdapter(ctx).installInstructions();
    await new CursorAdapter(ctx).installInstructions();
    const text = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
    assert.ok(text.startsWith('# mine\n'));
    assert.equal(text.split('Dev Agent Kit repository instructions').length - 1, 1);
    assert.equal(text.split('Use the skills installed in `.claude/skills/`').length - 1, 1);
    const before = text;
    await new CursorAdapter(ctx).installInstructions();
    await new ClaudeCodeAdapter(ctx).installInstructions();
    assert.equal(readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8'), before);
  } finally {
    cleanup();
  }
});

test('verify: all ok after a full install; a missing server entry fails mcp-config and skips the probe', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const adapter = new CursorAdapter(ctx);
    await adapter.installSkills(join(ctx.kitRoot, 'skills'));
    await adapter.installInstructions();
    await adapter.installMcp(noExtras(ctx));
    const good = await adapter.verify();
    assert.equal(good.ok, true, JSON.stringify(good.checks));
    assert.deepEqual(good.checks.map((c) => c.name), ['skills', 'instructions', 'mcp-config', 'mcp-server']);
    writeFileSync(join(projectRoot, '.cursor', 'mcp.json'), '{"mcpServers":{}}');
    const bad = await adapter.verify();
    assert.equal(bad.ok, false);
    assert.equal(bad.checks.find((c) => c.name === 'mcp-config')?.ok, false);
    assert.match(bad.checks.find((c) => c.name === 'mcp-server')?.detail ?? '', /skipped/);
  } finally {
    cleanup();
  }
});

test('verify: missing skills fails the skills check while instructions and mcp stay ok', async () => {
  const { ctx, cleanup } = project();
  try {
    const adapter = new CursorAdapter(ctx);
    await adapter.installInstructions();
    await adapter.installMcp(noExtras(ctx));
    const r = await adapter.verify();
    assert.equal(r.ok, false);
    assert.equal(r.checks.find((c) => c.name === 'skills')?.ok, false);
    assert.equal(r.checks.find((c) => c.name === 'instructions')?.ok, true);
    assert.equal(r.checks.find((c) => c.name === 'mcp-config')?.ok, true);
  } finally {
    cleanup();
  }
});

test('verify: broken JSON in .cursor/mcp.json fails mcp-config with the parse error and skips mcp-server', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const adapter = new CursorAdapter(ctx);
    await adapter.installSkills(join(ctx.kitRoot, 'skills'));
    await adapter.installInstructions();
    await adapter.installMcp(noExtras(ctx));
    writeFileSync(join(projectRoot, '.cursor', 'mcp.json'), '{nope');
    const r = await adapter.verify();
    assert.equal(r.ok, false);
    const cfg = r.checks.find((c) => c.name === 'mcp-config');
    assert.equal(cfg?.ok, false);
    assert.match(cfg?.detail ?? '', /cannot parse/);
    assert.match(r.checks.find((c) => c.name === 'mcp-server')?.detail ?? '', /skipped/);
  } finally {
    cleanup();
  }
});

test('configuredServers: {} without a file, the servers with one, null when unparsable', async () => {
  const { projectRoot, ctx, cleanup } = project();
  try {
    const adapter = new CursorAdapter(ctx);
    assert.deepEqual(adapter.configuredServers(), {});
    await adapter.installMcp(noExtras(ctx));
    assert.deepEqual(Object.keys(adapter.configuredServers()!), ['frontend-agent']);
    writeFileSync(join(projectRoot, '.cursor', 'mcp.json'), '{nope');
    assert.equal(adapter.configuredServers(), null);
  } finally {
    cleanup();
  }
});

test('notes mention .cursor/mcp.json absolute paths and the shared skills', () => {
  const { ctx, cleanup } = project();
  try {
    const notes = new CursorAdapter(ctx).notes().join(' ');
    assert.match(notes, /\.cursor\/mcp\.json/);
    assert.match(notes, /absolute paths/);
    assert.match(notes, /\.agents\/skills/);
  } finally {
    cleanup();
  }
});
