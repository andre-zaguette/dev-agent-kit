import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { detectProjectProfile } from '../src/project-profile.ts';
import { commitFile, makeRepo } from './helpers.ts';

function project(files: Record<string, string>): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'dak-profile-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('npm project: scripts become commands, frameworks come from dependencies', () => {
  const p = project({
    'package.json': JSON.stringify({
      scripts: { test: 'vitest', lint: 'eslint .', typecheck: 'tsc --noEmit', dev: 'vite' },
      dependencies: { react: '^18' },
      devDependencies: { typescript: '^5', tailwindcss: '^3' }
    }),
    'package-lock.json': '{}',
    'tsconfig.json': '{}'
  });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.deepEqual(profile.languages, ['typescript']);
    assert.deepEqual(profile.frameworks.sort(), ['react', 'tailwind']);
    assert.equal(profile.packageManager, 'npm');
    assert.deepEqual(profile.testCommands, ['npm test']);
    assert.deepEqual(profile.lintCommands, ['npm run lint']);
    assert.deepEqual(profile.typecheckCommands, ['npm run typecheck']);
    assert.equal(profile.docker, false);
  } finally {
    p.cleanup();
  }
});

test('pnpm lockfile switches the command runner', () => {
  const p = project({ 'package.json': JSON.stringify({ scripts: { test: 'vitest', 'type-check': 'tsc' } }), 'pnpm-lock.yaml': '' });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.equal(profile.packageManager, 'pnpm');
    assert.deepEqual(profile.testCommands, ['pnpm test']);
    assert.deepEqual(profile.typecheckCommands, ['pnpm type-check']);
    assert.deepEqual(profile.languages, ['javascript']);
  } finally {
    p.cleanup();
  }
});

test('Nest project with prisma, postgres compose and bullmq', () => {
  const p = project({
    'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^10', bullmq: '^5' } }),
    'prisma/schema.prisma': 'datasource db {\n  provider = "postgresql"\n}\n',
    'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n'
  });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.deepEqual(profile.frameworks, ['nestjs']);
    assert.equal(profile.database, 'postgresql');
    assert.equal(profile.migrationTool, 'prisma');
    assert.equal(profile.queue, 'bullmq');
    assert.equal(profile.docker, true);
  } finally {
    p.cleanup();
  }
});

test('Django + DRF + celery + rabbitmq project uses tool config for commands when nothing else exists', () => {
  const p = project({
    'manage.py': '',
    'requirements.txt': 'Django==5.0\ndjangorestframework==3.15\ncelery==5\npytest\nruff\nmypy\npsycopg2-binary\n',
    'docker-compose.yml': 'services:\n  mq:\n    image: rabbitmq:3\n'
  });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.deepEqual(profile.languages, ['python']);
    assert.deepEqual(profile.frameworks.sort(), ['django', 'drf']);
    assert.equal(profile.migrationTool, 'django');
    assert.equal(profile.database, 'postgresql');
    assert.equal(profile.queue, 'rabbitmq');
    assert.deepEqual(profile.testCommands, ['pytest']);
    assert.deepEqual(profile.lintCommands, ['ruff check .']);
    assert.deepEqual(profile.typecheckCommands, ['mypy .']);
  } finally {
    p.cleanup();
  }
});

test('django-cors-headers alone does not make a project Django', () => {
  const p = project({ 'requirements.txt': 'fastapi\ndjango-cors-headers\n' });
  try {
    assert.deepEqual(detectProjectProfile(p.dir).frameworks, ['fastapi']);
  } finally {
    p.cleanup();
  }
});

test('a Makefile target beats a tool-config guess; a package script beats a Makefile target', () => {
  const p = project({ 'pyproject.toml': '[tool.pytest]\n', Makefile: 'test:\n\tpytest -q\nlint:\n\truff .\n' });
  const q = project({ 'package.json': JSON.stringify({ scripts: { test: 'jest' } }), Makefile: 'test:\n\techo other\n' });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.deepEqual(profile.testCommands, ['make test']);
    assert.deepEqual(profile.lintCommands, ['make lint']);
    assert.deepEqual(detectProjectProfile(q.dir).testCommands, ['npm test']);
  } finally {
    p.cleanup();
    q.cleanup();
  }
});

test('malformed package.json and empty directories never throw', () => {
  const bad = project({ 'package.json': '{ not json' });
  const empty = project({});
  try {
    const badProfile = detectProjectProfile(bad.dir);
    assert.deepEqual(badProfile.languages, []);
    assert.deepEqual(badProfile.testCommands, []);
    const emptyProfile = detectProjectProfile(empty.dir);
    assert.deepEqual(emptyProfile, {
      languages: [],
      frameworks: [],
      testCommands: [],
      lintCommands: [],
      typecheckCommands: [],
      docker: false
    });
  } finally {
    bad.cleanup();
    empty.cleanup();
  }
});

test('baseBranch is filled from git when the project is a repo', () => {
  const dir = makeRepo('main');
  try {
    commitFile(dir, 'a.txt');
    assert.equal(detectProjectProfile(dir).baseBranch, 'main');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
