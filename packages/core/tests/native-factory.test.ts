// packages/core/tests/native-factory.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeAdapter } from '../src/task-sources/native/index.ts';
import { SourceUnavailableError, WorkItemNotFoundError } from '../src/task-sources/types.ts';
import { fakeFetch, sourceConfig } from './native-helpers.ts';

const SECRET = 'plain-secret-value-xyz';
const CASES = [
  { adapter: 'github-issues', extra: { repo: 'acme/app' }, id: '42', env: { TRACKER_TOKEN: SECRET } },
  { adapter: 'linear', extra: {}, id: 'ENG-1', env: { TRACKER_TOKEN: SECRET } },
  { adapter: 'jira', extra: { baseUrl: 'https://acme.example.net', auth: 'cloud' as const, emailEnv: 'MAIL' }, id: 'PROJ-1', env: { TRACKER_TOKEN: SECRET, MAIL: 'me@example.com' } },
  { adapter: 'youtrack', extra: { baseUrl: 'https://tracker.example.com' }, id: 'PROJ-1', env: { TRACKER_TOKEN: SECRET } }
];

test('the factory builds each native adapter and reads only the configured variables', () => {
  for (const c of CASES) {
    const adapter = createNativeAdapter(sourceConfig(c.adapter, c.extra), { env: c.env, fetch: fakeFetch([]).fetch });
    assert.equal(adapter.id, 'work');
    assert.equal(adapter.capabilities().write, false);
  }
});

test('an unset or empty variable is a clear auth error that names the variable', () => {
  for (const env of [{}, { TRACKER_TOKEN: '' }, { TRACKER_TOKEN: '   ' }]) {
    assert.throws(() => createNativeAdapter(sourceConfig('linear'), { env, fetch: fakeFetch([]).fetch }), (e: Error) => e instanceof SourceUnavailableError && e.reason === 'auth' && /TRACKER_TOKEN is not set/.test(e.message));
  }
  assert.throws(() => createNativeAdapter(sourceConfig('jira', CASES[2].extra), { env: { TRACKER_TOKEN: SECRET }, fetch: fakeFetch([]).fetch }), /MAIL is not set/);
});

test('a non-native config is refused', () => {
  assert.throws(() => createNativeAdapter(sourceConfig('generic-mcp'), { env: {}, fetch: fakeFetch([]).fetch }), /not a native source/);
});

test('no adapter leaks the token: not in errors that echo it, not in the work item, not in the request URL', async () => {
  for (const c of CASES) {
    const echo = fakeFetch([{ match: () => true, status: 500, text: `server said: ${SECRET} / Basic ${Buffer.from(`me@example.com:${SECRET}`).toString('base64')}` }]);
    const adapter = createNativeAdapter(sourceConfig(c.adapter, c.extra), { env: c.env, fetch: echo.fetch });
    await assert.rejects(adapter.getWorkItem(c.id), (e: Error) => {
      assert.ok(e instanceof SourceUnavailableError, c.adapter);
      assert.equal(e.message.includes(SECRET), false, `${c.adapter}: ${e.message}`);
      if (c.adapter === 'jira') assert.equal(e.message.includes(Buffer.from(`me@example.com:${SECRET}`).toString('base64')), false, c.adapter);
      return true;
    });
    for (const call of echo.calls) assert.equal(call.url.includes(SECRET), false, `${c.adapter} URL`);
  }
});

test('every adapter refuses an identifier that is not a key, with zero requests', async () => {
  for (const c of CASES) {
    const none = fakeFetch([{ match: () => true, json: {} }]);
    const adapter = createNativeAdapter(sourceConfig(c.adapter, c.extra), { env: c.env, fetch: none.fetch });
    for (const bad of ['../etc/passwd', 'x?y=z', 'a b', '\u0000', 'ENG-1\n']) await assert.rejects(adapter.getWorkItem(bad), WorkItemNotFoundError, `${c.adapter} ${JSON.stringify(bad)}`);
    assert.equal(none.calls.length, 0, c.adapter);
  }
});
