import { homedir } from 'node:os';
import { run } from './cli.js';

const code = await run(process.argv.slice(2), {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
  cwd: process.env.INIT_CWD ?? process.cwd(),
  homeDir: homedir()
});
process.exitCode = code;
