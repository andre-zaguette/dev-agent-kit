import type { ToolCall } from '../types.js';

// A kit skill file read through a host's file tool or a shell command, e.g.
// "/tmp/ws/.claude/skills/figma-to-code/SKILL.md" or "sed -n '1,200p' .agents/skills/x/references/react.md".
const SKILL_FILE = /(?:^|[\/\s'"=])\.(?:claude|agents)\/skills\/([A-Za-z0-9._-]+)\/(?:SKILL\.md|references\/([A-Za-z0-9._-]+)\.md)/g;

// A single-level bash brace-expansion token, e.g. "{figma-to-code,component-selection}" or
// "{react,vuejs}.md" — shells expand these before the command runs, but the transcript records
// the literal, unexpanded command line. One level, no nesting, is all a skill/reference path needs.
const BRACE_TOKEN = /^([^{}\s]*)\{([A-Za-z0-9._-]+(?:,[A-Za-z0-9._-]+)+)\}([^{}\s]*)$/;

/** Expand bash brace-expansion tokens so the SKILL_FILE regex can match each option. */
function expandBraces(text: string): string {
  return text
    .split(/(\s+)/)
    .map((token) => {
      const match = BRACE_TOKEN.exec(token);
      if (!match) return token;
      const [, prefix, options, suffix] = match;
      return options
        .split(',')
        .map((option) => `${prefix}${option}${suffix}`)
        .join(' ');
    })
    .join('');
}

export function skillReadsIn(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const match of expandBraces(text).matchAll(SKILL_FILE)) {
    const tool = match[2] ? `reference/${match[2]}` : `skill/${match[1]}`;
    calls.push({ tool, args: {}, ok: true });
  }
  return calls;
}
