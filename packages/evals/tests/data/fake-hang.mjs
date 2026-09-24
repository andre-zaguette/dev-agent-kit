// Emits one line, starts a grandchild that records its pid, then both hang.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
process.stdout.write('{"type":"system","subtype":"init"}\n');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(process.env.FAKE_PID_FILE, String(child.pid));
setInterval(() => {}, 1000);
