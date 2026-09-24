import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClaudeRun, buildCodexRun, tomlValue, type McpServerSpec } from '../src/hosts.ts';
import { runProcess } from '../src/process.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const servers: McpServerSpec[] = [
  { name: 'frontend-agent', command: '/kit/node_modules/.bin/tsx', args: ['/kit/mcp.ts'], env: { FRONTEND_AGENT_PROJECT_ROOT: '/tmp/ws' } },
  { name: 'figma', command: '/kit/node_modules/.bin/tsx', args: ['/kit/figma.ts'], env: { FIGMA_MOCK_FIXTURE: '/kit/f "q".json' } }
];

test('claude: strict MCP config file, project settings only, allowlisted tools, never bypassPermissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fak-hosts-'));
  try {
    const cfg = join(dir, 'claude-mcp.json');
    const spec = buildClaudeRun({ workspace: '/tmp/ws', prompt: 'do it', servers, mcpConfigPath: cfg, binary: { command: 'claude', prefixArgs: [] }, model: 'opus' });
    assert.equal(spec.cwd, '/tmp/ws');
    assert.deepEqual(spec.args.slice(0, 2), ['-p', 'do it']);
    const at = (flag: string) => spec.args[spec.args.indexOf(flag) + 1];
    assert.equal(at('--output-format'), 'stream-json');
    assert.equal(at('--mcp-config'), cfg);
    assert.ok(spec.args.includes('--strict-mcp-config'));
    assert.equal(at('--setting-sources'), 'project');
    assert.equal(at('--permission-mode'), 'acceptEdits');
    assert.equal(at('--model'), 'opus');
    assert.deepEqual(at('--allowedTools').split(','), [
      'Read(/tmp/ws/**)',
      'Edit(/tmp/ws/**)',
      'Write(/tmp/ws/**)',
      'Glob(/tmp/ws/**)',
      'Grep(/tmp/ws/**)',
      'Skill',
      'ToolSearch',
      'mcp__frontend-agent',
      'mcp__figma'
    ]);
    assert.ok(!spec.args.join(' ').includes('bypass'));
    const written = JSON.parse(readFileSync(cfg, 'utf8'));
    assert.deepEqual(Object.keys(written.mcpServers), ['frontend-agent', 'figma']);
    assert.equal(written.mcpServers.figma.type, 'stdio');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claude: file tools are scoped to the workspace, never granted as bare names (final-review finding: bare Edit/Write let the agent write anywhere the user can)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fak-hosts-'));
  try {
    const spec = buildClaudeRun({
      workspace: '/tmp/ws',
      prompt: 'do it',
      servers,
      mcpConfigPath: join(dir, 'claude-mcp.json'),
      binary: { command: 'claude', prefixArgs: [] }
    });
    const allowed = spec.args[spec.args.indexOf('--allowedTools') + 1].split(',');
    for (const fileTool of ['Read', 'Edit', 'Write', 'Glob', 'Grep']) {
      assert.ok(!allowed.includes(fileTool), `${fileTool} must not be granted unscoped`);
      assert.ok(allowed.includes(`${fileTool}(/tmp/ws/**)`), `${fileTool} must be scoped to the workspace`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('codex: MCP servers via -c with auto-approval, user config ignored, workspace-write sandbox, prompt last', () => {
  const spec = buildCodexRun({ workspace: '/tmp/ws', prompt: 'do it', servers, binary: { command: 'codex', prefixArgs: [] } });
  const joined = spec.args.join('\n');
  for (const flag of ['exec', '--json', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral']) assert.ok(spec.args.includes(flag), flag);
  assert.equal(spec.args[spec.args.indexOf('--sandbox') + 1], 'workspace-write');
  assert.equal(spec.args[spec.args.indexOf('-C') + 1], '/tmp/ws');
  assert.match(joined, /^mcp_servers\.figma\.command="\/kit\/node_modules\/\.bin\/tsx"$/m);
  assert.match(joined, /^mcp_servers\.figma\.args=\["\/kit\/figma\.ts"\]$/m);
  assert.match(joined, /^mcp_servers\.figma\.env=\{FIGMA_MOCK_FIXTURE="\/kit\/f \\"q\\"\.json"\}$/m);
  assert.match(joined, /^mcp_servers\.frontend-agent\.default_tools_approval_mode="approve"$/m);
  assert.equal(spec.args.at(-1), 'do it');
});

test('tomlValue rejects keys that are not bare TOML keys', () => {
  assert.throws(() => tomlValue({ 'bad key': 'x' }), /not a bare TOML key/);
});

test('runProcess: timeout kills the whole process group, including grandchildren', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fak-proc-'));
  const pidFile = join(dir, 'pid');
  process.env.FAKE_PID_FILE = pidFile;
  try {
    const result = await runProcess({ command: process.execPath, args: [join(here, 'data', 'fake-hang.mjs')], cwd: dir }, 1500, join(dir, 't.jsonl'));
    assert.equal(result.timedOut, true);
    assert.match(readFileSync(join(dir, 't.jsonl'), 'utf8'), /"init"/);
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 300));
    assert.throws(() => process.kill(grandchild, 0), /ESRCH/);
  } finally {
    delete process.env.FAKE_PID_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runProcess: a missing binary is a spawnError, not a crash', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fak-proc-'));
  try {
    const result = await runProcess({ command: join(dir, 'no-such-host'), args: [], cwd: dir }, 5000, join(dir, 't.jsonl'));
    assert.match(result.spawnError ?? '', /not found|ENOENT/);
    assert.equal(existsSync(join(dir, 't.jsonl')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
