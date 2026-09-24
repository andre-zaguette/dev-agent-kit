import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const fail = (msg) => { process.stderr.write(`fake-claude: ${msg}\n`); process.exit(2); };
const at = (flag) => args[args.indexOf(flag) + 1];
if (!args.includes('--strict-mcp-config')) fail('missing --strict-mcp-config');
const config = JSON.parse(readFileSync(at('--mcp-config'), 'utf8'));
if (!config.mcpServers['frontend-agent'] || !config.mcpServers.figma) fail('servers missing from MCP config');
if (config.mcpServers['frontend-agent'].env.FRONTEND_AGENT_PROJECT_ROOT !== process.cwd()) fail('project root is not the workspace');
if (!existsSync('.claude/skills') || !existsSync('CLAUDE.md')) fail('kit not installed into the workspace');
if (readFileSync('.frontend-agent/config.yml', 'utf8').trim() !== 'validationProfile: standard') fail('profile config not written');
const prompt = args[args.indexOf('-p') + 1];
const baseUrl = /http:\/\/127\.0\.0\.1:\d+/.exec(prompt)?.[0] ?? fail('no baseUrl in prompt');
const home = await fetch(`${baseUrl}/`);
if (!(await home.text()).includes('tiny')) fail('static server does not serve the workspace');
mkdirSync('pages', { recursive: true });
writeFileSync('pages/tiny.html', `<a href="${baseUrl}/">home</a>`);
const lines = [
  { type: 'system', subtype: 'init', model: 'fake-model' },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__figma__get_design_context', input: { nodeId: '1:2' } }] } },
  { type: 'result', subtype: 'success', is_error: false, result: 'Done. VEREDITO: PASS', total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 } }
];
for (const line of lines) process.stdout.write(`${JSON.stringify(line)}\n`);
