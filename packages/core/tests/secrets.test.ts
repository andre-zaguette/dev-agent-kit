import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSecret } from '../src/secrets.ts';

const SECRETS: Array<[string, string]> = [
  ['-----BEGIN OPENSSH PRIVATE KEY-----\nabc', 'private key'],
  ['ghp_' + 'a'.repeat(30), 'GitHub token'],
  ['github_pat_' + 'A1_'.repeat(10), 'GitHub token'],
  ['sk-' + 'x'.repeat(24), 'API key'],
  ['AKIA' + 'A'.repeat(16), 'AWS access key'],
  ['xoxb-' + '1234567890', 'Slack token'],
  ['AIza' + 'b'.repeat(35), 'Google API key'],
  ['eyJhbGciOiJI.eyJzdWIiOiIx.abcdefghij', 'JWT'],
  ['npm_' + 'c'.repeat(36), 'npm token'],
  ['Authorization: Bearer ' + 'd'.repeat(30), 'bearer token'],
  ['postgres://admin:hunter22@db.internal/app', 'URL with embedded credentials'],
  ['password = "correct-horse-battery"', 'credential assignment']
];

for (const [sample, label] of SECRETS) {
  test(`findSecret detects ${label}`, () => {
    assert.equal(findSecret(`note: ${sample} end`), label);
  });
}

test('findSecret leaves ordinary prose, ssh remotes and short values alone', () => {
  for (const clean of [
    'Run npm test and read the token docs',
    'git@github.com:org/repo.git',
    'https://example.test/path?x=1',
    'the Bearer scheme is described in the RFC',
    'token: abc'
  ]) {
    assert.equal(findSecret(clean), null, clean);
  }
});

import { redactSecrets } from '../src/secrets.ts';

test('redactSecrets replaces each match with a label that no longer looks like a secret', () => {
  const out = redactSecrets('Password: required-field validation and ghp_' + 'a'.repeat(30) + ' and postgres://admin:hunter22@db/app');
  assert.match(out, /\[redacted credential assignment\] validation/);
  assert.match(out, /\[redacted GitHub token\]/);
  assert.match(out, /\[redacted URL with embedded credentials\]/);
  assert.equal(findSecret(out), null);
  assert.equal(redactSecrets('nothing to see'), 'nothing to see');
});

test('more credential formats are detected and slugs containing sk- are not', () => {
  assert.equal(findSecret('token ATATT3xFfGF0' + 'a'.repeat(30)), 'Atlassian token');
  assert.equal(findSecret('key lin_api_' + 'a'.repeat(30)), 'Linear API key');
  assert.equal(findSecret('Authorization: Basic dXNlcjpwYXNzd29yZDEyMw=='), 'basic auth credential');
  for (const clean of ['a-task-sk-' + 'x'.repeat(24), 'Basic authentication configuration', 'Basic internationalization']) assert.equal(findSecret(clean), null, clean);
});
