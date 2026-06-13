# START HERE — read this before anything else

> **You are working on MeetPaper Station (pi-station).** This file is the orientation point for every new chat or session. Read it first, then read `diary.md` and `memory.md`. If anything in this repo contradicts this file, **this file wins** — flag the contradiction rather than following the older document.

---

## The one-liner handoff (paste this to start any new chat)

> Study `devops/ai/START_HERE.md`, then `devops/ai/diary.md` and `devops/ai/memory.md`, then continue.

---

## 1. What pi-station is

**MeetPaper Station** is a dedicated local audio ingestion server that runs on a Raspberry Pi 5. It decouples audio capture from network connectivity so that a dropping Wi-Fi connection at an event venue never interrupts a Voice Intelligence (VI) recording session.

It is a **hardware companion to MeetPaper** — not a cloud service, not part of the apm PHP codebase, not part of the f365 monorepo npm workspaces. It is a standalone Node.js/TypeScript project that deploys to a Pi over SSH.

The three services it runs:

| Service | File | Job |
|---|---|---|
| `pi-capture` | `src/capture.ts` | Opens USB mic, streams PCM to ElevenLabs Scribe v2 WS, writes rolling WAV buffer to disk |
| `pi-relay` | `src/relay.ts` | POSTs committed `VI_TRANSCRIPT_SEGMENTS` to `voice.apresmeet.com`; queues locally in SQLite when offline, flushes on reconnect |
| `pi-control` | `src/control.ts` | Fastify HTTP API on LAN — `POST /start /stop /pause /resume /pair`, `GET /status` |

---

## 2. Where this sits in the ecosystem

```
ApresMeet (PHP / MySQL / Elastic Beanstalk)
  └── MeetPaper → Voice Intelligence → voice.apresmeet.com
                                            ↑
                              pi-station pushes segments here
                              (POST /ws/station/ingest)

Foundry365 (Node.js / TypeScript / ECS)
  └── [separate product — pi-station does not connect to f365]
```

**pi-station talks to ApresMeet's Voice Intelligence endpoint only.** It has no connection to Foundry365, no PostgreSQL, no ALLDO. Its only external dependency is ElevenLabs (Scribe v2 WebSocket) and `voice.apresmeet.com`.

---

## 3. The stack — locked

| Layer | pi-station |
|---|---|
| Language | Node.js ≥ 22 + TypeScript strict |
| HTTP | Fastify |
| Audio | `arecord` (ALSA, Pi OS) / `sox` or `ffmpeg` for Mac dev |
| Transcription | ElevenLabs Scribe v2 — WebSocket streaming |
| Queue | SQLite via `better-sqlite3` |
| Local buffer | Rolling 30s WAV chunks on disk |
| Deploy | `rsync` + `pm2` over SSH |
| Target hardware | Raspberry Pi 5 (4GB) + Mini USB Mic M-305 |

**Not in scope:** Docker, PostgreSQL, Redis, any ORM, any cloud hosting, any f365 npm workspace dependency.

---

## 4. Hard rules

- **Never import from `../f365`** at runtime. The `tsconfig.json` extends `../f365/tsconfig.base.json` for TypeScript compiler config only — no runtime coupling.
- **Never write PHP or MySQL** in this project. It does not belong here.
- **Never require an internet connection to record.** If `voice.apresmeet.com` is unreachable, segments must queue in SQLite and flush later. Recording must never stop because the network is down.
- **`arecord` is the audio source on the Pi.** On Mac dev, mock the audio source or use `sox`/`ffmpeg` — document any dev-only substitution clearly with `// DEV ONLY` comments.
- **TypeScript strict** throughout — same base config as f365. No `any`, no non-null assertions without a comment, no `ts-ignore`.
- **`captured_at`** on every segment is the original capture timestamp, not the delivery timestamp. The server must be able to reconstruct a coherent timeline even when segments arrive late.

---

## 5. File manifest

| File | Role |
|---|---|
| `devops/ai/START_HERE.md` | This file — orientation (read first) |
| `devops/ai/diary.md` | Session log — decisions, findings, where we left off (read second) |
| `devops/ai/memory.md` | Engineering contract — patterns, constraints (read third) |
| `devops/ai/job.md` | Current job pointer |
| `devops/ai/project.md` | Job run log |
| `devops/ai/ideas.md` | Future ideas parking lot |
| `devops/ai/prompts/` | Claude Code prompt files, one per build job |
| `devops/hardware/` | Pi setup notes, arecord device config, wiring notes |
| `scripts/deploy-pi.sh` | Deploy script — rsync + pm2 restart |

---

## 6. Current state

> As of 2026-06-13: project scaffolded at hackathon (Agents in the Wild, Blue Garage Lewisham). Three source files written (`capture.ts`, `relay.ts`, `control.ts`). Not yet deployed to Pi. Not yet tested with real ElevenLabs credentials. See `diary.md` for session log.

*(Update this line whenever milestone state changes.)*
