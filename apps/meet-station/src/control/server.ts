import Fastify, { type FastifyInstance } from 'fastify';

import type { ControlContext } from './types.js';
import { registerDashboardRoutes } from './dashboardRoutes.js';
import { registerMockIngestRoutes } from './mockIngestRoutes.js';
import { registerMockStationRoutes } from './mockStationRoutes.js';
import { registerRoutes } from './routes.js';
import { registerSimulateRoutes } from './simulateRoutes.js';

export async function buildServer(context: ControlContext): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });

  // Accept binary bodies for the mock S3 multipart PUT target.
  server.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  server.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (request.method === 'OPTIONS') {
      await reply.code(204).send();
    }
  });

  server.setErrorHandler((error, _request, reply) => {
    reply.status(400).send({
      error: error.message,
    });
  });

  await registerDashboardRoutes(server);
  await registerRoutes(server, context);
  await registerMockIngestRoutes(server, context);
  await registerMockStationRoutes(server, context);
  await registerSimulateRoutes(server, context);

  return server;
}
