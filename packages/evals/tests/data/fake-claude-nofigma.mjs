import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const fail = (msg) => { process.stderr.write(`fake-claude-nofigma: ${msg}\n`); process.exit(2); };
const at = (flag) => args[args.indexOf(flag) + 1];
const config = JSON.parse(readFileSync(at('--mcp-config'), 'utf8'));
if (!config.mcpServers['frontend-agent']) fail('frontend-agent server missing');
if ('figma' in config.mcpServers) fail('the Figma mock must not be started for a scenario without figma');
if (Object.keys(config.mcpServers).length !== 1) fail('expected exactly one MCP server');
if (!existsSync('.claude/skills')) fail('kit not installed into the workspace');
writeFileSync('out.txt', 'ok');
const lines = [
  { type: 'system', subtype: 'init', model: 'fake-model' },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: `${process.cwd()}/.claude/skills/backend-architecture/SKILL.md` } }] } },
  { type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 } }
];
for (const line of lines) process.stdout.write(`${JSON.stringify(line)}\n`);
