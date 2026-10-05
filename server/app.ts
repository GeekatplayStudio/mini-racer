import { createReadStream, existsSync, statSync } from 'node:fs';
import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { WS_PATH } from '../src/net/protocol';
import { Accounts, ApiError, PROFILE_LIMIT, RateLimit, cleanProfile } from './accounts';
import { Lobby, LobbyOptions } from './lobby';

export interface ServerOptions extends LobbyOptions {
  /** Port to listen on; 0 picks a free one. */
  port: number;
  /** Address to bind; all interfaces when absent. */
  host?: string;
  /** Where accounts and saved teams are kept. */
  dataDir: string;
  /** The built game (the `dist` folder). Nothing is served when absent. */
  staticDir?: string;
  /** Development only: let pages from other origins call the API. */
  devCors?: boolean;
  /** Take the caller's address from X-Forwarded-For; only behind your own reverse proxy. */
  trustProxy?: boolean;
  /** Sign-in and registration attempts allowed per address in each window. */
  authAttempts?: number;
  authWindowMs?: number;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Sent with every page and API reply: no framing by other sites, no sniffing, no referrer leaks. */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
} as const;

const SMALL_BODY = 4 * 1024;
/** Uploads may still carry photos, which are dropped before the team is stored. */
const PROFILE_BODY = PROFILE_LIMIT * 4;

function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // Too much: keep reading so the caller gets a proper answer, but store nothing.
      // A sender that goes on and on is cut off.
      if (size > limit * 8) req.destroy();
      else if (size <= limit) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > limit) {
        fail(new ApiError(413, 'Too much data'));
        return;
      }
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        fail(new ApiError(400, 'The request is not valid JSON'));
      }
    });
    req.on('error', () => fail(new ApiError(400, 'The request was cut short')));
  });
}

/** Starts the game server: the built client, the account API and the WebSocket lobby on one port. */
export function startServer(options: ServerOptions): Promise<RunningServer> {
  const accounts = new Accounts(options.dataDir);
  const lobby = new Lobby(accounts, options);
  const authLimit = new RateLimit(options.authAttempts ?? 10, options.authWindowMs ?? 60000);
  const staticRoot = options.staticDir ? resolve(options.staticDir) : null;

  const addressOf = (req: IncomingMessage): string => {
    if (options.trustProxy) {
      // The proxy appends the address it saw; anything before that came from the caller and can be made up.
      const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').pop()?.trim();
      if (forwarded) return forwarded;
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const bearer = (req: IncomingMessage): { key: string; name: string; token: string } => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const who = accounts.whoIs(token);
    if (!who) throw new ApiError(401, 'Sign in again');
    return { ...who, token };
  };

  async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const route = `${req.method} ${path}`;
    switch (route) {
      case 'GET /api/health':
        return json(res, 200, { ok: true, game: 'miniracer' });
      case 'POST /api/register':
      case 'POST /api/login': {
        if (!authLimit.allow(addressOf(req))) throw new ApiError(429, 'Too many attempts; wait a minute and try again');
        const body = (await readBody(req, SMALL_BODY)) as { name?: unknown; password?: unknown } | null;
        const session = path === '/api/register'
          ? await accounts.register(body?.name, body?.password)
          : await accounts.login(body?.name, body?.password);
        return json(res, 200, session);
      }
      case 'POST /api/logout': {
        accounts.logout(bearer(req).token);
        return json(res, 200, { ok: true });
      }
      case 'GET /api/me':
        return json(res, 200, { name: bearer(req).name });
      case 'GET /api/profile': {
        const stored = accounts.loadProfile(bearer(req).key);
        return json(res, 200, { profile: stored?.profile ?? null, rev: stored?.rev ?? 0 });
      }
      case 'PUT /api/profile': {
        const who = bearer(req);
        const body = (await readBody(req, PROFILE_BODY)) as { profile?: unknown; base?: unknown } | null;
        const base = typeof body?.base === 'number' && Number.isInteger(body.base) ? body.base : undefined;
        const rev = accounts.saveProfile(who.key, cleanProfile(body?.profile), base);
        return json(res, 200, { ok: true, rev });
      }
      default:
        throw new ApiError(404, 'No such API call');
    }
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): void {
    if (!staticRoot || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    let rel: string;
    try {
      rel = normalize(decodeURIComponent(path));
    } catch {
      rel = '';
    }
    let file = join(staticRoot, rel);
    // Nothing outside the built game is ever served.
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) file = staticRoot;
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // Files with an extension that are missing are missing; any other address is the game page.
      if (extname(rel) && rel !== sep) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      file = join(staticRoot, 'index.html');
      if (!existsSync(file)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('The game has not been built: run "npm run build"');
        return;
      }
    }
    const hashed = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': statSync(file).size,
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  }

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (!path.startsWith('/api/')) {
      serveStatic(req, res, path);
      return;
    }
    if (options.devCors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
    }
    api(req, res, path).catch((err: unknown) => {
      if (res.headersSent) return;
      if (err instanceof ApiError) json(res, err.status, { error: err.message });
      else {
        console.error('API call failed:', err);
        json(res, 500, { error: 'The server had a problem' });
      }
    });
  });
  // Slow or stalled requests do not hold connections open for ever.
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if ((req.url ?? '').split('?')[0] !== WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => lobby.attach(ws));
  });

  return new Promise((ready, fail) => {
    server.once('error', fail);
    server.listen(options.port, options.host, () => {
      ready({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise<void>((closed) => {
            lobby.close();
            wss.close();
            server.close(() => closed());
            server.closeAllConnections();
          }),
      });
    });
  });
}
