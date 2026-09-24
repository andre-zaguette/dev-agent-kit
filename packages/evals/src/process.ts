import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import type { HostRunSpec } from './hosts.js';

export interface ProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderrTail: string;
  /** True when stdout hit `maxOutputBytes`; the process was killed and `stdout` holds only what fit. */
  outputTruncated: boolean;
  spawnError?: string;
  durationMs: number;
}

const active = new Set<ChildProcess>();
const KILL_GRACE_MS = 3000;
export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // group already gone
  }
}

/** Kill every running host process group (used on SIGINT). */
export function killAllActive(): void {
  for (const child of active) killGroup(child, 'SIGKILL');
}

/** Run a host in its own process group; stdout is streamed to `transcriptPath` and returned. */
export function runProcess(
  spec: HostRunSpec,
  timeoutMs: number,
  transcriptPath: string,
  options: { maxOutputBytes?: number } = {}
): Promise<ProcessResult> {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const started = Date.now();
  return new Promise((resolve) => {
    const transcript = createWriteStream(transcriptPath);
    let stdout = '';
    let stdoutBytes = 0;
    let outputTruncated = false;
    let stderrTail = '';
    let timedOut = false;
    let spawnError: string | undefined;
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    active.add(child);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (outputTruncated) return;
      const room = maxOutputBytes - stdoutBytes;
      const kept = chunk.length > room ? chunk.subarray(0, Math.max(room, 0)) : chunk;
      stdoutBytes += kept.length;
      stdout += kept.toString('utf8');
      transcript.write(kept);
      if (chunk.length > room) {
        outputTruncated = true;
        killGroup(child, 'SIGTERM');
        setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS).unref();
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, 'SIGTERM');
      setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS).unref();
    }, timeoutMs);
    child.on('error', (error: NodeJS.ErrnoException) => {
      spawnError = error.code === 'ENOENT' ? `host command not found: ${spec.command}` : error.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      active.delete(child);
      // The host may exit before its children (e.g. MCP servers); make sure none survive.
      killGroup(child, 'SIGKILL');
      transcript.end(() =>
        resolve({ exitCode: spawnError ? null : code, timedOut, stdout, stderrTail, outputTruncated, spawnError, durationMs: Date.now() - started })
      );
    });
  });
}
