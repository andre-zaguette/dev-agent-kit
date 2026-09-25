import { homedir } from 'node:os';
import { effectiveCwd, findKitRoot } from './util.js';
import { run } from './cli.js';

const code = await run(process.argv.slice(2), {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
  cwd: effectiveCwd(process.env, process.cwd(), findKitRoot()),
  homeDir: homedir()
});
process.exitCode = code;
