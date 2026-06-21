import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

import type { ControlContext } from './types.js';

const ingestSchema = z.object({
  station_id: z.string(),
  session_id: z.string(),
  segment_id: z.string(),
  sequence: z.number(),
  start_ms: z.number(),
  end_ms: z.number(),
  text: z.string(),
  speaker_label: z.string().nullable(),
  language_code: z.string(),
  committed_at: z.string(),
  source: z.literal('meetpaper_station'),
  provider: z.string(),
  raw: z.record(z.unknown()),
});

export async function registerMockIngestRoutes(server: FastifyInstance, context: ControlContext): Promise<void> {
  server.post('/mock/ingest', async (request, reply) => {
    if (!context.app.isMockIngestAvailable()) {
      return reply.status(503).send({ ok: false, error: 'Mock ingest unavailable' });
    }

    const payload = ingestSchema.parse(request.body);
    context.app.recordMockIngest(payload);
    return reply.send({ ok: true });
  });

  server.get('/mock/ingest/segments', async (_request, reply) => {
    return reply.send({ segments: context.app.getMockIngestSegments() });
  });
}
