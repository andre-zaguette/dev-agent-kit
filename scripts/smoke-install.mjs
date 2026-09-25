#!/usr/bin/env node
// Slow, networked: pack the kit, install the tarball into a temporary prefix and drive the installed CLI.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const work = mkdtempSync(path.join(tmpdir(), 'dak-smoke-'));
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
const fail = (message) => {
  console.error(`✘ ${message}`);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
};

try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work], { cwd: root }))[0].filename;
  const tarball = path.join(work, packed);
  const prefix = path.join(work, 'prefix');
  mkdirSync(prefix);
  writeFileSync(path.join(prefix, 'package.json'), '{"private":true}');
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball], { cwd: prefix, timeout: 600_000 });
  const bin = (name) => path.join(prefix, 'node_modules', '.bin', name);

  for (const name of ['dev-agent', 'frontend-agent', 'frontend-agent-kit']) {
    const out = run(bin(name), ['--version'], { cwd: work }).trim();
    if (out !== version) fail(`${name} --version printed "${out}", expected ${version}`);
  }

  const project = path.join(work, 'project');
  mkdirSync(project);
  run('git', ['init', '-q'], { cwd: project });
  run(bin('dev-agent'), ['install', 'claude', '--project', project, '--no-figma'], { cwd: work });
  const mcp = JSON.parse(readFileSync(path.join(project, '.mcp.json'), 'utf8'));
  const launcher = mcp.mcpServers?.['frontend-agent']?.command;
  if (!launcher || !existsSync(launcher)) fail(`the MCP launcher written by install does not exist: ${launcher}`);
  if (!existsSync(path.join(project, '.claude', 'skills', 'figma-to-code', 'SKILL.md'))) fail('install did not copy the skills');
  run(bin('dev-agent'), ['verify', 'claude', '--project', project], { cwd: work, timeout: 120_000 });
  console.log(`ok: ${packed} installs, reports ${version} under all three names, installs into a project and verifies`);
} catch (error) {
  fail(`${error.message}\n${error.stdout ?? ''}${error.stderr ?? ''}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
