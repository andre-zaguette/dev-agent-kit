import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CheckResult } from './types.js';
import type { ServerLaunch } from './mcp-launch.js';
import { MANIFEST_FILE, readManifest, listSourceSkills } from './sync-skills.js';
import { inspectMarkdownBlock } from './managed-block.js';
import { sha256File, listFilesRecursive, readKitVersion } from './util.js';

export const EXPECTED_TOOLS = [
  'capture_screenshot',
  'compare_screenshots',
  'inspect_dom',
  'run_accessibility_audit',
  'run_responsive_suite'
];

export function checkSkills(skillsDir: string, sourceDir: string): CheckResult {
  if (!existsSync(path.join(skillsDir, MANIFEST_FILE))) {
    return { name: 'skills', ok: false, detail: `no ${MANIFEST_FILE} in ${skillsDir} — run install` };
  }
  let manifest;
  try {
    manifest = readManifest(skillsDir);
  } catch (error) {
    return { name: 'skills', ok: false, detail: (error as Error).message };
  }
  const missing: string[] = [];
  const outdated: string[] = [];
  const edited: string[] = [];
  let count = 0;
  for (const [skill, files] of Object.entries(manifest.skills)) {
    for (const [rel, recorded] of Object.entries(files)) {
      count += 1;
      const installed = path.join(skillsDir, skill, rel);
      if (!existsSync(installed)) {
        missing.push(`${skill}/${rel}`);
        continue;
      }
      const installedHash = sha256File(installed);
      const source = path.join(sourceDir, skill, rel);
      const sourceHash = existsSync(source) ? sha256File(source) : null;
      if (installedHash !== recorded) edited.push(`${skill}/${rel}`);
      else if (sourceHash !== installedHash) outdated.push(`${skill}/${rel}`);
    }
    // Files the kit added to a managed skill since the last install.
    const sourceSkillDir = path.join(sourceDir, skill);
    if (existsSync(sourceSkillDir)) {
      for (const rel of listFilesRecursive(sourceSkillDir).map((p) => p.split(path.sep).join('/'))) {
        if (!(rel in files)) outdated.push(`${skill}/${rel}`);
      }
    }
  }
  // A whole skill the kit added since the last install — not in the manifest at all yet.
  const shadowed: string[] = [];
  for (const skill of listSourceSkills(sourceDir)) {
    if (skill in manifest.skills) continue;
    // A user-owned skill with the same name shadows the kit's; install skips it, so it is a note, not a failure.
    if (existsSync(path.join(skillsDir, skill))) {
      shadowed.push(skill);
      continue;
    }
    for (const rel of listFilesRecursive(path.join(sourceDir, skill)).map((p) => p.split(path.sep).join('/'))) {
      outdated.push(`${skill}/${rel}`);
    }
  }
  if (missing.length > 0) {
    return { name: 'skills', ok: false, detail: `missing managed files: ${missing.join(', ')}` };
  }
  if (outdated.length > 0) {
    return { name: 'skills', ok: false, detail: `outdated vs the kit: ${outdated.join(', ')} — run install` };
  }
  const note =
    (edited.length > 0 ? `; locally edited (kept by design): ${edited.join(', ')}` : '') +
    shadowed
      .map((skill) => `; user-owned skill \`${skill}\` shadows the kit's; kit version not installed — rename or remove yours to install it`)
      .join('');
  return {
    name: 'skills',
    ok: true,
    detail: `${Object.keys(manifest.skills).length} skills, ${count} files (kit ${manifest.kitVersion}) in ${skillsDir}${note}`
  };
}

export function checkInstructions(filePath: string): CheckResult {
  const { present, error } = inspectMarkdownBlock(filePath);
  return {
    name: 'instructions',
    ok: present,
    detail: present
      ? `frontend-agent-kit block present in ${filePath}`
      : error
        ? error
        : `no frontend-agent-kit block in ${filePath} — run install`
  };
}

export function checkLaunchConfig(launch: ServerLaunch | null, projectRoot: string, sourceLabel: string): CheckResult {
  const name = 'mcp-config';
  if (!launch) return { name, ok: false, detail: `no "frontend-agent" server in ${sourceLabel} — run install` };
  if (!existsSync(launch.command)) {
    return { name, ok: false, detail: `server command ${launch.command} does not exist — run npm install in the kit checkout` };
  }
  const script = launch.args[0];
  if (!script || !existsSync(script)) {
    return { name, ok: false, detail: `server entry ${script ?? '(none)'} does not exist` };
  }
  const resolvedEnv = path.resolve(launch.env.FRONTEND_AGENT_PROJECT_ROOT ?? '');
  const resolvedProject = path.resolve(projectRoot);
  if (resolvedEnv !== resolvedProject) {
    return {
      name,
      ok: false,
      detail: `FRONTEND_AGENT_PROJECT_ROOT is "${launch.env.FRONTEND_AGENT_PROJECT_ROOT ?? ''}", expected "${projectRoot}" — re-run install`
    };
  }
  return { name, ok: true, detail: `${sourceLabel} starts ${script} for ${projectRoot}` };
}

export async function probeServer(launch: ServerLaunch, timeoutMs = 20000): Promise<CheckResult> {
  const name = 'mcp-server';
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: { ...getDefaultEnvironment(), ...launch.env },
    stderr: 'pipe'
  });
  const client = new Client({ name: 'frontend-agent-verify', version: readKitVersion() });
  let timer: NodeJS.Timeout | undefined;
  let stderrTail = '';

  // Drain stderr to prevent buffer fill; keep only last 2000 chars
  if (transport.stderr) {
    transport.stderr.on('data', (chunk: Buffer) => {
      stderrTail += chunk.toString('utf8');
      if (stderrTail.length > 2000) {
        stderrTail = stderrTail.slice(-2000);
      }
    });
  }

  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    const listed = await Promise.race([
      (async () => {
        await client.connect(transport);
        return client.listTools();
      })(),
      timeout
    ]);
    const names = listed.tools.map((tool) => tool.name).sort();
    const missing = EXPECTED_TOOLS.filter((tool) => !names.includes(tool));
    if (missing.length > 0) return { name, ok: false, detail: `server started but is missing tools: ${missing.join(', ')}` };
    return { name, ok: true, detail: `server started; tools: ${names.join(', ')}` };
  } catch (error) {
    const message = (error as Error).message;
    let detail: string;
    if (message.startsWith('timed out')) {
      detail = `server ${message}`;
    } else if (message.includes('Connection closed')) {
      detail = `the MCP server exited during startup: ${message}`;
    } else {
      detail = `could not start the MCP server: ${message}`;
    }
    if (stderrTail.trim()) {
      detail += ` — server stderr (tail): ${stderrTail.trim()}`;
    }
    return { name, ok: false, detail };
  } finally {
    if (timer) clearTimeout(timer);
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    (transport.stderr as any)?.destroy?.();
  }
}
