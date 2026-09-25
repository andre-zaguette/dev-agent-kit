import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDev } from '../src/dev-cli.ts';
import { writeContract } from '../../core/src/index.ts';
import { setup } from './dev-helpers.ts';

const dirs = { taskDocsDir: '.dev-agent/tasks', stateDir: '.dev-agent/state' };
const CONTRACT = {
  method: 'POST',
  path: '/api/users',
  request: { email: 'email', name: 'string' },
  response: { id: 'uuid', email: 'email', name: 'string' },
  errors: { '400': ['INVALID_INPUT'], '409': ['EMAIL_ALREADY_EXISTS'] },
  successStatus: 201
};
const ID = '3f2b8a4e-9d1c-4b6a-8e2f-0a1b2c3d4e5f';
const good = { method: 'POST', path: '/api/users', requestBody: { email: 'a@example.test', name: 'Ana' }, status: 201, responseBody: { id: ID, email: 'a@example.test', name: 'Ana' } };
const conflict = { method: 'POST', path: '/api/users', requestBody: { email: 'a@example.test', name: 'Ana' }, status: 409, responseBody: { detail: { code: 'EMAIL_ALREADY_EXISTS' } } };
const OPENAPI = JSON.stringify({
  openapi: '3.1.0',
  paths: {
    '/api/users': {
      post: {
        requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['email', 'name'], properties: { email: { type: 'string', format: 'email' }, name: { type: 'string' } } } } } },
        responses: {
          '201': { description: 'ok', content: { 'application/json': { schema: { type: 'object', required: ['id', 'email', 'name'], properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, name: { type: 'string' } } } } } },
          '400': { description: 'bad' },
          '409': { description: 'conflict' }
        }
      }
    }
  }
});

function project(files: Record<string, string> = {}) {
  const t = setup(files);
  writeContract(t.projectRoot, dirs, 'APP-88', CONTRACT);
  return t;
}

test('contract show prints the contract; a missing or invalid key is an error', async () => {
  const t = project();
  try {
    assert.equal(await runDev(['contract', 'show', 'APP-88', '--project', t.projectRoot], t.io), 0);
    assert.equal(JSON.parse(t.text()).path, '/api/users');
    assert.equal(await runDev(['contract', 'show', 'APP-99', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /no contract for APP-99/);
    assert.equal(await runDev(['contract', 'show', '../../x', '--project', t.projectRoot], t.io), 1);
  } finally {
    t.cleanup();
  }
});

test('contract verify passes conforming exchanges (one file, several exchanges) and an OpenAPI description', async () => {
  const t = project({ 'evidence/ok.json': JSON.stringify([good, conflict]), 'evidence/openapi.json': OPENAPI });
  try {
    assert.equal(await runDev(['contract', 'verify', 'APP-88', '--exchange', join(t.projectRoot, 'evidence/ok.json'), '--openapi', join(t.projectRoot, 'evidence/openapi.json'), '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /✔ exchange .*ok\.json \(2 exchanges\)/);
    assert.match(t.text(), /✔ openapi .*openapi\.json/);
  } finally {
    t.cleanup();
  }
});

test('contract verify exits 2 and names the violations for a drifting exchange', async () => {
  const drift = { ...good, responseBody: { id: 'nope', email: 'a@example.test' } };
  const t = project({ 'evidence/drift.json': JSON.stringify(drift) });
  try {
    assert.equal(await runDev(['contract', 'verify', 'APP-88', '--exchange', join(t.projectRoot, 'evidence/drift.json'), '--project', t.projectRoot], t.io), 2);
    assert.match(t.text(), /✘ exchange .*drift\.json/);
    assert.match(t.text(), /id: expected uuid/);
    assert.match(t.text(), /name: required field is missing/);
    t.out.length = 0;
    assert.equal(await runDev(['contract', 'verify', 'APP-88', '--exchange', join(t.projectRoot, 'evidence/drift.json'), '--project', t.projectRoot, '--json'], t.io), 2);
    assert.equal(JSON.parse(t.text()).ok, false);
  } finally {
    t.cleanup();
  }
});

test('contract verify needs evidence, and rejects unreadable, oversized, symlinked or malformed files with exit 1', async () => {
  const t = project({ 'evidence/bad.json': '{not json', 'evidence/big.json': ' '.repeat(5 * 1024 * 1024 + 10), 'evidence/ok.json': JSON.stringify(good) });
  try {
    const verify = (...args: string[]) => runDev(['contract', 'verify', 'APP-88', ...args, '--project', t.projectRoot], t.io);
    assert.equal(await verify(), 1);
    assert.match(t.err.join('\n'), /--exchange or --openapi/);
    assert.equal(await verify('--exchange', join(t.projectRoot, 'evidence/missing.json')), 1);
    assert.equal(await verify('--exchange', join(t.projectRoot, 'evidence/bad.json')), 1);
    assert.match(t.err.join('\n'), /not valid JSON/);
    assert.equal(await verify('--exchange', join(t.projectRoot, 'evidence/big.json')), 1);
    assert.match(t.err.join('\n'), /larger than/);
    assert.equal(await verify('--exchange', join(t.projectRoot, 'evidence')), 1);
    symlinkSync(join(t.projectRoot, 'evidence/ok.json'), join(t.projectRoot, 'evidence/link.json'));
    assert.equal(await verify('--exchange', join(t.projectRoot, 'evidence/link.json')), 1);
    assert.match(t.err.join('\n'), /symbolic link|regular file/);
  } finally {
    t.cleanup();
  }
});

test('contract usage finds the call, the method and the handled error codes in client directories', async () => {
  const t = project({
    'frontend/src/api.ts': "export const createUser = (b) => request('/api/users', { method: 'POST', body: JSON.stringify(b) });",
    'frontend/src/Form.tsx': "if (e.code === 'EMAIL_ALREADY_EXISTS') {} if (e.code === 'INVALID_INPUT') {}",
    'frontend/node_modules/x/index.js': "fetch('/api/users')"
  });
  try {
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', 'frontend', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /used: yes/);
    assert.match(t.text(), /method confirmed: yes/);
    assert.match(t.text(), /frontend\/src\/api\.ts/);
    assert.doesNotMatch(t.text(), /node_modules/);
    assert.match(t.text(), /unhandled error codes: -/);
  } finally {
    t.cleanup();
  }
});

test('contract usage exits 2 when the route is not called, and --strict also demands method and error codes', async () => {
  const t = project({ 'frontend/a.ts': "axios.get('/api/users')", 'frontend/b.ts': "fetch('/api/people')" });
  const other = project({ 'client/none.ts': "fetch('/api/people')" });
  try {
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', 'client', '--project', other.projectRoot], other.io), 2);
    assert.match(other.text(), /used: no/);
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', 'frontend', '--project', t.projectRoot], t.io), 2);
    assert.match(t.text(), /used: no/);
    assert.match(t.text(), /path only: frontend\/a\.ts/);
    t.out.length = 0;
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', 'frontend', '--strict', '--project', t.projectRoot], t.io), 2);
    assert.match(t.text(), /unhandled error codes: EMAIL_ALREADY_EXISTS, INVALID_INPUT/);
  } finally {
    t.cleanup();
    other.cleanup();
  }
});

test('contract usage refuses client directories outside the project and skips symlinks', async () => {
  const t = project({ 'frontend/a.ts': "fetch('/api/users', { method: 'POST' })" });
  try {
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', '../elsewhere', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /escapes the project root/);
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /--client/);
    mkdirSync(join(t.base, 'outside'));
    writeFileSync(join(t.base, 'outside', 'leak.ts'), "fetch('/api/users')");
    symlinkSync(join(t.base, 'outside'), join(t.projectRoot, 'frontend', 'linked'), 'dir');
    t.out.length = 0;
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', 'frontend', '--project', t.projectRoot], t.io), 0);
    assert.doesNotMatch(t.text(), /leak\.ts/);
  } finally {
    t.cleanup();
  }
});

test('an exchange file with no exchanges verifies nothing and is a usage error', async () => {
  const t = project({ 'evidence/empty.json': '[]' });
  try {
    assert.equal(await runDev(['contract', 'verify', 'APP-88', '--exchange', join(t.projectRoot, 'evidence/empty.json'), '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /holds no exchanges/);
  } finally {
    t.cleanup();
  }
});

test('--client errors are clear: missing, a file, the project root as ".", and --strict with a handled method', async () => {
  const t = project({ 'frontend/a.ts': "axios.post('/api/users', b); if (e.code === 'EMAIL_ALREADY_EXISTS') {} if (e.code === 'INVALID_INPUT') {}" });
  try {
    const usage = (...args: string[]) => runDev(['contract', 'usage', 'APP-88', ...args, '--project', t.projectRoot], t.io);
    assert.equal(await usage('--client', 'nope'), 1);
    assert.match(t.err.join('\n'), /--client "nope": not a directory inside the project/);
    assert.equal(await usage('--client', 'frontend/a.ts'), 1);
    assert.match(t.err.join('\n'), /--client "frontend\/a\.ts": not a directory/);
    t.out.length = 0;
    assert.equal(await usage('--client', '.'), 0);
    assert.match(t.text(), /used: yes/);
    assert.equal(await usage('--client', 'frontend', '--strict'), 0);
  } finally {
    t.cleanup();
  }
});

test('--client . reports project-relative paths once, skips build output, and accepts a path that resolves to the root', async () => {
  const t = project({
    'src/api.ts': "axios.post('/api/users', b);",
    '.next/server/app.js': "axios.post('/api/users', b);",
    'out/index.js': "axios.post('/api/users', b);"
  });
  try {
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', '.', '--client', 'src', '--project', t.projectRoot, '--json'], t.io), 0);
    const json = JSON.parse(t.text());
    assert.deepEqual(json.files, ['src/api.ts']);
    assert.equal(json.scannedFiles, 1);
    t.out.length = 0;
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', 'src/..', '--project', t.projectRoot], t.io), 0);
  } finally {
    t.cleanup();
  }
});

const ALTAVE_CONFIG = 'workspaces:\n  cloud-back: { path: cloud-back }\n  edge-back: { path: edge-back }\n  edge-front: { path: edge-front }\n';
const CALLER = "export const create = (b) => request('/api/users', { method: 'POST', body: JSON.stringify(b) });";

function altave(files: Record<string, string>, contract: object = { ...CONTRACT, producer: 'cloud-back', consumers: ['edge-back', 'edge-front'] }, config: string | null = ALTAVE_CONFIG) {
  const t = setup({ ...(config === null ? {} : { '.dev-agent/config.yml': config }), 'cloud-back/src/x.ts': 'export {}', ...files });
  writeContract(t.projectRoot, dirs, 'APP-88', contract);
  return t;
}

test('contract usage reads the consumers from the contract and reports each one', async () => {
  const t = altave({ 'edge-back/src/api.ts': CALLER, 'edge-front/src/api.ts': CALLER });
  try {
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--project', t.projectRoot], t.io), 0);
    assert.match(t.text(), /consumer edge-back/);
    assert.match(t.text(), /consumer edge-front/);
    assert.equal((t.text().match(/used: yes/g) ?? []).length, 2);
    assert.match(t.text(), /edge-back\/src\/api\.ts/);
  } finally {
    t.cleanup();
  }
});

test('contract usage exits 2 when any consumer never calls the route', async () => {
  const t = altave({ 'edge-back/src/api.ts': CALLER, 'edge-front/src/api.ts': 'export {}' });
  try {
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--project', t.projectRoot], t.io), 2);
    assert.match(t.text(), /consumer edge-front[\s\S]*used: no/);
    t.out.length = 0;
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--project', t.projectRoot, '--json'], t.io), 2);
    const json = JSON.parse(t.text());
    assert.equal(json.consumers['edge-back'].used, true);
    assert.equal(json.consumers['edge-front'].used, false);
  } finally {
    t.cleanup();
  }
});

test('an explicit --client wins over the contract consumers', async () => {
  const t = altave({ 'edge-back/src/api.ts': 'export {}', 'other/api.ts': CALLER });
  try {
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--client', 'other', '--project', t.projectRoot], t.io), 0);
    assert.doesNotMatch(t.text(), /consumer /);
  } finally {
    t.cleanup();
  }
});

test('consumers without a workspaces configuration, or naming an unknown workspace, are usage errors', async () => {
  const t = altave({}, undefined, null);
  try {
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /consumers.*workspaces/);
  } finally {
    t.cleanup();
  }
  const u = altave({}, { ...CONTRACT, consumers: ['ghost'] });
  try {
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--project', u.projectRoot], u.io), 1);
    assert.match(u.err.join('\n'), /unknown workspace "ghost"/);
  } finally {
    u.cleanup();
  }
});

test('contract usage still needs --client when the contract lists no consumers', async () => {
  const t = altave({}, CONTRACT);
  try {
    assert.equal(await runDev(['contract', 'usage', 'APP-88', '--project', t.projectRoot], t.io), 1);
    assert.match(t.err.join('\n'), /--client/);
  } finally {
    t.cleanup();
  }
});

test('contract show prints producer and consumers unchanged', async () => {
  const t = altave({});
  try {
    assert.equal(await runDev(['contract', 'show', 'APP-88', '--project', t.projectRoot], t.io), 0);
    const shown = JSON.parse(t.text());
    assert.equal(shown.producer, 'cloud-back');
    assert.deepEqual(shown.consumers, ['edge-back', 'edge-front']);
  } finally {
    t.cleanup();
  }
});
