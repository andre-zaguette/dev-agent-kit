import type { ParsedTranscript, ToolCall, Usage } from '../types.js';
import { skillReadsIn } from './skill-reads.js';

const isObject = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseCodexTranscript(text: string): ParsedTranscript {
  const toolCalls: ToolCall[] = [];
  let finalText = '';
  let usage: Usage | undefined;
  let error: string | undefined;
  let completed = false;

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  for (const [index, line] of lines.entries()) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return { toolCalls, finalText, usage, error: `codex transcript line ${index + 1} is not JSON (truncated?)` };
    }
    if (!isObject(event)) continue;
    if (event.type === 'item.completed' && isObject(event.item)) {
      const item = event.item;
      if (item.type === 'mcp_tool_call' && typeof item.server === 'string' && typeof item.tool === 'string') {
        toolCalls.push({
          tool: `${item.server}/${item.tool}`,
          args: isObject(item.arguments) ? item.arguments : {},
          ok: item.status === 'completed' && !item.error
        });
      } else if (item.type === 'command_execution') {
        const command = typeof item.command === 'string' ? item.command : '';
        toolCalls.push({ tool: 'builtin/shell', args: { command }, ok: item.exit_code === 0 });
        toolCalls.push(...skillReadsIn(command));
      } else if (item.type === 'file_change') {
        toolCalls.push({ tool: 'builtin/file_change', args: { changes: item.changes }, ok: item.status === 'completed' });
      } else if (item.type === 'agent_message' && typeof item.text === 'string') {
        finalText = item.text;
      }
    } else if (event.type === 'turn.completed') {
      completed = true;
      const u = isObject(event.usage) ? event.usage : {};
      const out = [u.output_tokens, u.reasoning_output_tokens].filter((n): n is number => typeof n === 'number');
      usage = {
        inputTokens: typeof u.input_tokens === 'number' ? u.input_tokens : undefined,
        outputTokens: out.length ? out.reduce((a, b) => a + b, 0) : undefined
      };
    } else if (event.type === 'turn.failed') {
      error = `codex turn failed: ${event.error?.message ?? 'unknown error'}`;
    } else if (event.type === 'error') {
      error = `codex error: ${event.message ?? 'unknown error'}`;
    }
  }
  if (!completed) error ??= 'codex transcript has no turn.completed event (killed or truncated)';
  return { toolCalls, finalText, usage, error };
}
