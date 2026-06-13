/**
 * pi-control — local HTTP API
 *
 * Fastify server on the Pi's LAN IP (default :3456).
 * The MeetPaper Live Desk calls this instead of the browser mic API.
 *
 * Routes:
 *   POST /start          — begin recording
 *   POST /stop           — end recording
 *   POST /pause          — suspend without ending
 *   POST /resume         — resume after pause
 *   POST /pair           — bind to a VI session { session_code: string }
 *   GET  /status         — current state (used by Live Desk status widget)
 */

import Fastify from 'fastify';
import { captureService } from './capture.js';
import { relayService }   from './relay.js';
import { config }         from './config.js';

const fastify = Fastify({ logger: { level: config.control.port ? 'info' : 'silent' } });

// CORS — allow MeetPaper Live Desk from any local origin
fastify.addHook('onRequest', async (req, reply) => {
  void reply.header('Access-Control-Allow-Origin', '*');
  void reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  void reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    await reply.status(204).send();
  }
});

// ── State ─────────────────────────────────────────────────────────────────

type StationState = 'idle' | 'recording' | 'paused' | 'stopped';
let state: StationState = 'idle';
let sessionCode: string | null = null;
let startedAt: string | null = null;

// ── Routes ────────────────────────────────────────────────────────────────

fastify.post('/start', async (_req, reply) => {
  if (state === 'recording') {
    return reply.status(409).send({ error: 'Already recording' });
  }
  captureService.start();
  state     = 'recording';
  startedAt = new Date().toISOString();
  return reply.send({ ok: true, state });
});

fastify.post('/stop', async (_req, reply) => {
  captureService.stop();
  state     = 'stopped';
  startedAt = null;
  return reply.send({ ok: true, state });
});

fastify.post('/pause', async (_req, reply) => {
  if (state !== 'recording') {
    return reply.status(409).send({ error: 'Not recording' });
  }
  captureService.pause();
  state = 'paused';
  return reply.send({ ok: true, state });
});

fastify.post('/resume', async (_req, reply) => {
  if (state !== 'paused') {
    return reply.status(409).send({ error: 'Not paused' });
  }
  captureService.resume();
  state = 'recording';
  return reply.send({ ok: true, state });
});

fastify.post('/pair', async (req, reply) => {
  const body = req.body as { session_code?: string };
  if (!body.session_code) {
    return reply.status(400).send({ error: 'session_code required' });
  }
  sessionCode = body.session_code;
  // TODO: validate against voice.apresmeet.com/ws/station/pair
  console.log('[control] Paired to session:', sessionCode);
  return reply.send({ ok: true, session_code: sessionCode });
});

fastify.get('/status', async (_req, reply) => {
  return reply.send({
    state,
    session_code:    sessionCode,
    started_at:      startedAt,
    queue_depth:     relayService.queueDepth,
    recording:       captureService.isRecording,
    ws_connected:    captureService.isRecording, // proxy for now
    buffer_dir:      config.buffer.dir,
    timestamp:       new Date().toISOString(),
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────

export async function startControlServer(): Promise<void> {
  relayService.start();
  await fastify.listen({ port: config.control.port, host: config.control.host });
  console.log(`[control] Listening on ${config.control.host}:${config.control.port}`);
}
