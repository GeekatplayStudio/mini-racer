/**
 * MiniRacer game server
 * Copyright (c) 2026 Geekatplay Studio, Vladimir Chopine. All rights reserved.
 *
 * One process: serves the built game, keeps the accounts and runs the online races.
 * Settings come from the environment; see DEPLOY.md.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from './app';

const env = process.env;
const port = Number(env.PORT) || 8787;
const dataDir = resolve(env.DATA_DIR || './server-data');
const staticDir = resolve(env.STATIC_DIR || './dist');
const on = (value: string | undefined): boolean => value === '1' || value === 'true';

startServer({
  port,
  host: env.HOST || undefined,
  dataDir,
  staticDir: existsSync(staticDir) ? staticDir : undefined,
  devCors: on(env.CORS_DEV),
  trustProxy: on(env.TRUST_PROXY),
  maxGames: Number(env.MAX_GAMES) || undefined,
  maxPerAddress: Number(env.MAX_PER_ADDRESS) || undefined,
}).then(
  (running) => {
    console.log(`MiniRacer server listening on port ${running.port}`);
    console.log(`  game files: ${existsSync(staticDir) ? staticDir : 'none (run "npm run build")'}`);
    console.log(`  data:       ${dataDir}`);
    if (on(env.CORS_DEV)) console.log('  CORS_DEV is on: any web page may call the API. Do not use this in production.');
    const stop = (): void => {
      running.close().then(() => process.exit(0), () => process.exit(1));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  },
  (err: unknown) => {
    console.error('The server could not start:', err);
    process.exit(1);
  },
);
