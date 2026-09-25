import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDevAgentConfig } from '../src/config.ts';
import { findWorkspace, orderWorkspaces, workspaceRoot } from '../src/workspaces.ts';

const PUMPKIN = `
workspaces:
  models:     { path: models, role: library }
  backend:    { path: backend, role: backend, dependsOn: [models] }
  policy-api: { path: policy-api, role: api, dependsOn: [backend] }
  client:     { path: client, role: frontend, dependsOn: [policy-api], baseBranch: develop }
  admin:      { path: admin, role: frontend, dependsOn: [policy-api] }
`;

const ALTAVE = `
workspaces:
  cloud-back: { path: cloud-back }
  cloud-front: { path: cloud-front }
  edge-back: { path: edge-back }
  edge-front: { path: edge-front }
`;

test('parses the Pumpkin and Altave layouts', () => {
  const p = parseDevAgentConfig(PUMPKIN);
  assert.equal(p.workspaces.length, 5);
  const client = findWorkspace(p, 'client');
  assert.deepEqual(client, { name: 'client', path: 'client', role: 'frontend', dependsOn: ['policy-api'], baseBranch: 'develop' });
  assert.deepEqual(findWorkspace(p, 'models').dependsOn, []);
  const a = parseDevAgentConfig(ALTAVE);
  assert.equal(a.workspaces.length, 4);
  assert.ok(a.workspaces.every((w) => w.dependsOn.length === 0));
});

test('an absent workspaces key gives an empty list', () => {
  assert.deepEqual(parseDevAgentConfig('baseBranch: main').workspaces, []);
  assert.deepEqual(parseDevAgentConfig('').workspaces, []);
});

const bad = (yaml: string, message: RegExp) => assert.throws(() => parseDevAgentConfig(yaml), message);

test('rejects malformed workspace entries with a message naming them', () => {
  bad('workspaces: [a]', /workspaces.*mapping/);
  bad('workspaces:\n  a: { path: a, color: red }', /workspaces\.a\.color.*not a recognized/);
  bad('workspaces:\n  a: { path: 3 }', /workspaces\.a\.path/);
  bad('workspaces:\n  a: { path: "" }', /workspaces\.a\.path/);
  bad('workspaces:\n  a: { }', /workspaces\.a\.path/);
  bad('workspaces:\n  a: { path: /etc }', /workspaces\.a\.path.*relative/);
  bad('workspaces:\n  a: { path: ../x }', /workspaces\.a\.path/);
  bad('workspaces:\n  a: { path: a/../../x }', /workspaces\.a\.path/);
  bad('workspaces:\n  a: { path: "a\\\\b" }', /workspaces\.a\.path/);
  bad('workspaces:\n  a: { path: x }\n  b: { path: x }', /workspaces\.b\.path.*same.*a/);
  bad('workspaces:\n  a: { path: x }\n  b: { path: x/y }', /workspaces\.b\.path.*inside.*a/);
  bad('workspaces:\n  a: { path: x/y }\n  b: { path: x }', /workspaces\.[ab]\.path.*inside/);
  bad('workspaces:\n  all: { path: a }', /workspaces\.all.*reserved/);
  bad('workspaces:\n  Bad_Name: { path: a }', /workspaces\.Bad_Name.*invalid name/);
  bad('workspaces:\n  a: { path: a, role: wizard }', /workspaces\.a\.role/);
  bad('workspaces:\n  a: { path: a, dependsOn: b }', /workspaces\.a\.dependsOn.*list/);
  bad('workspaces:\n  a: { path: a, dependsOn: [1] }', /workspaces\.a\.dependsOn/);
  bad('workspaces:\n  a: { path: a, dependsOn: [b] }', /workspaces\.a\.dependsOn.*unknown workspace "b"/);
  bad('workspaces:\n  a: { path: a, dependsOn: [a] }', /workspaces\.a\.dependsOn.*itself/);
  bad('workspaces:\n  a: { path: a, dependsOn: [b] }\n  b: { path: b, dependsOn: [a] }', /cycle.*a.*b/);
  bad(`workspaces:\n  a: { path: a, dependsOn: [${Array.from({ length: 31 }, (_, i) => `n${i}`).join(',')}] }`, /workspaces\.a\.dependsOn.*at most/);
  bad('workspaces:\n  a: { path: a, baseBranch: "" }', /workspaces\.a\.baseBranch/);
});

test('rejects more than 30 workspaces', () => {
  const lines = Array.from({ length: 31 }, (_, i) => `  w${String.fromCharCode(97 + (i % 26))}${i}: { path: p${i} }`);
  bad(`workspaces:\n${lines.join('\n')}`, /at most 30/);
});

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'dak-ws-'));
  mkdirSync(join(root, 'real'));
  writeFileSync(join(root, 'afile'), 'x');
  symlinkSync(join(root, 'real'), join(root, 'link'));
  mkdirSync(join(root, 'real', 'inner'));
  return root;
}
const ws = (path: string) => ({ name: 'w', path, dependsOn: [] as string[] });

test('workspaceRoot returns the realpath of a real directory', () => {
  const root = tree();
  assert.ok(workspaceRoot(root, ws('real')).endsWith('/real'));
  assert.ok(workspaceRoot(root, ws('real/inner')).endsWith('/real/inner'));
});

test('workspaceRoot refuses missing, file, symlinked and symlink-parented directories', () => {
  const root = tree();
  assert.throws(() => workspaceRoot(root, ws('nope')), /workspace "w".*does not exist/);
  assert.throws(() => workspaceRoot(root, ws('afile')), /workspace "w".*not a directory/);
  assert.throws(() => workspaceRoot(root, ws('link')), /workspace "w".*symbolic link/);
  assert.throws(() => workspaceRoot(root, ws('link/inner')), /workspace "w".*symbolic link/);
});

test('orderWorkspaces puts dependencies first with an alphabetical tie-break', () => {
  const cfg = parseDevAgentConfig(PUMPKIN);
  assert.deepEqual(orderWorkspaces(cfg).map((w) => w.name), ['models', 'backend', 'policy-api', 'admin', 'client']);
  assert.deepEqual(orderWorkspaces(parseDevAgentConfig(ALTAVE)).map((w) => w.name), ['cloud-back', 'cloud-front', 'edge-back', 'edge-front']);
});

test('orderWorkspaces --only and --with-deps', () => {
  const cfg = parseDevAgentConfig(PUMPKIN);
  assert.deepEqual(orderWorkspaces(cfg, { only: ['client'] }).map((w) => w.name), ['client']);
  assert.deepEqual(orderWorkspaces(cfg, { only: ['client'], withDeps: true }).map((w) => w.name), ['models', 'backend', 'policy-api', 'client']);
  assert.throws(() => orderWorkspaces(cfg, { only: ['ghost'] }), /unknown workspace "ghost".*admin/);
});

test('findWorkspace lists the known names on a miss', () => {
  assert.throws(() => findWorkspace(parseDevAgentConfig(PUMPKIN), 'x'), /unknown workspace "x".*models/);
});
