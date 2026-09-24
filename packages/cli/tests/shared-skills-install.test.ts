import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, type CliIo } from '../src/cli.ts';

const SHARED = ['engineering-architecture', 'repository-investigation', 'verification', 'root-cause-analysis', 'surgical-diff', 'context-efficiency', 'repo-memory', 'task-orchestrator'];
const BACKEND = ['backend-architecture', 'api-design', 'data-modeling', 'database-migrations', 'backend-testing', 'auth-security', 'external-integrations', 'async-jobs', 'observability', 'backend-performance'];
const FRONTEND = ['accessibility', 'component-selection', 'figma-to-code', 'frontend-design', 'motion-design', 'responsive-design', 'visual-validation'];

test('install puts the 7 frontend, 8 shared and 10 backend skills in the project, and a re-run is a no-op', async () => {
  const base = mkdtempSync(join(tmpdir(), 'frontend-agent-shared-'));
  try {
    const projectRoot = join(base, 'project');
    const homeDir = join(base, 'home');
    mkdirSync(projectRoot);
    mkdirSync(homeDir);
    const out: string[] = [];
    const io: CliIo = { stdout: (l) => out.push(l), stderr: () => {}, env: { PATH: '', CODEX_HOME: join(base, 'codex-home') }, cwd: projectRoot, homeDir };
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 0);
    for (const name of [...FRONTEND, ...SHARED, ...BACKEND]) assert.ok(existsSync(join(projectRoot, '.claude', 'skills', name, 'SKILL.md')), name);
    assert.equal(readdirSync(join(projectRoot, '.claude', 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).length, 25);
    assert.ok(existsSync(join(projectRoot, '.claude', 'skills', 'task-orchestrator', 'references', 'git-workflow.md')));
    assert.ok(existsSync(join(projectRoot, '.claude', 'skills', 'backend-architecture', 'references', 'django.md')));
    out.length = 0;
    assert.equal(await run(['install', 'claude', '--project', projectRoot], io), 0);
    assert.match(out.join('\n'), /0 added, 0 updated, 0 removed/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
