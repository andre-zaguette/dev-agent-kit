import { createServer } from 'node:http';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

export async function startStaticServer(rootDir: string): Promise<{ origin: string; close(): Promise<void> }> {
  const root = realpathSync(rootDir);
  const server = createServer((req, res) => {
    const send = (status: number, body: string) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed');
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    } catch {
      return send(400, 'bad request');
    }
    let file = path.resolve(root, `.${pathname}`);
    let real: string;
    try {
      real = realpathSync(file);
      if (statSync(real).isDirectory()) {
        file = path.join(real, 'index.html');
        real = realpathSync(file);
      }
    } catch {
      const rel = path.relative(root, file);
      return rel.startsWith('..') || path.isAbsolute(rel) ? send(403, 'forbidden') : send(404, 'not found');
    }
    const rel = path.relative(root, real);
    if (rel.startsWith('..') || path.isAbsolute(rel) || real !== file) return send(403, 'forbidden');
    res.writeHead(200, { 'content-type': TYPES[path.extname(real).toLowerCase()] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(real));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
