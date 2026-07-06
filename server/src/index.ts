import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { Poller } from './core/poller.js';
import { registerApi } from './routes/api.js';

const app = Fastify({ logger: false });
const poller = new Poller();

registerApi(app, poller);

// Serve the built terminal UI when present (vite build web).
const webDist = resolve(import.meta.dirname, '../../web/dist');
if (existsSync(webDist)) {
  app.register(fastifyStatic, { root: webDist });
}

const start = async () => {
  await poller.start();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[rbt] Riftbound Terminal on http://localhost:${config.port} (mode=${poller.mode})`);
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
