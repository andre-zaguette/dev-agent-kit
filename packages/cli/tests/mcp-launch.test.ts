import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kitServerLaunch, resolveTsx } from '../src/mcp-launch.ts';

function fakeTsx(dir: string): string {
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true });
  const file = join(dir, 'node_modules', '.bin', 'tsx');
  writeFileSync(file, '#!/bin/sh\n');
  chmodSync(file, 0o755);
  return file;
}

test('resolveTsx prefers the kit\'s own tsx, then a hoisted one in an ancestor, and fails clearly otherwise', () => {
  const base = mkdtempSync(join(tmpdir(), 'dak-tsx-'));
  try {
    const kit = join(base, 'node_modules', 'dev-agent-kit');
    mkdirSync(kit, { recursive: true });
    assert.throws(() => resolveTsx(kit), /could not find tsx/);
    const hoisted = fakeTsx(base);
    assert.equal(resolveTsx(kit), hoisted);
    const own = fakeTsx(kit);
    assert.equal(resolveTsx(kit), own);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the server launch uses the resolved tsx and the kit\'s server entry', () => {
  const base = mkdtempSync(join(tmpdir(), 'dak-tsx-'));
  try {
    const kit = join(base, 'node_modules', 'dev-agent-kit');
    mkdirSync(kit, { recursive: true });
    const hoisted = fakeTsx(base);
    const launch = kitServerLaunch({ kitRoot: kit, projectRoot: '/p', includeFigma: false });
    assert.equal(launch.command, hoisted);
    assert.deepEqual(launch.args, [join(kit, 'packages', 'mcp-server', 'src', 'index.ts')]);
    assert.equal(launch.env.FRONTEND_AGENT_PROJECT_ROOT, '/p');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
