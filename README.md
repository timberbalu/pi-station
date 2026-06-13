# MeetPaper Station

> Local audio ingestion server for MeetPaper Voice Intelligence.

The room keeps recording. Even when the internet doesn't.

## What it does

Three Node.js/TypeScript services running on a Raspberry Pi 5:

| Service | File | Job |
|---|---|---|
| `pi-capture` | `src/capture.ts` | Opens USB mic, streams PCM to ElevenLabs Scribe v2 WS, writes rolling WAV buffer to disk |
| `pi-relay` | `src/relay.ts` | POSTs committed transcript segments to `voice.apresmeet.com`; queues locally in SQLite when offline, flushes on reconnect |
| `pi-control` | `src/control.ts` | Fastify HTTP API on LAN — `POST /start /stop /pause /resume`, `GET /status` |

## Quick start (dev)

```bash
cp .env.example .env
# fill in ELEVENLABS_API_KEY and VI_SESSION_TOKEN
npm install
npm run dev
```

The control API starts on `http://localhost:3456`. With no `VI_INGEST_URL` set, segments are logged to console rather than sent — safe for local testing.

## Deploy to Pi

```bash
# First time — set up the Pi hostname
ssh pi@raspberrypi.local
sudo apt install -y nodejs npm alsa-utils
npm install -g tsx pm2
sudo hostname pi-station   # optional: set mDNS name

# Every deploy from your Mac
./scripts/deploy-pi.sh pi-station.local
```

Check status: `http://pi-station.local:3456/status`

## API

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/start` | — | `{ ok, state }` |
| `POST` | `/stop` | — | `{ ok, state }` |
| `POST` | `/pause` | — | `{ ok, state }` |
| `POST` | `/resume` | — | `{ ok, state }` |
| `POST` | `/pair` | `{ session_code }` | `{ ok, session_code }` |
| `GET` | `/status` | — | `{ state, queue_depth, recording, ws_connected, … }` |

## Hardware

- Raspberry Pi 5 (4GB or 8GB)
- Mini USB microphone (M-305 or any USB class-compliant mic)
- MicroSD card (16GB+)
- Optional: USB-C pass-through power bank for UPS resilience

## VS Code workspace

This project is part of the `foundry365.code-workspace` multi-root workspace.
It shares `tsconfig.base.json` from `../f365/` but has its own `package.json`
and is **not** an npm workspace inside `f365` — it deploys independently to the Pi.
