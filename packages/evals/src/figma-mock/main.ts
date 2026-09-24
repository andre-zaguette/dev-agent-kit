import { realpathSync } from 'node:fs';
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadFigmaFixture } from '../load.js';
import { createFigmaMock } from './server.js';

const fixturePath = process.env.FIGMA_MOCK_FIXTURE;
const outputRoot = process.env.FIGMA_MOCK_OUTPUT_ROOT;
if (!fixturePath || !outputRoot) {
  process.stderr.write('figma-mock: FIGMA_MOCK_FIXTURE and FIGMA_MOCK_OUTPUT_ROOT are required\n');
  process.exit(1);
}
let server;
try {
  server = createFigmaMock(loadFigmaFixture(fixturePath), path.dirname(fixturePath), realpathSync(outputRoot));
} catch (error) {
  process.stderr.write(`figma-mock: ${(error as Error).message}\n`);
  process.exit(1);
}
await server.connect(new StdioServerTransport());
