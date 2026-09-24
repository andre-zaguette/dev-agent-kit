import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FixtureServerOptions {
  /** When set, GET /redir responds with a 302 to this location. */
  redirectTo?: string;
}

export function startFixtureServer(
  html: string,
  options: FixtureServerOptions = {}
): Promise<{ url: string; redirectUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      if (options.redirectTo && req.url === '/redir') {
        res.writeHead(302, { Location: options.redirectTo });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${address.port}/`;
      resolve({
        url,
        redirectUrl: `http://127.0.0.1:${address.port}/redir`,
        close: () => new Promise((res) => server.close(() => res()))
      });
    });
  });
}

export const FIXTURE_HTML = `<!doctype html>
<html>
  <body>
    <h1 data-testid="hero-title" style="font-size: 32px; color: rgb(17, 24, 39);">Hello Fixture</h1>
  </body>
</html>`;
