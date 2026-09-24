import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeAdapter } from '../src/adapters/claude.ts';
import { CodexAdapter } from '../src/adapters/codex.ts';
import { findKitRoot } from '../src/util.ts';
import type { AdapterContext } from '../src/types.ts';

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'frontend-agent-instructions-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  const codexHome = join(base, 'codex-home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  const kitRoot = findKitRoot();
  const ctx: AdapterContext = {
    projectRoot,
    kitRoot,
    kitVersion: '0.4.0',
    env: { PATH: '', CODEX_HOME: codexHome },
    homeDir,
    force: false
  };
  return { base, projectRoot, homeDir, codexHome, kitRoot, ctx, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('AGENTS.md symlinked to CLAUDE.md: install --all twice is unchanged for both and the file has both texts once; codex-only afterwards is still unchanged', async () => {
  const { projectRoot, ctx, cleanup } = setup();
  try {
    const claudeFile = join(projectRoot, 'CLAUDE.md');
    const agentsFile = join(projectRoot, 'AGENTS.md');

    const claudeAdapter = new ClaudeCodeAdapter(ctx);
    const codexAdapter = new CodexAdapter(ctx);

    // First round: install --all
    const firstClaude = await claudeAdapter.installInstructions();
    assert.equal(firstClaude, 'created');
    // Symlink AGENTS.md -> CLAUDE.md before codex installs, so both hosts share one file.
    try {
      symlinkSync(claudeFile, agentsFile);
    } catch {
      return; // symlink creation unsupported here — skip
    }
    const firstCodex = await codexAdapter.installInstructions();
    assert.equal(firstCodex, 'replaced');

    const afterFirstRound = readFileSync(claudeFile, 'utf8');
    assert.match(afterFirstRound, /Figma as the design source of truth/);
    assert.match(afterFirstRound, /Dev Agent Kit repository instructions/);
    // Each text appears exactly once.
    const claudeMarkerCount = afterFirstRound.split('Figma as the design source of truth').length - 1;
    const codexMarkerCount = afterFirstRound.split('Dev Agent Kit repository instructions').length - 1;
    assert.equal(claudeMarkerCount, 1);
    assert.equal(codexMarkerCount, 1);

    // Second round: install --all again — both must report unchanged.
    const secondClaude = await claudeAdapter.installInstructions();
    const secondCodex = await codexAdapter.installInstructions();
    assert.equal(secondClaude, 'unchanged');
    assert.equal(secondCodex, 'unchanged');
    assert.equal(readFileSync(claudeFile, 'utf8'), afterFirstRound);

    // codex-only afterwards: still unchanged.
    const thirdCodex = await codexAdapter.installInstructions();
    assert.equal(thirdCodex, 'unchanged');
    assert.equal(readFileSync(claudeFile, 'utf8'), afterFirstRound);
  } finally {
    cleanup();
  }
});
