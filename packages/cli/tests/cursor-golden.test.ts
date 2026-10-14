import { test } from 'node:test';
import { captureGolden, expectGolden } from './golden-helpers.ts';

test('install cursor output is byte-identical to the golden snapshot', async () => {
  expectGolden('cursor', await captureGolden(['install', 'cursor'], { 'mcp.json': '.cursor/mcp.json', 'AGENTS.md': 'AGENTS.md' }, ['.mcp.json', 'CLAUDE.md', '.codex', '.claude']));
});
