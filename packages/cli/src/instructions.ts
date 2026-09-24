import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { AdapterContext, HostName } from './types.js';

/**
 * The instructions text a host should get for CLAUDE.md/AGENTS.md.
 *
 * If <project>/CLAUDE.md and <project>/AGENTS.md both exist and resolve (realpathSync) to the
 * same file — e.g. one is symlinked to the other — both hosts share that single file, so writing
 * only the requesting host's own text would have each `install` overwrite the other host's block
 * on every run. In that case both hosts get the combined content (Claude text, a blank line, then
 * Codex text), which is idempotent regardless of install order or which host(s) are installed.
 */
export function instructionsContent(ctx: AdapterContext, host: HostName & ('claude' | 'codex')): string {
  const claudeContent = readFileSync(path.join(ctx.kitRoot, 'integrations', 'claude', 'CLAUDE.md'), 'utf8');
  const codexContent = readFileSync(path.join(ctx.kitRoot, 'integrations', 'codex', 'AGENTS.md'), 'utf8');

  const claudeFile = path.join(ctx.projectRoot, 'CLAUDE.md');
  const agentsFile = path.join(ctx.projectRoot, 'AGENTS.md');

  if (existsSync(claudeFile) && existsSync(agentsFile)) {
    try {
      if (realpathSync(claudeFile) === realpathSync(agentsFile)) {
        return `${claudeContent.trim()}\n\n${codexContent.trim()}\n`;
      }
    } catch {
      // fall through to the host's own content if realpath fails for either file
    }
  }

  return host === 'claude' ? claudeContent : codexContent;
}
