/**
 * pi-station — entry point
 *
 * Boots all three services:
 *   1. CaptureService  (pi-capture) — audio daemon, ElevenLabs WS
 *   2. RelayService    (pi-relay)   — segment queue, outbound POST
 *   3. Control server  (pi-control) — Fastify HTTP API on LAN
 *
 * Run in dev:  npm run dev
 * Run on Pi:   npm run build && npm start
 */

import 'dotenv/config'; // load .env
import { startControlServer } from './control.js';

console.log('╔══════════════════════════════════════════╗');
console.log('║  MeetPaper Station  —  pi-station v0.1   ║');
console.log('╚══════════════════════════════════════════╝');

await startControlServer();

// Graceful shutdown
const shutdown = (): void => {
  console.log('\n[station] Shutting down…');
  process.exit(0);
};

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
