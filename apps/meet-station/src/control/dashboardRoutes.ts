import { readFile } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';

const htmlUrl = new URL('../public/index.html', import.meta.url);
const cssUrl = new URL('../public/styles.css', import.meta.url);
const jsUrl = new URL('../public/app.js', import.meta.url);

export async function registerDashboardRoutes(server: FastifyInstance): Promise<void> {
  server.get('/', async (_request, reply) => {
    const html = await readFile(htmlUrl, 'utf8');
    reply.type('text/html').send(html);
  });

  server.get('/styles.css', async (_request, reply) => {
    const css = await readFile(cssUrl, 'utf8');
    reply.type('text/css').send(css);
  });

  server.get('/app.js', async (_request, reply) => {
    const js = await readFile(jsUrl, 'utf8');
    reply.type('application/javascript').send(js);
  });
}
