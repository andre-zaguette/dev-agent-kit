import { copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { FigmaFixture } from '../schema.js';

/** Figma URLs use "1-2", the API uses "1:2". */
export function normalizeNodeId(id: string): string {
  return id.trim().replace(/-/g, ':');
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function createFigmaMock(fixture: FigmaFixture, fixtureDir: string, outputRoot: string): McpServer {
  const server = new McpServer({ name: 'figma', version: '0.5.0' });
  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
  const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });
  const node = (id: string) => fixture.nodes[normalizeNodeId(id)];
  const unknown = (id: string) => fail(`Node ${id} not found in file ${fixture.fileKey}. Use get_metadata to list the nodes.`);
  const common = {
    fileKey: z.string().optional(),
    clientLanguages: z.string().optional(),
    clientFrameworks: z.string().optional()
  };

  server.registerTool(
    'get_metadata',
    {
      description: 'XML outline of a Figma node (or of the current page when nodeId is omitted): ids, names, types, positions and sizes. Use it first on large files.',
      inputSchema: { ...common, nodeId: z.string().optional() }
    },
    async ({ nodeId }) => {
      if (!nodeId) return text(fixture.metadata);
      const n = node(nodeId);
      if (!n) return unknown(nodeId);
      return text(n.metadata ?? `<frame id="${normalizeNodeId(nodeId)}" name="${n.name}" />`);
    }
  );

  server.registerTool(
    'get_design_context',
    { description: 'Design context (reference UI code, layout, styles, tokens) for a Figma node.', inputSchema: { ...common, nodeId: z.string() } },
    async ({ nodeId }) => {
      const n = node(nodeId);
      if (!n) return unknown(nodeId);
      if (n.tooLarge || !n.designContext) {
        return fail(`The design context for node ${nodeId} ("${n.name}") is too large. Call get_metadata first and request design context for specific child nodes.`);
      }
      return text(n.designContext);
    }
  );

  server.registerTool(
    'get_variable_defs',
    { description: 'Variables (design tokens) used by a Figma node.', inputSchema: { ...common, nodeId: z.string().optional() } },
    async () => text(JSON.stringify(fixture.variables, null, 2))
  );

  server.registerTool(
    'get_screenshot',
    { description: 'PNG screenshot of a Figma node.', inputSchema: { ...common, nodeId: z.string() } },
    async ({ nodeId }) => {
      const n = node(nodeId);
      if (!n) return unknown(nodeId);
      if (!n.screenshot) return fail(`No screenshot available for node ${nodeId}.`);
      const data = readFileSync(path.join(fixtureDir, n.screenshot)).toString('base64');
      return { content: [{ type: 'image' as const, data, mimeType: 'image/png' }] };
    }
  );

  server.registerTool(
    'download_assets',
    {
      description: 'Download the image assets of a Figma node into a directory of the project (path relative to the project root).',
      inputSchema: { ...common, nodeId: z.string(), outputDir: z.string().min(1) }
    },
    async ({ nodeId, outputDir }) => {
      const n = node(nodeId);
      if (!n) return unknown(nodeId);
      const assets = Object.entries(n.assets ?? {});
      if (assets.length === 0) return fail(`Node ${nodeId} has no image assets.`);
      if (path.isAbsolute(outputDir)) return fail('outputDir must be a path relative to the project root.');
      const dest = path.resolve(outputRoot, outputDir);
      if (!isInside(outputRoot, dest)) return fail('outputDir must stay inside the project root.');
      mkdirSync(dest, { recursive: true });
      const realDest = realpathSync(dest);
      if (!isInside(outputRoot, realDest)) return fail('outputDir resolves outside the project root.');
      const written: string[] = [];
      for (const [fileName, src] of assets) {
        const target = path.join(realDest, fileName);
        try {
          if (lstatSync(target).isSymbolicLink()) return fail(`${path.relative(outputRoot, target)} is a symbolic link; refusing to write through it.`);
        } catch {
          // does not exist yet
        }
        copyFileSync(path.join(fixtureDir, src), target);
        written.push(path.relative(outputRoot, target));
      }
      return text(`Downloaded ${written.length} asset(s):\n${written.join('\n')}`);
    }
  );

  return server;
}
