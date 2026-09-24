#!/usr/bin/env node
// Runs the TypeScript bench through tsx, resolved relative to this file (works from any cwd).
import { register } from 'tsx/esm/api';

register();
const { runBenchCli } = await import('../src/cli.ts');
const { killAllActive } = await import('../src/process.ts');
process.on('SIGINT', () => {
  killAllActive();
  process.exit(130);
});
process.exitCode = await runBenchCli(process.argv.slice(2), {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  cwd: process.env.INIT_CWD ?? process.cwd()
});
