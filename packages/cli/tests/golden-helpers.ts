import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, type CliIo } from '../src/cli.ts';
import { findKitRoot } from '../src/util.ts';

export const goldenRoot = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'golden');

/**
 * Run `dev-agent <argv>` in a fresh project and return what it left behind: the install stdout (minus the
 * skill-count lines) and each file in `files` (golden name → path relative to the project), with machine
 * specific paths replaced by placeholders. Every path in `absent` must not exist afterwards.
 */
export async function captureGolden(argv: string[], files: Record<string, string>, absent: string[] = []): Promise<Record<string, string>> {
  const base = mkdtempSync(join(tmpdir(), 'dev-agent-golden-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(`ERR ${l}`), env: { PATH: '', CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    const code = await run([...argv, '--project', projectRoot], io);
    assert.equal(code, 0, out.join('\n'));
    const kit = findKitRoot();
    const norm = (text: string): string => text.split(projectRoot).join('<PROJECT>').split(kit).join('<KIT>');
    for (const rel of absent) assert.equal(existsSync(join(projectRoot, rel)), false, `${rel} must not exist`);
    const stdout = out.filter((l) => !l.trimStart().startsWith('skills →')).join('\n') + '\n';
    const result: Record<string, string> = { 'stdout.txt': norm(stdout) };
    for (const [name, rel] of Object.entries(files)) result[name] = norm(readFileSync(join(projectRoot, rel), 'utf8'));
    return result;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/** Compare `actual` with tests/fixtures/golden/<name>/*; `UPDATE_GOLDEN=1` rewrites the fixtures instead. */
export function expectGolden(name: string, actual: Record<string, string>): void {
  for (const [file, content] of Object.entries(actual)) {
    const target = join(goldenRoot, name, file);
    if (process.env.UPDATE_GOLDEN === '1') {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      continue;
    }
    assert.ok(existsSync(target), `missing golden ${target}; run with UPDATE_GOLDEN=1`);
    assert.equal(content, readFileSync(target, 'utf8'), `${name}/${file} changed`);
  }
}
