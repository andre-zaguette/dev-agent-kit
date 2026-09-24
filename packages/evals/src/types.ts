import type { HostId } from './schema.js';

export interface ToolCall {
  /** "<server>/<tool>", "skill/<name>", "reference/<name>" or "builtin/<name>". */
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface ParsedTranscript {
  toolCalls: ToolCall[];
  finalText: string;
  usage?: Usage;
  model?: string;
  /** Set when the transcript shows the run did not finish cleanly. */
  error?: string;
}

export interface RunRecord extends ParsedTranscript {
  host: HostId;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  stderrTail: string;
}
