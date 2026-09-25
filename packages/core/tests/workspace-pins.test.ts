import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPins, readPackageInfo } from '../src/workspace-pins.ts';

type Files = Record<string, string>;

function tree(files: Files): string {
  const root = mkdtempSync(join(tmpdir(), 'dak-pins-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const WS = [
  { name: 'models', path: 'models', dependsOn: [] as string[] },
  { name: 'backend', path: 'backend', dependsOn: ['models'] }
];

function pyproject(name: string, version: string | undefined, deps: string[]): string {
  return `[project]\nname = "${name}"\n${version ? `version = "${version}"\n` : ''}dependencies = [${deps.map((d) => JSON.stringify(d)).join(', ')}]\n`;
}

function status(models: string, backendDeps: string[], modelsVersion: string | null = '1.2.0') {
  const root = tree({ 'models/pyproject.toml': pyproject(models, modelsVersion ?? undefined, []), 'backend/pyproject.toml': pyproject('backend', '0.1.0', backendDeps) });
  const rows = checkPins(root, WS);
  assert.equal(rows.length, 1);
  return rows[0];
}

test('reads PEP 621, poetry and package.json manifests', () => {
  const pep = tree({ 'a/pyproject.toml': pyproject('My_Models', '1.2.0', ['requests>=2.0', 'models[x]>=1.0']) });
  const info = readPackageInfo(join(pep, 'a'))!;
  assert.equal(info.name, 'my-models');
  assert.equal(info.version, '1.2.0');
  assert.equal(info.dependencies.models, '>=1.0');
  const poetry = tree({ 'a/pyproject.toml': '[tool.poetry]\nname = "core"\nversion = "2.0.0"\n[tool.poetry.dependencies]\npython = "^3.11"\nmodels = "^1.2.0"\nother = { version = "^1.2" }\nviagit = { git = "https://user:secret@example.com/x.git" }\n' });
  const p = readPackageInfo(join(poetry, 'a'))!;
  assert.equal(p.name, 'core');
  assert.equal(p.dependencies.models, '^1.2.0');
  assert.equal(p.dependencies.other, '^1.2');
  assert.ok(!JSON.stringify(p).includes('secret'));
  const npm = tree({ 'a/package.json': JSON.stringify({ name: '@acme/models', version: '1.2.0', dependencies: { '@acme/x': '^1.0.0' } }) });
  assert.equal(readPackageInfo(join(npm, 'a'))!.dependencies['@acme/x'], '^1.0.0');
  assert.equal(readPackageInfo(join(npm, 'nothing')), null);
});

test('each status with a concrete pair', () => {
  assert.equal(status('models', ['models>=1.2.0']).status, 'ok');
  assert.equal(status('models', ['models>=1.3.0']).status, 'ahead');
  assert.equal(status('models', ['models==1.2.0']).status, 'ok');
  assert.equal(status('models', ['models==1.2.0'], '1.3.0').status, 'behind');
  assert.equal(status('models', ['models==1.3.0']).status, 'ahead');
  assert.equal(status('models', ['models~=1.2'], '1.9.0').status, 'ok');
  assert.equal(status('models', ['models~=1.2'], '2.0.0').status, 'behind');
  assert.equal(status('models', ['models~=1.2.0'], '1.2.9').status, 'ok');
  assert.equal(status('models', ['models~=1.2.0'], '1.3.0').status, 'behind');
  assert.equal(status('My_Models', ['my-models>=1.0']).status, 'ok');
});

test('the report row carries names, constraint and version', () => {
  const row = status('models', ['models>=1.3.0']);
  assert.equal(row.dependent, 'backend');
  assert.equal(row.dependency, 'models');
  assert.equal(row.constraint, '>=1.3.0');
  assert.equal(row.version, '1.2.0');
});

test('poetry caret and npm ranges', () => {
  const root = tree({
    'models/package.json': JSON.stringify({ name: '@acme/models', version: '1.4.0' }),
    'backend/package.json': JSON.stringify({ name: 'backend', dependencies: { '@acme/models': '^1.2.0' } })
  });
  assert.equal(checkPins(root, WS)[0].status, 'ok');
  const root2 = tree({
    'models/package.json': JSON.stringify({ name: '@acme/models', version: '2.0.0' }),
    'backend/package.json': JSON.stringify({ name: 'backend', dependencies: { '@acme/models': '~1.2.0' } })
  });
  assert.equal(checkPins(root2, WS)[0].status, 'behind');
  const root3 = tree({
    'models/package.json': JSON.stringify({ name: '@acme/models', version: '1.2.0' }),
    'backend/package.json': JSON.stringify({ name: 'backend', dependencies: { '@acme/models': '1.2.0' } })
  });
  assert.equal(checkPins(root3, WS)[0].status, 'ok');
  const root4 = tree({
    'models/pyproject.toml': '[tool.poetry]\nname = "models"\nversion = "1.2.0"\n',
    'backend/pyproject.toml': '[tool.poetry]\nname = "backend"\nversion = "1"\n[tool.poetry.dependencies]\nmodels = { version = "^1.3" }\n'
  });
  assert.equal(checkPins(root4, WS)[0].status, 'ahead');
});

test('not-declared when the dependent does not list the package', () => {
  assert.equal(status('models', ['requests>=2']).status, 'not-declared');
});

test('constraints the parser does not understand are unknown, never ok', () => {
  for (const spec of ['models>=1,<2', 'models!=1.2.0', 'models>1.0', 'models<3', 'models; python_version>"3.9"', 'models>=1.0; python_version>"3.9"', 'models==1.*', 'models']) {
    const row = status('models', [spec]);
    assert.equal(row.status, 'unknown', spec);
    assert.ok(row.note, spec);
  }
});

test('direct references are unknown and never echo credentials', () => {
  const root = tree({
    'models/pyproject.toml': pyproject('models', '1.2.0', []),
    'backend/pyproject.toml': pyproject('backend', '0.1.0', ['models @ git+https://user:secret@example.com/m.git'])
  });
  const rows = checkPins(root, WS);
  assert.equal(rows[0].status, 'unknown');
  assert.ok(!JSON.stringify(rows).includes('secret'));
  const npm = tree({
    'models/package.json': JSON.stringify({ name: 'models', version: '1.2.0' }),
    'backend/package.json': JSON.stringify({ name: 'backend', dependencies: { models: 'git+https://user:secret@example.com/m.git' } })
  });
  const r2 = checkPins(npm, WS);
  assert.equal(r2[0].status, 'unknown');
  assert.ok(!JSON.stringify(r2).includes('secret'));
  const local = tree({
    'models/package.json': JSON.stringify({ name: 'models', version: '1.2.0' }),
    'backend/package.json': JSON.stringify({ name: 'backend', dependencies: { models: 'file:../models' } })
  });
  assert.equal(checkPins(local, WS)[0].status, 'unknown');
});

test('pre-release and missing versions are unknown', () => {
  assert.equal(status('models', ['models>=1.0'], '1.0.0rc1').status, 'unknown');
  assert.equal(status('models', ['models>=1.0'], null).status, 'unknown');
  assert.equal(status('models', ['models>=1.0'], '1.0.0-beta.1').status, 'unknown');
});

test('oversized and malformed manifests are unknown', () => {
  const big = tree({
    'models/pyproject.toml': `${pyproject('models', '1.2.0', [])}# ${'x'.repeat(2 * 1024 * 1024)}\n`,
    'backend/pyproject.toml': pyproject('backend', '0.1.0', ['models>=1.0'])
  });
  assert.equal(readPackageInfo(join(big, 'models')), null);
  assert.equal(checkPins(big, WS)[0].status, 'unknown');
  const bad = tree({ 'models/pyproject.toml': '[project\nname=', 'backend/package.json': '{not json' });
  assert.equal(checkPins(bad, WS)[0].status, 'unknown');
});

test('a dependency workspace without a manifest or directory is unknown with a note', () => {
  const noManifest = tree({ 'models/README.md': 'x', 'backend/pyproject.toml': pyproject('backend', '0.1.0', ['models>=1.0']) });
  const row = checkPins(noManifest, WS)[0];
  assert.equal(row.status, 'unknown');
  assert.match(row.note ?? '', /manifest/);
  const noDir = tree({ 'backend/pyproject.toml': pyproject('backend', '0.1.0', ['models>=1.0']) });
  assert.equal(checkPins(noDir, WS)[0].status, 'unknown');
});

test('rows follow dependency order and cover every edge', () => {
  const root = tree({
    'models/pyproject.toml': pyproject('models', '1.2.0', []),
    'backend/pyproject.toml': pyproject('backend', '1.0.0', ['models>=1.0']),
    'api/pyproject.toml': pyproject('api', '1.0.0', ['backend>=1.0', 'models>=1.0'])
  });
  const rows = checkPins(root, [
    { name: 'api', path: 'api', dependsOn: ['backend', 'models'] },
    { name: 'backend', path: 'backend', dependsOn: ['models'] },
    { name: 'models', path: 'models', dependsOn: [] }
  ]);
  assert.deepEqual(rows.map((r) => `${r.dependent}>${r.dependency}`), ['backend>models', 'api>backend', 'api>models']);
});
