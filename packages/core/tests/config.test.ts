import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, loadDevAgentConfig, parseDevAgentConfig } from '../src/config.ts';

const FULL = String.raw`
baseBranch: main
branchPattern: "{type}/{keyLower}-{slug}"
taskDocsDir: .dev-agent/tasks
stateDir: .dev-agent/state
knowledgeDir: .dev-agent/knowledge
contextMode: balanced
production:
  readOnly: true
git:
  updateStrategy: ff-only
  requireCleanTree: true
taskMode:
  analyzeCommand: plan-only
taskSources:
  company:
    adapter: generic-mcp
    server: company-tasks
    default: true
    identifiers:
      - '^HEF-\d+$'
      - '^PAY-\d+$'
    tools:
      get:
        name: get_issue
        arg: key
      comments:
        name: get_comments
        list: comments
    mapping:
      id: id
      key: key
      title: summary
      description: description
      status: status.name
      comments:
        body: text
        author: user.name
  personal:
    adapter: generic-mcp
    server: my-notes
    tools:
      get:
        name: read_ticket
    mapping:
      key: reference
      title: subject
`;

test('the full example parses into typed settings', () => {
  const cfg = parseDevAgentConfig(FULL);
  assert.equal(cfg.baseBranch, 'main');
  assert.equal(cfg.branchPattern, '{type}/{keyLower}-{slug}');
  assert.equal(cfg.contextMode, 'balanced');
  assert.equal(cfg.taskMode.analyzeCommand, 'plan-only');
  assert.deepEqual(cfg.taskSources.map((s) => s.id), ['company', 'personal']);
  const company = cfg.taskSources[0];
  assert.equal(company.default, true);
  assert.equal(company.server, 'company-tasks');
  assert.ok(company.identifiers[0].test('HEF-12'));
  assert.equal(company.identifiers[0].test('HEF-x'), false);
  assert.deepEqual(company.tools.get, { name: 'get_issue', arg: 'key' });
  assert.deepEqual(company.tools.comments, { name: 'get_comments', list: 'comments' });
  assert.deepEqual(company.mapping.fields, { id: 'id', key: 'key', title: 'summary', description: 'description', status: 'status.name' });
  assert.deepEqual(company.mapping.comments, { body: 'text', author: 'user.name' });
  assert.equal(cfg.taskSources[1].default, false);
});

test('an empty or missing file yields the defaults', () => {
  const d = defaultConfig();
  assert.equal(d.taskDocsDir, '.dev-agent/tasks');
  assert.equal(d.stateDir, '.dev-agent/state');
  assert.equal(d.knowledgeDir, '.dev-agent/knowledge');
  assert.equal(d.contextMode, 'balanced');
  assert.equal(d.production.readOnly, true);
  assert.equal(d.taskMode.analyzeCommand, 'plan-only');
  assert.deepEqual(d.taskSources, []);
  assert.deepEqual(parseDevAgentConfig(''), d);
  const dir = mkdtempSync(join(tmpdir(), 'dak-cfg-'));
  try {
    assert.deepEqual(loadDevAgentConfig(dir), d);
    mkdirSync(join(dir, '.dev-agent'));
    writeFileSync(join(dir, '.dev-agent', 'config.yml'), 'baseBranch: develop\n');
    assert.equal(loadDevAgentConfig(dir).baseBranch, 'develop');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const bad = (yaml: string, pattern: RegExp) => assert.throws(() => parseDevAgentConfig(yaml), pattern, yaml);
const source = (extra = '') => String.raw`
taskSources:
  company:
    adapter: generic-mcp
    server: s
    tools:
      get:
        name: g
    mapping:
      key: k
      title: t
${extra}`;

test('invalid configurations are refused with the setting named', () => {
  bad('taskSources: {A: {adapter: generic-mcp}}', /taskSources\.A/);
  bad('nope: 1', /nope.*not a recognized setting/);
  bad('git:\n  requireCleanTree: false', /requireCleanTree/);
  bad('git:\n  updateStrategy: rebase', /updateStrategy/);
  bad('taskDocsDir: /etc', /taskDocsDir.*relative/);
  bad('stateDir: ../outside', /stateDir.*inside the project/);
  bad('knowledgeDir: a\\b', /knowledgeDir/);
  bad('taskMode:\n  analyzeCommand: yolo', /analyzeCommand/);
  bad('key: [unclosed', /invalid YAML/);
  bad(source().replace('key: k\n      title: t', 'title: t'), /mapping\.key.*required/);
  bad(source().replace('    server: s\n', ''), /server.*required/);
  bad(source().replace('    tools:\n      get:\n        name: g\n', ''), /tools\.get.*required/);
  bad(source().replace('key: k', 'key: __proto__.x'), /mapping\.key/);
  bad(source().replace('key: k', 'key: "a b"'), /mapping\.key/);
  bad(source().replace('title: t', 'titel: t'), /mapping\.titel.*not a recognized/);
});

test('two default sources, or a source id that is not a lowercase alias, are refused', () => {
  const two = String.raw`
taskSources:
  a:
    adapter: generic-mcp
    server: s
    default: true
    tools: {get: {name: g}}
    mapping: {key: k, title: t}
  b:
    adapter: generic-mcp
    server: s
    default: true
    tools: {get: {name: g}}
    mapping: {key: k, title: t}
`;
  bad(two, /only one.*default/);
  bad(source().replace('  company:', '  Company:'), /Company/);
});

test('identifier regexes: invalid, double-escaped, backtracking-prone and oversized are refused', () => {
  bad(source(String.raw`    identifiers: ['(unclosed']`), /identifiers\[0\].*valid regular expression/);
  bad(source(String.raw`    identifiers: ['^HEF-\\d+$']`), /double-escaped/);
  bad(source(String.raw`    identifiers: ['^(a+)+$']`), /backtracking/);
  bad(source(`    identifiers: ['${'a'.repeat(201)}']`), /longer than 200/);
  bad(source('    identifiers: nope'), /list of regular expressions/);
});

test('secret-looking text anywhere in the file is refused', () => {
  bad('baseBranch: main\n# token: ghp_' + 'a'.repeat(30), /secret/);
});

test('prototype-named mapping keys are a clear error, not a crash', () => {
  for (const key of ['toString', 'constructor', 'hasOwnProperty']) {
    bad(source().replace('key: k', `key: k\n      ${key}: {id: x}`), new RegExp(`mapping\\.${key}.*not a recognized`));
  }
});

test('the task, state and knowledge directories may not overlap, repeat or live under .git', () => {
  bad('taskDocsDir: a/tasks\nstateDir: a/tasks/state', /overlap/);
  bad('stateDir: a\nknowledgeDir: a/knowledge', /overlap/);
  bad('taskDocsDir: same\nstateDir: same', /overlap/);
  bad('knowledgeDir: .git/hooks', /\.git/);
  bad('stateDir: .git', /\.git/);
  assert.doesNotThrow(() => parseDevAgentConfig('taskDocsDir: a/tasks\nstateDir: a/state\nknowledgeDir: a/knowledge'));
});

test('a v1.0 config parses with an empty workspaces list and defaults carry none', () => {
  assert.deepEqual(parseDevAgentConfig(FULL).workspaces, []);
  assert.deepEqual(defaultConfig().workspaces, []);
});
