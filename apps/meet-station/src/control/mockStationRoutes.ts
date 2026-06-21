import { randomUUID } from 'node:crypto';

import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ControlContext } from './types.js';

/**
 * Mock implementations of the apm/PHP station endpoints (§8 of J3b) plus a mock S3
 * target. Lets the full four-phase sync story run with zero real AWS infrastructure.
 * Production points STATION_SYNC_URL at voice.apresmeet.com/ws/station instead.
 *
 * All endpoints honour the simulated-network flag so /simulate/network/down breaks
 * sync exactly as a real outage would.
 */

const presignQuerySchema = z.object({
  key: z.string().min(1),
  file_size: z.coerce.number().int().nonnegative(),
  part_size: z.coerce.number().int().positive(),
  upload_id: z.string().optional(),
  from_part: z.coerce.number().int().positive().optional(),
});

const confirmSchema = z.object({
  key: z.string().min(1),
  upload_id: z.string().min(1),
  parts: z.array(z.object({ part_number: z.number(), etag: z.string() })),
});

function baseUrl(request: FastifyRequest): string {
  const host = request.headers.host ?? 'localhost:3456';
  return `${request.protocol}://${host}`;
}

export async function registerMockStationRoutes(server: FastifyInstance, context: ControlContext): Promise<void> {
  const manifests = new Map<string, unknown>();
  const completedUploads = new Set<string>();

  const offline = (): boolean => !context.app.isMockIngestAvailable();

  server.post('/mock/station/sessions', async (request, reply) => {
    if (offline()) {
      return reply.status(503).send({ accepted: false, error: 'network down (simulated)' });
    }
    const body = request.body as { session_id?: string };
    const sessionId = body?.session_id;
    if (!sessionId) {
      return reply.status(400).send({ accepted: false, error: 'session_id required' });
    }
    if (manifests.has(sessionId)) {
      return reply.status(409).send({ accepted: true, existing: true, session_id: sessionId });
    }
    manifests.set(sessionId, body);
    return reply.send({ accepted: true, existing: false, session_id: sessionId });
  });

  server.get('/mock/station/sessions/:sessionId/media/presign', async (request, reply) => {
    if (offline()) {
      return reply.status(503).send({ error: 'network down (simulated)' });
    }
    const query = presignQuerySchema.parse(request.query);
    const uploadId = query.upload_id ?? `mock-upload-${randomUUID().slice(0, 8)}`;
    const totalParts = Math.max(1, Math.ceil(query.file_size / query.part_size));
    const fromPart = query.from_part ?? 1;

    const parts = [];
    for (let partNumber = fromPart; partNumber <= totalParts; partNumber += 1) {
      const url = `${baseUrl(request)}/mock/s3/upload`
        + `?key=${encodeURIComponent(query.key)}&part=${partNumber}&upload=${uploadId}`;
      parts.push({ part_number: partNumber, presigned_url: url });
    }

    return reply.send({ upload_id: uploadId, parts });
  });

  server.post('/mock/station/sessions/:sessionId/media/confirm', async (request, reply) => {
    if (offline()) {
      return reply.status(503).send({ confirmed: false, error: 'network down (simulated)' });
    }
    const body = confirmSchema.parse(request.body);
    completedUploads.add(body.key);
    return reply.send({ confirmed: true, s3_key: body.key });
  });

  server.post('/mock/station/sessions/:sessionId/sync-complete', async (_request, reply) => {
    if (offline()) {
      return reply.status(503).send({ ok: false, error: 'network down (simulated)' });
    }
    return reply.send({ ok: true });
  });

  // Mock S3 multipart target — stores nothing, returns an ETag like real S3.
  server.put('/mock/s3/upload', async (request, reply) => {
    if (offline()) {
      return reply.status(503).send({ error: 'network down (simulated)' });
    }
    const { part, upload } = request.query as { part?: string; upload?: string };
    const etag = `"mock-etag-${upload ?? 'x'}-${part ?? '1'}"`;
    return reply.header('ETag', etag).send({ ok: true });
  });
}
