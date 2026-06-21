# Pi-Station

Pi-Station is an edge platform for Raspberry Pi hardware. **MeetStation** is the first app running on it.

> The room keeps recording. Even when the internet doesn't.

## Platform structure

```text
pi-station/
├── shared/              PiApp contract and shared platform types
├── core/                config, logger, DB, state, GPIO-safe hardware control
├── hardware/            future pan/tilt, camera, and device stubs
└── apps/
    └── meet-station/    MeetPaper voice capture app
```

MeetStation is the current audio-ingestion app for MeetPaper Voice Intelligence. Future Pi apps should implement the shared `PiApp` contract and live under `apps/<name>/`.

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:3456](http://localhost:3456).

Mock mode is still the default. It does not need:

- a microphone
- a Raspberry Pi
- ElevenLabs credentials
- a real cloud ingest endpoint

## What MeetStation does

- captures audio server-side
- writes rolling WAV chunks locally
- emits mock or realtime transcript segments
- queues relay delivery in SQLite when offline
- serves a local dashboard and report

## Workspace commands

- `npm run dev` runs `apps/meet-station`
- `npm run typecheck` checks all workspaces
- `npm test` runs the MeetStation Vitest suite
- `npm run build` builds the workspace graph with TypeScript project references

## Pi deployment

Read [docs/PI_SETUP.md](docs/PI_SETUP.md) first.

Typical flow:

```bash
npm install
npm run build
./scripts/deploy-pi.sh
```

The deploy script syncs the repo, installs production dependencies on the Pi, rebuilds there, and starts `apps/meet-station/dist/index.js` under `pm2`.

## Environment

Important variables:

- `APP_ID=meet-station`
- `AUDIO_SOURCE=mock|arecord|file`
- `STT_PROVIDER=mock|elevenlabs`
- `VOICE_INGEST_URL=http://localhost:3456/mock/ingest`
- `PAIRING_MODE=local|remote`
- `ENABLE_GPIO=false`

See [.env.example](.env.example) for the full set.

## Adding a future app

1. Create `apps/<app-name>/`.
2. Implement the `PiApp` contract from [shared/src/PiApp.ts](/Users/bijumenon/Sites/pi-station/shared/src/PiApp.ts).
3. Add the workspace to the root `package.json`.
4. Wire its bootstrap and platform registration.

## Known limitations

- Remote pairing is still a TODO.
- ElevenLabs realtime behavior still needs live Pi verification.
- GPIO in `core/` remains safe and minimal; richer hardware work belongs in the `hardware/` workspace.
- Pan/tilt camera and AI HAT+ support are scaffolded only.
