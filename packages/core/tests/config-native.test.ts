// packages/core/tests/config-native.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDevAgentConfig } from '../src/config.ts';
import { isNativeAdapter, NATIVE_ADAPTERS } from '../src/task-sources/types.ts';

const src = (body: string): string => `taskSources:\n  work:\n${body.split('\n').map((l) => `    ${l}`).join('\n')}\n`;
const parse = (body: string) => parseDevAgentConfig(src(body)).taskSources[0];

test('the four native adapters parse with their own keys', () => {
  assert.deepEqual(NATIVE_ADAPTERS, ['github-issues', 'linear', 'jira', 'youtrack']);
  assert.equal(isNativeAdapter('jira'), true);
  assert.equal(isNativeAdapter('generic-mcp'), false);

  const gh = parse('adapter: github-issues\ntokenEnv: GH_TOKEN\nrepo: acme/app\nidentifiers: ["^#\\\\d+$"]');
  assert.equal(gh.tokenEnv, 'GH_TOKEN');
  assert.equal(gh.repo, 'acme/app');
  assert.equal(gh.baseUrl, undefined);
  assert.equal(parse('adapter: github-issues\ntokenEnv: GH_TOKEN\nrepo: acme/app\nbaseUrl: https://ghe.example.com/api/v3/').baseUrl, 'https://ghe.example.com/api/v3');

  assert.equal(parse('adapter: linear\ntokenEnv: LINEAR_KEY').tokenEnv, 'LINEAR_KEY');

  const cloud = parse('adapter: jira\nbaseUrl: https://acme.example.net\ntokenEnv: JIRA_TOKEN\nemailEnv: JIRA_EMAIL');
  assert.equal(cloud.auth, 'cloud');
  assert.equal(cloud.emailEnv, 'JIRA_EMAIL');
  const bearer = parse('adapter: jira\nbaseUrl: https://jira.example.net\ntokenEnv: JIRA_PAT\nauth: bearer');
  assert.equal(bearer.auth, 'bearer');
  assert.equal(bearer.emailEnv, undefined);

  const yt = parse('adapter: youtrack\nbaseUrl: https://tracker.example.com\ntokenEnv: YT_TOKEN');
  assert.equal(yt.baseUrl, 'https://tracker.example.com');
  assert.deepEqual(yt.tools, {});
});

test('native adapters reject missing, foreign and malformed keys', () => {
  const cases: Array<[string, RegExp]> = [
    ['adapter: linear', /taskSources\.work\.tokenEnv is required/],
    ['adapter: linear\ntokenEnv: lower_case', /taskSources\.work\.tokenEnv/],
    ['adapter: linear\ntokenEnv: LINEAR_KEY\nbaseUrl: https://api.example.com', /baseUrl is not valid for the linear adapter/],
    ['adapter: github-issues\ntokenEnv: GH_TOKEN', /taskSources\.work\.repo is required/],
    ['adapter: github-issues\ntokenEnv: GH_TOKEN\nrepo: not-a-repo', /repo must look like "owner\/name"/],
    ['adapter: github-issues\ntokenEnv: GH_TOKEN\nrepo: ../..', /repo must look like "owner\/name"/],
    ['adapter: github-issues\ntokenEnv: GH_TOKEN\nrepo: acme/..', /repo must look like "owner\/name"/],
    ['adapter: github-issues\ntokenEnv: GH_TOKEN\nrepo: acme/app\nbaseUrl: http://ghe.example.com', /baseUrl must be an https URL/],
    ['adapter: jira\ntokenEnv: T\nbaseUrl: https://u@jira.example.net\nemailEnv: E', /baseUrl must be an https URL without credentials/],
    ['adapter: jira\ntokenEnv: T\nbaseUrl: https://jira.example.net?x=1\nemailEnv: E', /baseUrl must be an https URL without credentials/],
    ['adapter: jira\ntokenEnv: T\nemailEnv: E', /baseUrl is required/],
    ['adapter: jira\ntokenEnv: T\nbaseUrl: https://jira.example.net', /emailEnv is required when auth is "cloud"/],
    ['adapter: jira\ntokenEnv: T\nbaseUrl: https://jira.example.net\nauth: bearer\nemailEnv: E', /emailEnv is not used when auth is "bearer"/],
    ['adapter: jira\ntokenEnv: T\nbaseUrl: https://jira.example.net\nemailEnv: E\nauth: basic', /auth must be "cloud" or "bearer"/],
    ['adapter: youtrack\ntokenEnv: T\nbaseUrl: https://t.example.com\nauth: bearer', /auth is not valid for the youtrack adapter/],
    ['adapter: youtrack\ntokenEnv: T\nbaseUrl: https://t.example.com\nserver: x', /does not take server, tools or mapping/],
    ['adapter: youtrack\ntokenEnv: T\nbaseUrl: https://t.example.com\ntools:\n  get: { name: x }', /does not take server, tools or mapping/],
    ['adapter: my-custom\ntokenEnv: T', /tokenEnv is only valid for the github-issues, linear, jira, youtrack adapters/]
  ];
  for (const [body, pattern] of cases) assert.throws(() => parse(body), pattern, body);
});

test('a generic-mcp source is unchanged', () => {
  const s = parse('adapter: generic-mcp\nserver: company-tasks\ntools:\n  get: { name: get_issue }\nmapping: { key: key, title: summary }');
  assert.equal(s.server, 'company-tasks');
  assert.equal(s.tokenEnv, undefined);
});
