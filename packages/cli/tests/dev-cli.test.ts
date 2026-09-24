import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.ts';
import { runDev } from '../src/dev-cli.ts';
import { setup } from './dev-helpers.ts';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

test('--help lists the commands and exits 0; no arguments exits 1; --version prints the kit version', async () => {
  const t = setup();
  try {
    assert.equal(await runDev(['--help'], t.io), 0);
    for (const word of ['install', 'verify', 'inspect', 'context audit', 'sources', 'task resolve', 'contract verify']) assert.match(t.text(), new RegExp(word), word);
    t.out.length = 0;
    assert.equal(await runDev([], t.io), 1);
    t.out.length = 0;
    assert.equal(await runDev(['--version'], t.io), 0);
    assert.match(t.text(), /^\d+\.\d+\.\d+$/);
  } finally {
    t.cleanup();
  }
});

test('an unknown command or subcommand is a usage error', async () => {
  const t = setup();
  try {
    assert.equal(await runDev(['nope'], t.io), 1);
    assert.match(t.err.join('\n'), /unknown command "nope"/);
    assert.equal(await runDev(['context', 'nope'], t.io), 1);
    assert.equal(await runDev(['inspect', '--project', join(t.base, 'missing')], t.io), 1);
    assert.match(t.err.join('\n'), /does not exist/);
  } finally {
    t.cleanup();
  }
});

test('install and verify are aliases: dev-agent produces exactly what frontend-agent produces', async () => {
  const a = setup();
  const b = setup();
  try {
    assert.equal(await runDev(['install', 'claude', '--project', a.projectRoot], a.io), 0);
    assert.equal(await run(['install', 'claude', '--project', b.projectRoot], b.io), 0);
    const strip = (lines: string[], root: string) => lines.map((l) => l.replaceAll(root, '<project>'));
    assert.deepEqual(strip(a.out, a.projectRoot), strip(b.out, b.projectRoot));
    assert.ok(existsSync(join(a.projectRoot, '.claude', 'skills', 'task-orchestrator', 'SKILL.md')));
    a.out.length = 0;
    assert.equal(await runDev(['verify', 'claude', '--project', a.projectRoot], a.io), 0);
    assert.match(a.text(), /ok/);
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test('inspect prints the detected profile and the backend references that apply', async () => {
  const t = setup({
    'pyproject.toml': '[project]\ndependencies = ["fastapi", "psycopg2-binary", "celery"]\n[tool.pytest]\n',
    'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n'
  });
  try {
    assert.equal(await runDev(['inspect', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /languages: python/);
    assert.match(t.text(), /frameworks: fastapi/);
    assert.match(t.text(), /database: postgresql/);
    assert.match(t.text(), /backend-architecture\/fastapi/);
    assert.match(t.text(), /data-modeling\/postgresql/);
    t.out.length = 0;
    assert.equal(await runDev(['inspect', '--project', t.projectRoot, '--json'], t.io), 0);
    const json = JSON.parse(t.text());
    assert.deepEqual(json.profile.frameworks, ['fastapi']);
    assert.ok(json.backendReferences.some((r: { reference: string }) => r.reference === 'fastapi'));
  } finally {
    t.cleanup();
  }
});

test('inspect on a project with no backend signal recommends nothing', async () => {
  const t = setup({ 'package.json': JSON.stringify({ dependencies: { react: '^18' } }) });
  try {
    assert.equal(await runDev(['inspect', '--project', t.projectRoot, '--json'], t.io), 0);
    assert.deepEqual(JSON.parse(t.text()).backendReferences, []);
  } finally {
    t.cleanup();
  }
});

test('context audit reports always-on size and findings, as text or JSON', async () => {
  const t = setup({ 'CLAUDE.md': '# Rules\n' + 'Always run the linter before committing code changes.\n'.repeat(400) });
  try {
    assert.equal(await runDev(['context', 'audit', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /always-on: ~\d+ tokens/);
    assert.match(t.text(), /large-instruction-file/);
    t.out.length = 0;
    assert.equal(await runDev(['context', 'audit', '--project', t.projectRoot, '--json'], t.io), 0);
    assert.ok(JSON.parse(t.text()).alwaysOnTokens > 1500);
  } finally {
    t.cleanup();
  }
});

test('the dev-agent binary runs through tsx from any directory', () => {
  const result = spawnSync(process.execPath, [join(packageRoot, 'bin', 'dev-agent.mjs'), '--version'], { encoding: 'utf8', cwd: tmpdir() });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});
