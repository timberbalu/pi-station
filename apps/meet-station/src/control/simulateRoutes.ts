import type { FastifyInstance } from 'fastify';

import type { ControlContext } from './types.js';

export async function registerSimulateRoutes(server: FastifyInstance, context: ControlContext): Promise<void> {
  server.post('/simulate/network/down', async (_request, reply) => {
    await context.app.simulateNetworkDown();
    return reply.send({ ok: true });
  });

  server.post('/simulate/network/up', async (_request, reply) => {
    await context.app.simulateNetworkUp();
    return reply.send({ ok: true });
  });

  server.post('/simulate/stt/drop', async (_request, reply) => {
    await context.app.simulateSttDrop();
    return reply.send({ ok: true });
  });

  server.post('/simulate/stt/reconnect', async (_request, reply) => {
    await context.app.simulateSttReconnect();
    return reply.send({ ok: true });
  });
}
