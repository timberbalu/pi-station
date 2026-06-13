# pi-station — Agent Context

> Read `devops/ai/START_HERE.md` first. It is the orientation point for every session.
>
> Then read `devops/ai/diary.md` and `devops/ai/memory.md` before writing code.
>
> Read `devops/ai/job.md` for the current task before making changes.

## Session Start

Study `devops/ai/START_HERE.md`, then `devops/ai/diary.md` and `devops/ai/memory.md`, then `devops/ai/job.md`, then continue.

## Stack

- Backend: Node.js 22 + TypeScript strict
- HTTP: Fastify
- Audio capture: `arecord` on Pi, `sox` or `ffmpeg` for local mock/dev flows
- Transcription: ElevenLabs Scribe v2 WebSocket
- Queue: SQLite via `better-sqlite3`
- Buffering: rolling 30-second WAV chunks on disk
- Process manager: `pm2`
- Deploy: `rsync` + SSH

Do not introduce Docker, PostgreSQL, an ORM, or a different backend framework without explicit approval.

## Project Layout

```text
pi-station/
├── src/
│   ├── config.ts
│   ├── capture.ts
│   ├── relay.ts
│   ├── control.ts
│   └── index.ts
├── devops/
│   ├── ai/
│   └── hardware/
├── scripts/
│   └── deploy-pi.sh
├── .claude/
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── package.json
├── tsconfig.json
└── .env.example
```

## Working Rules

- Keep TypeScript strict. Do not use `any`.
- Use ESM local imports with `.js` extensions.
- Keep business logic in services, not the Fastify bootstrap.
- Treat `captured_at` as the original capture timestamp, never delivery time.
- Use `AbortSignal.timeout(ms)` for outbound fetches.
- Mark Mac-only audio mocks clearly as dev-only.
- Flag environment variable name changes before making them.
- Avoid destructive operations and do not read real `.env` files.

## Commands

```bash
npm run dev
npm run build
npm run start
npm run typecheck
```

## Deploy

```bash
./scripts/deploy-pi.sh
./scripts/deploy-pi.sh pi-station.local
```

Check status with:

```bash
curl http://pi-station.local:3456/status
ssh pi@pi-station.local 'pm2 logs pi-station --lines 20'
```

## Done Criteria

1. Run `npm run typecheck`
2. Run `npm run build`
3. Update `devops/ai/diary.md`
4. Append a run report to `devops/ai/project.md`
5. Set `devops/ai/job.md` status appropriately

## Notes

- `CLAUDE.md` remains for Claude-specific workflow guidance.
- `AGENTS.md` is the repo-root instruction file Codex should rely on.
