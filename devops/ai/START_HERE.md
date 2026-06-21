# START HERE — read this before anything else

> **You are working on MeetPaper Station (pi-station).** This file is the orientation point for every new chat or session. Read it first, then read `diary.md` and `memory.md`. If anything in this repo contradicts this file, **this file wins** — flag the contradiction rather than following the older document.

---

## Strategic intent — read this before making any technology choice

**The hackathon is a growth hacking technique, not a competition.** The goal is not to use every sponsor technology or win prizes. The goal is to build something that becomes a real, lasting part of ApresMeet and Foundry365. Raspberry Pi in the product stack is the win.

This means every technology choice must be justified on its own merits for the product:
- If ElevenLabs Scribe is better than Vosk for this use case, use ElevenLabs.
- If Whisper is better than Vosk, use Whisper.
- Don't use a technology because the hackathon recommends it. Use it because it's the right long-term choice.
- Build production-quality, not prototype-quality. Every decision should be one you'd make if shipping to real organisers today.

**The hackathon sponsor technologies and their honest assessment:**
- **Vosk** — lightweight, fast, offline. Good for constrained devices. Accuracy is lower than Whisper or ElevenLabs. Acceptable as a live local fallback but not the quality ceiling.
- **faster-whisper** — better accuracy than Vosk, heavier. The right local STT if quality matters more than latency.
- **NeuTTS** — TTS, not STT. Not in scope for the core product.
- **Ollama (Gemma 2B)** — on-device LLM. CoCo handles post-session AI in the cloud with real compute. Ollama on Pi is a compromise. Not a product dependency.
- **AI HAT+ (Hailo NPU)** — genuinely useful for real-time vision (face detection, pose, tracking). Directly enables the pan/tilt speaker-tracking camera. A real product addition.

---

---

## The one-liner handoff (paste this to start any new chat or Codex session)

> Study `devops/ai/START_HERE.md`, then `devops/ai/diary.md` and `devops/ai/memory.md`, then continue.

**What "continue" means:** after reading those three files, read `devops/ai/job.md` — it holds the ONE current job and points to the prompt file with the full detail. Then **do that job**. This repo is in **full-authorisation mode** (`.claude/settings.json` + `CLAUDE.md`): do not pause to ask for approval for file edits, npm, git, rsync, ssh, or build commands. Make sensible assumptions, document them, and keep going.

So the full flow from the one-liner is:

```
START_HERE.md  →  diary.md  →  memory.md  →  job.md  →  prompts/<current>.md  →  build it
```

---

## 1. What pi-station is

**MeetPaper Station** is a **local intelligence node** running on a Raspberry Pi 5. It sits permanently on the local side of unreliable venue connectivity and does real work there — capture, local AI processing, private storage, and attendee interaction. It is not a buffer or a resilience device; it is a first-class compute node.

The Pi-Station has three roles:
1. **Storage** — WAV buffer, SQLite transcripts, segments. Always, regardless of network.
2. **Private AI processing** — local Whisper STT as the default pipeline; local summarisation. Audio never leaves the room unless the admin explicitly chooses to send it to the cloud.
3. **Private interaction** — Bluetooth polls and feedback from attendees. The Pi is a local interaction hub, not just a capture device.

When connectivity returns, the Station syncs to the VI database. The admin then chooses: keep the local Whisper transcript, or re-process the WAV chunks through ElevenLabs (spending VI tokens) for higher quality. **ElevenLabs is an optional upgrade path, not a dependency.** This is the privacy guarantee: audio is private until the admin decides otherwise.

For the current build (J1–J4), the live ElevenLabs Scribe WS is still the primary STT provider because it is already implemented. The Whisper-first architecture is the direction for J5+. Do not treat this as a contradiction — the component/provider model (J3) is the seam that makes the swap clean.

It is a **hardware companion to MeetPaper** — not a cloud service, not part of the apm PHP codebase, not part of the f365 monorepo npm workspaces. Standalone Node.js/TypeScript, deploys to a Pi over SSH.

---

## 2. Where this sits in the ecosystem

```
ApresMeet (PHP / MySQL / Elastic Beanstalk)
  └── MeetPaper → Voice Intelligence → voice.apresmeet.com
                                            ↑
                              pi-station pushes segments here
                              (POST /ws/station/ingest — receiver still to build, J3)

Foundry365 (Node.js / TypeScript / ECS)
  └── [separate product — pi-station does not connect to f365]
```

**pi-station talks to ApresMeet's Voice Intelligence endpoint only.** It has no connection to Foundry365, no PostgreSQL, no ALLDO. Its only external dependencies are ElevenLabs (Scribe v2 WebSocket) and `voice.apresmeet.com` — and in mock mode it needs neither.

---

## 3. The stack — locked

| Layer | pi-station |
|---|---|
| Language | Node.js ≥ 22 + TypeScript strict |
| HTTP | Fastify |
| Validation | zod |
| Logging | pino |
| Audio | `arecord` (ALSA, Pi OS) / mock source / file replay for dev |
| Transcription | ElevenLabs Scribe v2 (real) / mock provider (default) |
| Queue + storage | SQLite via `better-sqlite3` |
| Local buffer | Rolling 30s WAV chunks on disk |
| Dashboard | Vanilla HTML/CSS/JS (no framework), MeetPaper design tokens |
| Tests | vitest |
| Deploy | `rsync` + `pm2` / `systemd` over SSH |
| Target hardware | Raspberry Pi 5 (4GB) + Mini USB Mic M-305 |

**Not in scope:** Docker as a hard dependency, PostgreSQL, Redis, any ORM, React/Next, any cloud hosting, any f365 npm workspace dependency.

---

## 4. Hard rules

- **Mock mode is first-class and must never be broken.** The whole demo runs with no mic, no key, no Pi, no cloud. Real adapters are alternatives behind interfaces — never the only path.
- **Recording must never stop because a cloud service failed.** STT disconnect, relay failure, ingest 503 — degrade to a safe state, keep the WAV buffer writing, never crash.
- **The browser never touches the microphone.** Capture is server-side; the dashboard is a control surface only.
- **Never import from `../f365`** at runtime. `tsconfig.json` extends `../f365/tsconfig.base.json` for compiler config only — no runtime coupling.
- **Never write PHP or MySQL** here. It does not belong in this project.
- **No secrets in the repo.** `ELEVENLABS_API_KEY` is server-side only, never reaches dashboard JS. `.env` is gitignored; only `.env.example` is committed.
- **TypeScript strict, ESM, no `any`.** Local imports use `.js` extensions. Validate request bodies with zod.

---

## 5. File manifest

| File | Role |
|---|---|
| `devops/ai/START_HERE.md` | This file — orientation (read first) |
| `devops/ai/diary.md` | Session log — decisions, findings, where we left off (read second) |
| `devops/ai/memory.md` | Engineering contract — patterns, constraints (read third) |
| `devops/ai/job.md` | Current job pointer (read fourth — then do it) |
| `devops/ai/prompts/` | Build prompt files, one per job — the current one has full detail |
| `devops/ai/project.md` | Job run log (append a report when a job finishes) |
| `devops/ai/ideas.md` | Future ideas parking lot |
| `devops/hardware/` | Pi setup notes, arecord device config, wiring notes |
| `devops/design/meetpaper_station_concept.html` | Concept paper — **visual reference for the dashboard + report** (match its design language) |
| `devops/hardware/PREREQUISITES.md` | What must be true before each phase (mock / Pi / ElevenLabs / ingest) — human vs LLM tasks |
| `scripts/preflight.sh` | Machine-checkable prereqs — `bash scripts/preflight.sh` (laptop) or `--pi` (on the Pi) |
| `CLAUDE.md` | Operating manual — full-auth mode, commands, conventions |
| `.claude/settings.json` | Pre-authorised operations (no approval prompts) |
| `scripts/deploy-pi.sh` | Deploy script — rsync + pm2 restart |

---

## 6. Current state

> As of 2026-06-21: J1–J6 complete. Pi provisioned and running at `pistation.local:3456`. M-305 mic on `plughw:2,0`. Camera Module 3 (imx708) and AI HAT+ confirmed. VideoComponent + AI HAT+ face detection + pan/tilt tracking built and tested. 84 tests green. **J7 (cloud upgrade path — admin re-submits WAV to ElevenLabs)** is next. See `diary.md` for the full session log.

*(Update this line whenever milestone state changes.)*
