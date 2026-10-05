// Bundles the game server and the simulation it shares with the client into
// one plain JavaScript file: server-dist/server.js. Run with "npm run build:server".
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

await build({
  entryPoints: ['server/server.ts'],
  outfile: 'server-dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // The WebSocket library is CommonJS and asks for Node's own modules with require().
  banner: { js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" },
  // Optional native speed-ups of the WebSocket library; it works without them.
  external: ['bufferutil', 'utf-8-validate'],
  legalComments: 'none',
  logLevel: 'info',
});

// Lets the folder run on its own: "node server-dist/server.js" needs nothing from node_modules.
mkdirSync('server-dist', { recursive: true });
writeFileSync('server-dist/package.json', `${JSON.stringify({ name: 'miniracer-server', private: true, type: 'module', scripts: { start: 'node server.js' } }, null, 2)}\n`);
