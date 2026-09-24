import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseClaudeTranscript } from '../src/transcript/claude.ts';
import { parseCodexTranscript } from '../src/transcript/codex.ts';

const data = (name: string) => readFileSync(new URL(`./data/${name}`, import.meta.url), 'utf8');
const tools = (calls: { tool: string }[]) => calls.map((c) => c.tool);

test('claude: MCP names normalized, Skill and reference reads detected, errors marked, result/usage read', () => {
  const t = parseClaudeTranscript(data('claude-sample.jsonl'));
  assert.equal(t.error, undefined);
  assert.equal(t.model, 'claude-opus-5-5');
  assert.deepEqual(tools(t.toolCalls), [
    'skill/figma-to-code',
    'builtin/Read',
    'reference/react',
    'builtin/ToolSearch',
    'figma/get_design_context',
    'frontend-agent/inspect_dom'
  ]);
  assert.deepEqual(t.toolCalls[4].args, { nodeId: '1:2' });
  assert.equal(t.toolCalls[4].ok, true);
  assert.equal(t.toolCalls[5].ok, false);
  assert.equal(t.finalText, 'Implemented. VEREDITO: PASS');
  assert.deepEqual(t.usage, { inputTokens: 1106, outputTokens: 42, costUsd: 0.06 });
});

test('claude: a transcript without a result event (killed) is an error', () => {
  const lines = data('claude-sample.jsonl').trim().split('\n');
  const t = parseClaudeTranscript(lines.slice(0, -1).join('\n'));
  assert.match(t.error ?? '', /no result event/);
});

test('claude: a truncated last line is an error, and an error result is an error', () => {
  const lines = data('claude-sample.jsonl').trim().split('\n');
  assert.match(parseClaudeTranscript([...lines.slice(0, 3), '{"type":"assis'].join('\n')).error ?? '', /line 4 is not JSON/);
  const failed = lines.slice(0, -1).concat('{"type":"result","subtype":"error_max_turns","is_error":true,"result":""}');
  assert.match(parseClaudeTranscript(failed.join('\n')).error ?? '', /error_max_turns/);
});

test('codex: MCP calls from completed items only, shell skill reads, final message, usage', () => {
  const t = parseCodexTranscript(data('codex-sample.jsonl'));
  assert.equal(t.error, undefined);
  assert.deepEqual(tools(t.toolCalls), [
    'builtin/shell',
    'skill/figma-to-code',
    'figma/get_design_context',
    'frontend-agent/inspect_dom',
    'builtin/file_change'
  ]);
  assert.equal(t.toolCalls[2].ok, true);
  assert.equal(t.toolCalls[3].ok, false);
  assert.equal(t.finalText, 'DONE\nVEREDITO: FAIL');
  assert.deepEqual(t.usage, { inputTokens: 41896, outputTokens: 125 });
});

test('codex: missing turn.completed, turn.failed and error events are errors', () => {
  const lines = data('codex-sample.jsonl').trim().split('\n');
  assert.match(parseCodexTranscript(lines.slice(0, -1).join('\n')).error ?? '', /no turn\.completed/);
  assert.match(parseCodexTranscript(lines.slice(0, -1).concat('{"type":"turn.failed","error":{"message":"quota"}}').join('\n')).error ?? '', /quota/);
  assert.match(parseCodexTranscript('{"type":"error","message":"not logged in"}').error ?? '', /not logged in/);
});
