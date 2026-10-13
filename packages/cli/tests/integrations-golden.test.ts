import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, type CliIo } from '../src/cli.ts';
import { findKitRoot } from '../src/util.ts';

const goldenRoot = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'golden');

/** Everything `install --all` leaves behind for the hosts, with machine-specific paths replaced by placeholders. */
async function capture(flags: string[]): Promise<Record<string, string>> {
  const base = mkdtempSync(join(tmpdir(), 'dev-agent-golden-'));
  const projectRoot = join(base, 'project');
  const homeDir = join(base, 'home');
  mkdirSync(projectRoot);
  mkdirSync(homeDir);
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(`ERR ${l}`), env: { PATH: '', CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
  try {
    const code = await run(['install', '--all', '--project', projectRoot, ...flags], io);
    assert.equal(code, 0, out.join('\n'));
    const kit = findKitRoot();
    const norm = (text: string): string => text.split(projectRoot).join('<PROJECT>').split(kit).join('<KIT>');
    const stdout = out.filter((l) => !l.trimStart().startsWith('skills →')).join('\n') + '\n';
    return {
      'stdout.txt': norm(stdout),
      'mcp.json': norm(readFileSync(join(projectRoot, '.mcp.json'), 'utf8')),
      'config.toml': norm(readFileSync(join(projectRoot, '.codex', 'config.toml'), 'utf8')),
      'CLAUDE.md': norm(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')),
      'AGENTS.md': norm(readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8'))
    };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

for (const [name, flags] of [['default', []], ['no-figma', ['--no-figma']]] as const) {
  test(`install --all output is byte-identical to the golden snapshot (${name})`, async () => {
    const actual = await capture([...flags]);
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
  });
}
