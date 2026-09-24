import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { CodexAdapter, TOML_BLOCK_START, TOML_BLOCK_END } from '../src/adapters/codex.ts';
import { findKitRoot } from '../src/util.ts';
import type { AdapterContext } from '../src/types.ts';

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'frontend-agent-codex-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  const codexHome = join(base, 'codex-home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  const kitRoot = findKitRoot();
  const ctx: AdapterContext = { projectRoot, kitRoot, kitVersion: '0.4.0', env: { PATH: '', CODEX_HOME: codexHome }, homeDir, force: false };
  return { base, projectRoot, homeDir, codexHome, kitRoot, ctx, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function trust(codexHome: string, projectRoot: string) {
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, 'config.toml'), `[projects."${projectRoot}"]\ntrust_level = "trusted"\n`);
}

test('detect honours CODEX_HOME and PATH', async () => {
  const { codexHome, ctx, cleanup } = setup();
  try {
    assert.equal(await new CodexAdapter(ctx).detect(), false);
    mkdirSync(codexHome);
    assert.equal(await new CodexAdapter(ctx).detect(), true);
  } finally {
    cleanup();
  }
});

test('installSkills and installInstructions target .agents/skills and AGENTS.md', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    const adapter = new CodexAdapter(ctx);
    await adapter.installSkills(join(kitRoot, 'skills'));
    assert.ok(existsSync(join(projectRoot, '.agents', 'skills', 'figma-to-code', 'SKILL.md')));
    assert.equal(await adapter.installInstructions(), 'created');
    assert.match(readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8'), /figma-to-code/);
  } finally {
    cleanup();
  }
});

test('installMcp writes a managed block to .codex/config.toml, preserving user content and comments, idempotently', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    mkdirSync(join(projectRoot, '.codex'));
    const userToml = '# my settings\nmodel = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n';
    writeFileSync(join(projectRoot, '.codex', 'config.toml'), userToml);
    const adapter = new CodexAdapter(ctx);
    await adapter.installMcp({ kitRoot, projectRoot, includeFigma: true });
    const first = readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8');
    assert.ok(first.startsWith(userToml.trimEnd()));
    assert.ok(first.includes(TOML_BLOCK_START) && first.includes(TOML_BLOCK_END));
    const parsed = parse(first) as any;
    assert.equal(parsed.model, 'o3');
    assert.equal(parsed.mcp_servers.other.command, 'x');
    assert.equal(parsed.mcp_servers['frontend-agent'].command, join(kitRoot, 'node_modules', '.bin', 'tsx'));
    assert.equal(parsed.mcp_servers['frontend-agent'].env.FRONTEND_AGENT_PROJECT_ROOT, projectRoot);
    assert.equal(parsed.mcp_servers.figma.url, 'https://mcp.figma.com/mcp');
    await adapter.installMcp({ kitRoot, projectRoot, includeFigma: true });
    assert.equal(readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8'), first);
  } finally {
    cleanup();
  }
});

test('installMcp refuses an unparseable config and a user-defined frontend-agent table, leaving the file untouched', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    mkdirSync(join(projectRoot, '.codex'));
    const file = join(projectRoot, '.codex', 'config.toml');
    writeFileSync(file, 'model = \n');
    await assert.rejects(() => new CodexAdapter(ctx).installMcp({ kitRoot, projectRoot, includeFigma: true }), /config\.toml/);
    assert.equal(readFileSync(file, 'utf8'), 'model = \n');
    writeFileSync(file, '[mcp_servers.frontend-agent]\ncommand = "mine"\n');
    await assert.rejects(
      () => new CodexAdapter(ctx).installMcp({ kitRoot, projectRoot, includeFigma: false }),
      /already defines \[mcp_servers\.frontend-agent\]/
    );
  } finally {
    cleanup();
  }
});

test('a legacy end marker ("# <<< frontend-agent-kit") is still recognized as the existing block on re-install', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    mkdirSync(join(projectRoot, '.codex'));
    const legacyEnd = '# <<< frontend-agent-kit';
    const legacyToml = `# my settings\nmodel = "o3"\n\n${TOML_BLOCK_START}\n[mcp_servers.frontend-agent]\ncommand = "old"\n${legacyEnd}\n`;
    writeFileSync(join(projectRoot, '.codex', 'config.toml'), legacyToml);
    const adapter = new CodexAdapter(ctx);
    await adapter.installMcp({ kitRoot, projectRoot, includeFigma: false });
    const next = readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8');
    // Exactly one block remains (the legacy block was replaced, not duplicated), using the new end marker.
    assert.equal(next.split(TOML_BLOCK_START).length - 1, 1);
    assert.equal(next.split(legacyEnd).length - 1, 1, 'no leftover legacy end marker');
    assert.ok(next.includes(TOML_BLOCK_END));
    const parsed = parse(next) as any;
    assert.equal(parsed.model, 'o3');
    assert.equal(parsed.mcp_servers['frontend-agent'].command, join(kitRoot, 'node_modules', '.bin', 'tsx'));
  } finally {
    cleanup();
  }
});

test('settings appended below the block that would merge into it are refused, and the file is left untouched', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    mkdirSync(join(projectRoot, '.codex'));
    const adapter = new CodexAdapter(ctx);
    await adapter.installMcp({ kitRoot, projectRoot, includeFigma: false });
    const file = join(projectRoot, '.codex', 'config.toml');
    const installed = readFileSync(file, 'utf8');
    // Append a setting right after the block that TOML would merge into mcp_servers.frontend-agent.
    const tampered = `${installed}approval_policy = "never"\n`;
    writeFileSync(file, tampered);
    await assert.rejects(
      () => adapter.installMcp({ kitRoot, projectRoot, includeFigma: false }),
      /settings were added below the frontend-agent-kit block .* and would merge into it/
    );
    assert.equal(readFileSync(file, 'utf8'), tampered, 'file left untouched');
  } finally {
    cleanup();
  }
});

test('a user mcp_servers inline table that breaks once the block is added is reported clearly', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    mkdirSync(join(projectRoot, '.codex'));
    const file = join(projectRoot, '.codex', 'config.toml');
    const original = 'mcp_servers = { other = { command = "x" } }\n';
    writeFileSync(file, original);
    await assert.rejects(
      () => new CodexAdapter(ctx).installMcp({ kitRoot, projectRoot, includeFigma: false }),
      /cannot add the frontend-agent-kit block to .*config\.toml \(does it define mcp_servers as an inline table\?\)/
    );
    assert.equal(readFileSync(file, 'utf8'), original, 'file left untouched');
  } finally {
    cleanup();
  }
});

test('verify fails with an actionable trust message until the project is trusted, then passes', async () => {
  const { projectRoot, codexHome, kitRoot, ctx, cleanup } = setup();
  try {
    const adapter = new CodexAdapter(ctx);
    await adapter.installSkills(join(kitRoot, 'skills'));
    await adapter.installInstructions();
    await adapter.installMcp({ kitRoot, projectRoot, includeFigma: false });
    const untrusted = await adapter.verify();
    assert.equal(untrusted.ok, false);
    const trustCheck = untrusted.checks.find((c) => c.name === 'codex-trust')!;
    assert.equal(trustCheck.ok, false);
    assert.match(trustCheck.detail, /trust/);
    trust(codexHome, projectRoot);
    const trusted = await adapter.verify();
    assert.equal(trusted.ok, true, JSON.stringify(trusted.checks, null, 2));
    assert.deepEqual(trusted.checks.map((c) => c.name), ['skills', 'instructions', 'mcp-config', 'codex-trust', 'mcp-server']);
  } finally {
    cleanup();
  }
});

test('installMcp refuses when .codex is symlinked to a directory outside the project root, leaving the outside dir untouched', async () => {
  const { base, projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    const outsideDir = join(base, 'outside-codex');
    mkdirSync(outsideDir);
    try {
      symlinkSync(outsideDir, join(projectRoot, '.codex'));
    } catch {
      cleanup();
      return;
    }
    await assert.rejects(
      () => new CodexAdapter(ctx).installMcp({ kitRoot, projectRoot, includeFigma: true }),
      /resolves outside the project root/
    );
    assert.equal(existsSync(join(outsideDir, 'config.toml')), false);
  } finally {
    cleanup();
  }
});

test('installSkills refuses when .agents/skills is symlinked to a directory outside the project root', async () => {
  const { base, projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    const outsideDir = join(base, 'outside-skills');
    mkdirSync(outsideDir);
    mkdirSync(join(projectRoot, '.agents'));
    try {
      symlinkSync(outsideDir, join(projectRoot, '.agents', 'skills'));
    } catch {
      cleanup();
      return;
    }
    await assert.rejects(
      () => new CodexAdapter(ctx).installSkills(join(kitRoot, 'skills')),
      /resolves outside the project root/
    );
    assert.equal(existsSync(join(outsideDir, 'figma-to-code')), false);
  } finally {
    cleanup();
  }
});

test('verify reports a corrupt project config.toml as a parse error in mcp-config, not "run install"', async () => {
  const { projectRoot, kitRoot, ctx, cleanup } = setup();
  try {
    const adapter = new CodexAdapter(ctx);
    await adapter.installSkills(join(kitRoot, 'skills'));
    await adapter.installInstructions();
    await adapter.installMcp({ kitRoot, projectRoot, includeFigma: true });
    writeFileSync(join(projectRoot, '.codex', 'config.toml'), 'model = \n');
    const result = await adapter.verify();
    assert.equal(result.ok, false);
    const mcpConfig = result.checks.find((c) => c.name === 'mcp-config');
    assert.ok(mcpConfig);
    assert.match(mcpConfig!.detail, /cannot parse .*config\.toml/);
    assert.doesNotMatch(mcpConfig!.detail, /run install/);
  } finally {
    cleanup();
  }
});
