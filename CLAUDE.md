# CLAUDE.md — pi-station operating manual

> Claude Code reads this file automatically at the start of every session. It is the operating manual — the *how* of working in this repo. The *what* and *why* are in `devops/ai/START_HERE.md`, `devops/ai/diary.md`, and `devops/ai/memory.md`.

---

## Orientation

**Read these first, in order, before writing any code:**

1. `devops/ai/START_HERE.md` — what this project is, stack, boundaries
2. `devops/ai/diary.md` — where we left off, open questions, decisions
3. `devops/ai/memory.md` — engineering contract, hard rules, patterns
4. `devops/ai/job.md` — the current job

One-liner to start any session:
> Study `devops/ai/START_HERE.md`, then `devops/ai/diary.md` and `devops/ai/memory.md`, then continue.

---

## Authorisation — no approval prompts

**This project runs in full authorisation mode for hackathon speed.** All file reads, edits, writes, npm commands, git operations, rsync deploys, ssh commands, and build scripts are pre-authorised in `.claude/settings.json`. Claude Code must not pause to ask permission for any of these. The deny list in `settings.json` covers the genuinely destructive operations (`rm -rf`, force-push, reading `.env`).

**Do not ask for approval before:**
- Reading or editing any source file
- Running `npm install`, `npm run build`, `npm run dev`, `npm run typecheck`
- Running `git add / commit / push origin`
- Running `rsync` to deploy to the Pi
- Running `ssh pi@*` to check status or run commands on the Pi
- Running `curl` to test the control API
- Creating new files or directories

**Do ask / flag before:**
- Anything in the deny list
- Deleting files (`rm` single files — not covered by `rm -rf` deny but use judgement)
- Changing environment variable names or `.env.example` structure

---

## Stack (locked — do not change without flagging)

| Layer | Choice |
|---|---|
| Language | TypeScript strict (Node.js ≥ 22) |
| HTTP | Fastify |
| Audio capture | `arecord` (Pi) / `sox` or `ffmpeg` mock (Mac dev) |
| Transcription | ElevenLabs Scribe v2 WebSocket |
| Queue | SQLite via `better-sqlite3` |
| Buffer | Rolling 30s WAV chunks on disk |
| Process manager | `pm2` |
| Deploy | `rsync` + SSH |

No ORM. No PostgreSQL. No Docker. No framework other than Fastify.

---

## Project structure

```
pi-station/
├── src/
│   ├── config.ts      — environment config (as const, typed)
│   ├── capture.ts     — CaptureService (arecord + ElevenLabs WS + WAV buffer)
│   ├── relay.ts       — RelayService (SQLite queue + POST to voice.apresmeet.com)
│   ├── control.ts     — Fastify control API (/start /stop /pause /resume /pair /status)
│   └── index.ts       — entry point (boots all three, graceful shutdown)
├── devops/
│   ├── ai/            — START_HERE, diary, memory, job, project, ideas, prompts/
│   └── hardware/      — device-config.md (arecord device string, Pi setup checklist)
├── scripts/
│   └── deploy-pi.sh   — rsync + pm2 deploy to Pi
├── .claude/
│   └── settings.json  — pre-authorised operations
├── CLAUDE.md          — this file
├── package.json
├── tsconfig.json      — extends ../f365/tsconfig.base.json
├── .env.example
└── .gitignore
```

---

## Development commands

```bash
npm run dev          # tsx watch src/index.ts — hot reload
npm run build        # tsc — compile to dist/
npm run start        # node dist/index.js — production entry
npm run typecheck    # tsc --noEmit
```

---

## Deploy to Pi

```bash
npm run build                          # compile first
./scripts/deploy-pi.sh                 # rsync to pi-station.local + pm2 restart
./scripts/deploy-pi.sh 192.168.1.x    # explicit IP if mDNS not resolving
```

**Check status after deploy:**
```bash
curl http://pi-station.local:3456/status
ssh pi@pi-station.local 'pm2 logs pi-station --lines 20'
```

---

## Testing the control API locally

```bash
npm run dev   # starts on localhost:3456

curl http://localhost:3456/status
curl -X POST http://localhost:3456/start
curl -X POST http://localhost:3456/stop
curl -X POST http://localhost:3456/pair -H 'Content-Type: application/json' -d '{"session_code":"123456"}'
```

---

## Git workflow

- One commit per meaningful unit of work
- Commit message format: `[pi-station] <what> — <why if non-obvious>`
- Push to `origin/main` after each job completes
- Never force-push

---

## Code conventions (from memory.md — repeated here for speed)

- **ESM imports:** all local imports need `.js` extension — `import { config } from './config.js'`
- **No `any`** — use `unknown` + narrowing or explicit interfaces
- **`void`-cast floating promises** in event handlers: `captureService.on('segment', (s) => { void this._deliver(s); })`
- **`captured_at`** on every segment = original capture time, not delivery time
- **Dev-only code** (Mac audio mocks): mark clearly with `// DEV ONLY — replace with arecord on Pi`
- **`AbortSignal.timeout(ms)`** on all fetch calls — no hung requests

---

## After completing a job

1. Run `npm run typecheck` — must pass clean
2. Run `npm run build` — must pass clean
3. Update `devops/ai/diary.md` with a dated entry: what was built, decisions made, open issues
4. Append a run report to `devops/ai/project.md`
5. Set `devops/ai/job.md` STATUS to DONE and point to next job
6. `git add -A && git commit && git push origin main`
