import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { captureScreenshot } from './screenshot.js';
import { inspectDom } from './dom.js';
import { compareScreenshots } from './compare.js';
import { runAccessibilityAudit } from './a11y.js';
import { runResponsiveSuite } from './responsive.js';
import { BREAKPOINT_NAME_PATTERN } from './config.js';
import { MEASURABLE_PROPERTIES } from './geometry.js';

const viewportSchema = z.object({
  width: z.number().int().positive().max(7680),
  height: z.number().int().positive().max(7680)
});

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'frontend-agent', version: '0.3.0' });

  server.registerTool(
    'capture_screenshot',
    {
      title: 'Capture Screenshot',
      description:
        'Capture a screenshot of a local or explicitly allowed web page at a given viewport size.',
      inputSchema: {
        url: z.string().url(),
        width: z.number().int().positive().max(7680),
        height: z.number().int().positive().max(7680),
        outputPath: z.string(),
        fullPage: z.boolean().optional()
      }
    },
    async ({ url, width, height, outputPath, fullPage }) => {
      const result = await captureScreenshot({ url, width, height, outputPath, fullPage });
      return jsonResult(result);
    }
  );

  server.registerTool(
    'inspect_dom',
    {
      title: 'Inspect DOM',
      description:
        'Return the bounding box and key computed styles for the first element matching a CSS selector, on a local or explicitly allowed page.',
      inputSchema: {
        url: z.string().url(),
        selector: z.string()
      }
    },
    async ({ url, selector }) => {
      const result = await inspectDom({ url, selector });
      return jsonResult(result);
    }
  );

  server.registerTool(
    'compare_screenshots',
    {
      title: 'Compare Screenshots',
      description:
        'Pixel-diff a baseline PNG (e.g. the Figma frame exported at 1x) against an actual PNG, and optionally measure elements on a local or allowed page against expected Figma values. Returns a verdict (pass | fail | incomplete) under the project validationProfile; pixel similarity alone never yields pass.',
      inputSchema: {
        baselinePath: z.string(),
        actualPath: z.string(),
        diffOutputPath: z.string().optional(),
        url: z.string().url().optional(),
        viewport: viewportSchema.optional(),
        elements: z
          .array(
            z
              .object({
                selector: z.string().min(1),
                x: z.number().optional(),
                y: z.number().optional(),
                width: z.number().optional(),
                height: z.number().optional(),
                paddingTop: z.number().optional(),
                paddingRight: z.number().optional(),
                paddingBottom: z.number().optional(),
                paddingLeft: z.number().optional(),
                gap: z.number().optional(),
                rowGap: z.number().optional(),
                columnGap: z.number().optional(),
                fontSize: z.number().optional(),
                color: z.string().optional()
              })
              .strict()
              // R1: a selector with no expected property is invalid input.
              .refine(
                (element) => MEASURABLE_PROPERTIES.some((property) => element[property] !== undefined),
                (element) => ({ message: `element "${element.selector}" has no expected properties` })
              )
          )
          .max(200)
          .optional()
      }
    },
    async (args) => jsonResult(await compareScreenshots(args))
  );

  server.registerTool(
    'run_responsive_suite',
    {
      title: 'Run Responsive Suite',
      description:
        'Load a local or allowed page at each breakpoint (project config, or the spec defaults 1440x900, 1280x800, 768x1024, 390x844), report horizontal overflow and the offending elements, and optionally save one screenshot per breakpoint under outputDir.',
      inputSchema: {
        url: z.string().url(),
        outputDir: z.string().optional(),
        breakpoints: z
          .array(
            z.object({
              name: z.string().regex(BREAKPOINT_NAME_PATTERN),
              width: z.number().int().positive().max(7680),
              height: z.number().int().positive().max(7680)
            })
          )
          .min(1)
          .max(20)
          .optional()
      }
    },
    async (args) => jsonResult(await runResponsiveSuite(args))
  );

  server.registerTool(
    'run_accessibility_audit',
    {
      title: 'Run Accessibility Audit',
      description:
        'Run axe-core on a local or allowed page and report violations by impact. Passes when critical-impact issues do not exceed the profile maxCriticalA11yIssues (0 in every default profile).',
      inputSchema: {
        url: z.string().url(),
        viewport: viewportSchema.optional()
      }
    },
    async (args) => jsonResult(await runAccessibilityAudit(args))
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('frontend-agent MCP server running on stdio');
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    console.error('frontend-agent MCP server failed to start:', error);
    process.exit(1);
  });
}
