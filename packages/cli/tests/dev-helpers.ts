import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CliIo } from '../src/cli.ts';

export function setup(files: Record<string, string> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'dev-agent-cli-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(projectRoot, rel)), { recursive: true });
    writeFileSync(join(projectRoot, rel), content);
  }
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), env: { PATH: '', CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  return { base, projectRoot, io, out, err, text: () => out.join('\n'), cleanup: () => rmSync(base, { recursive: true, force: true }) };
}
