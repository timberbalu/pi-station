import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

import { renderReportHtml } from '../report/reportHtml.js';
import type { ControlContext } from './types.js';

const pairBodySchema = z.object({
  session_code: z.string().min(1),
  title: z.string().optional(),
});

const markBodySchema = z.object({
  note: z.string().optional(),
});

const limitQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export async function registerRoutes(server: FastifyInstance, context: ControlContext): Promise<void> {
  server.get('/health', async (_request, reply) => {
    return reply.send({
      ok: true,
      version: context.app.getStatus().version,
    });
  });

  server.get('/status', async (_request, reply) => {
    return reply.send(context.app.getStatus());
  });

  server.get('/events', async (request, reply) => {
    const { limit } = limitQuerySchema.parse(request.query);
    return reply.send({ events: context.app.getEvents(limit) });
  });

  server.get('/transcript', async (_request, reply) => {
    return reply.send({ segments: context.app.getTranscript() });
  });

  server.get('/report/:sessionId', async (request, reply) => {
    const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
    const report = context.app.getReport(params.sessionId);
    if (!report) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    const accept = request.headers.accept ?? '';
    if (accept.includes('application/json')) {
      return reply.send(report);
    }

    return reply.type('text/html').send(renderReportHtml(report));
  });

  server.post('/pair', async (request, reply) => {
    const body = pairBodySchema.parse(request.body);
    return reply.send(await context.app.pair(body.session_code, body.title));
  });

  server.post('/start', async (_request, reply) => {
    await context.app.start();
    return reply.send({ ok: true, state: context.app.getStatus().state });
  });

  server.post('/pause', async (_request, reply) => {
    await context.app.pause();
    return reply.send({ ok: true, state: context.app.getStatus().state });
  });

  server.post('/resume', async (_request, reply) => {
    await context.app.resume();
    return reply.send({ ok: true, state: context.app.getStatus().state });
  });

  server.post('/stop', async (_request, reply) => {
    const report = await context.app.stop();
    return reply.send({ ok: true, state: context.app.getStatus().state, report });
  });

  server.post('/mark', async (request, reply) => {
    const body = markBodySchema.parse(request.body ?? {});
    context.app.markInsight(body.note);
    return reply.send({ ok: true });
  });
}
