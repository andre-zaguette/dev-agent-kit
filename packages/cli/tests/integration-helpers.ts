import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { figma } from '../src/integrations/figma.ts';
import { findKitRoot } from '../src/util.ts';
import type { AdapterContext, HostName } from '../src/types.ts';
import type { McpServerChange } from '../src/integrations/types.ts';

export function figmaServers(host: HostName): McpServerChange[] {
  return figma.plan(host, { state: 'present' });
}

export function project(env: NodeJS.ProcessEnv = { PATH: '' }) {
  const base = mkdtempSync(join(tmpdir(), 'dev-agent-integration-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  const ctx: AdapterContext = { projectRoot, kitRoot: findKitRoot(), kitVersion: '1.2.0', env, homeDir, force: false };
  return { base, projectRoot, homeDir, ctx, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

/** An executable file named `name` in `dir`, standing in for a tool installed on the machine. */
export function fakeBin(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, 0o755);
  return file;
}
