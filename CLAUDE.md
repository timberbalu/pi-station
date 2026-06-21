# CLAUDE.md — pi-station operating manual

> The product boundary lives in `devops/ai/START_HERE.md`. This file is the repo workflow and structure guide.

## Read order

1. `devops/ai/START_HERE.md`
2. `devops/ai/diary.md`
3. `devops/ai/memory.md`
4. `devops/ai/job.md`

One-liner:
> Study `devops/ai/START_HERE.md`, then `devops/ai/diary.md` and `devops/ai/memory.md`, then continue.

## Authorisation

This repo runs in full-authorisation mode. File edits, npm commands, git, rsync, ssh, and build commands are pre-authorised. Do not pause for routine approval prompts.

## Platform layout

```text
pi-station/
├── shared/                  PiApp contract and shared types
├── core/                    config, logger, DB, state, GPIO-safe hardware control
├── hardware/                future pan/tilt, camera, and device stubs
├── apps/
│   └── meet-station/        current MeetPaper voice app
├── docs/
├── scripts/
├── systemd/
└── devops/
```

`apps/meet-station/src/` contains the J1 app logic moved into platform form. The old repo-root `src/` layout is gone.

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

- `npm run dev` starts MeetStation from `apps/meet-station/src/index.ts`
- `npm run start` runs `apps/meet-station/dist/index.js`

## Deploy

```bash
npm run build
./scripts/deploy-pi.sh
./scripts/deploy-pi.sh 192.168.1.x
```

Check status:

```bash
curl http://pi-station.local:3456/status
ssh pi@pi-station.local 'pm2 logs pi-station --lines 20'
```

## Conventions

- TypeScript strict, ESM, no `any`
- Local imports use `.js`
- Use `AbortSignal.timeout(ms)` for network calls
- Mock mode must never break
- Browser never captures microphone audio
- Do not read real `.env` files

## After a job

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. Update `devops/ai/diary.md`
5. Append to `devops/ai/project.md`
6. Set `devops/ai/job.md` status
