import { test } from 'node:test';
import { captureGolden, expectGolden } from './golden-helpers.ts';

const ALL_FILES = { 'mcp.json': '.mcp.json', 'config.toml': '.codex/config.toml', 'CLAUDE.md': 'CLAUDE.md', 'AGENTS.md': 'AGENTS.md' };

for (const [name, flags] of [['default', []], ['no-figma', ['--no-figma']]] as const) {
  test(`install --all output is byte-identical to the golden snapshot (${name})`, async () => {
    expectGolden(name, await captureGolden(['install', '--all', ...flags], ALL_FILES, ['.cursor']));
  });
}
