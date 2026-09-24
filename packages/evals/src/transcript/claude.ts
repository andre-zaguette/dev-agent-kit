import type { ParsedTranscript, ToolCall, Usage } from '../types.js';
import { skillReadsIn } from './skill-reads.js';

const isObject = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);
const SKILL_NAME = /^[A-Za-z0-9._-]+$/;

function toolCallsFor(name: string, input: Record<string, unknown>): ToolCall[] {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return [{ tool: `${mcp[1]}/${mcp[2]}`, args: input, ok: true }];
  if (name === 'Skill') {
    const skill = String(input.skill ?? input.command ?? '').split(':').pop() ?? '';
    return SKILL_NAME.test(skill) ? [{ tool: `skill/${skill}`, args: input, ok: true }] : [];
  }
  const calls: ToolCall[] = [{ tool: `builtin/${name}`, args: input, ok: true }];
  if (name === 'Read' && typeof input.file_path === 'string') calls.push(...skillReadsIn(input.file_path));
  return calls;
}

export function parseClaudeTranscript(text: string): ParsedTranscript {
  const toolCalls: ToolCall[] = [];
  const byId = new Map<string, ToolCall[]>();
  let finalText = '';
  let usage: Usage | undefined;
  let model: string | undefined;
  let error: string | undefined;
  let sawResult = false;

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  for (const [index, line] of lines.entries()) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return { toolCalls, finalText, usage, model, error: `claude transcript line ${index + 1} is not JSON (truncated?)` };
    }
    if (!isObject(event)) continue;
    if (event.type === 'system' && event.subtype === 'init' && typeof event.model === 'string') model = event.model;
    const content = event.message?.content;
    if (event.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (!isObject(block) || block.type !== 'tool_use' || typeof block.name !== 'string') continue;
        const calls = toolCallsFor(block.name, isObject(block.input) ? block.input : {});
        toolCalls.push(...calls);
        if (typeof block.id === 'string') byId.set(block.id, calls);
      }
    }
    if (event.type === 'user' && Array.isArray(content)) {
      for (const block of content) {
        if (isObject(block) && block.type === 'tool_result' && block.is_error === true) {
          for (const call of byId.get(String(block.tool_use_id)) ?? []) call.ok = false;
        }
      }
    }
    if (event.type === 'result') {
      sawResult = true;
      finalText = typeof event.result === 'string' ? event.result : '';
      const u = isObject(event.usage) ? event.usage : {};
      const input = [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens]
        .filter((n): n is number => typeof n === 'number')
        .reduce((a, b) => a + b, 0);
      usage = {
        inputTokens: input,
        outputTokens: typeof u.output_tokens === 'number' ? u.output_tokens : undefined,
        costUsd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : undefined
      };
      if (event.is_error === true || event.subtype !== 'success') error = `claude finished with ${event.subtype ?? 'an error'}`;
    }
  }
  if (!sawResult) error ??= 'claude transcript has no result event (killed or truncated)';
  return { toolCalls, finalText, usage, model, error };
}
