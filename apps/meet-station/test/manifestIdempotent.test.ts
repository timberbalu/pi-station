import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerMockStationRoutes } from '../src/control/mockStationRoutes.js';
import type { ControlContext } from '../src/control/types.js';

function buildMockServer(available = true) {
  const server = Fastify({ logger: false });
  const context = {
    app: { isMockIngestAvailable: () => available },
  } as unknown as ControlContext;
  return { server, context };
}

const manifestBody = {
  session_id: 'VI-test-1',
  session_code: '482913',
  title: 'Idempotency Test',
  station_id: 'MPS-001',
  started_at: '2026-06-21T10:00:00.000Z',
  stopped_at: '2026-06-21T11:00:00.000Z',
  components: ['voice'],
};

describe('mock station manifest idempotency', () => {
  it('accepts first manifest and reports existing on the second', async () => {
    const { server, context } = buildMockServer();
    await registerMockStationRoutes(server, context);

    const first = await server.inject({ method: 'POST', url: '/mock/station/sessions', payload: manifestBody });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ accepted: true, existing: false });

    const second = await server.inject({ method: 'POST', url: '/mock/station/sessions', payload: manifestBody });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ accepted: true, existing: true });

    await server.close();
  });

  it('rejects manifest when network is simulated down', async () => {
    const { server, context } = buildMockServer(false);
    await registerMockStationRoutes(server, context);

    const res = await server.inject({ method: 'POST', url: '/mock/station/sessions', payload: manifestBody });
    expect(res.statusCode).toBe(503);

    await server.close();
  });
});
