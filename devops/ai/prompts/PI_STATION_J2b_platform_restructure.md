# PI_STATION_J2b — Platform restructure: Pi-Station hosts MeetStation as the first app

> **Full-authorisation mode.** Read `CLAUDE.md` — all file edits, npm, git are pre-authorised. No approval prompts.
>
> **Read first:** `devops/ai/START_HERE.md`, `devops/ai/diary.md`, `devops/ai/memory.md`.
>
> **Recommended model:** Claude Opus or GPT-5 Codex.
>
> **Strategic context (from START_HERE):** The hackathon is a growth hacking technique. This restructure is permanent product architecture — build it as you would if shipping to real organisers. Pi-Station is the F365 of edge hardware.

---

## 1. The decision and why it matters

Pi-Station is not an app. It is a **platform** — the edge equivalent of F365. It runs apps on Raspberry Pi hardware. The first app is **MeetStation** (the audio/video capture and intelligence layer for MeetPaper Voice Intelligence events).

This mirrors the F365 architecture exactly:

```
F365 (cloud platform)              Pi-Station (edge platform)
├── shared/                        ├── core/           ← platform kernel
├── server/                        ├── apps/
│   ├── foundry/                   │   └── meet-station/   ← first app
│   ├── meetpaper/                 ├── shared/         ← types, interfaces, config
│   └── voice/                     └── hardware/       ← Pi hardware abstractions
└── client/
```

Future apps on Pi-Station will follow the same pattern: add `apps/<app-name>/`, register it, done — without touching the platform core. This is the same contract as F365's npm workspaces.

**What changes:** directory structure and import paths. **What does not change:** any logic, any behaviour, any tests. This is a pure structural refactor. The mock demo must run identically after this job as it did before.

---

## 2. Target structure

```
pi-station/                          ← platform root (unchanged)
├── package.json                     ← platform root package (add workspaces)
├── tsconfig.json                    ← platform tsconfig (extends f365 base)
├── .env.example                     ← unchanged
├── .gitignore                       ← unchanged
├── .claude/                         ← unchanged
├── CLAUDE.md                        ← update app name references
├── README.md                        ← update to reflect platform architecture

├── core/                            ← NEW: platform kernel (runs on the Pi regardless of app)
│   ├── package.json                 (@pi-station/core)
│   ├── tsconfig.json
│   └── src/
│       ├── db/                      ← MOVED from src/db/
│       ├── state/                   ← MOVED from src/state/
│       ├── hardware/                ← MOVED from src/hardware/
│       ├── sync/                    ← placeholder for J3b SyncService
│       ├── config.ts                ← MOVED from src/config.ts
│       ├── logger.ts                ← MOVED from src/logger.ts
│       └── types.ts                 ← MOVED from src/types.ts (platform-level types only)

├── shared/                          ← NEW: cross-app interfaces
│   ├── package.json                 (@pi-station/shared)
│   ├── tsconfig.json
│   └── src/
│       ├── PiApp.ts                 ← the PiApp interface (equivalent of StationComponent)
│       └── index.ts

├── apps/
│   └── meet-station/                ← NEW: first app (what src/ is today)
│       ├── package.json             (@pi-station/meet-station)
│       ├── tsconfig.json
│       └── src/
│           ├── MeetStationApp.ts    ← RENAMED from StationApp.ts
│           ├── index.ts             ← MOVED + updated imports
│           ├── capture/             ← MOVED from src/capture/
│           ├── relay/               ← MOVED from src/relay/
│           ├── control/             ← MOVED from src/control/
│           ├── report/              ← MOVED from src/report/
│           ├── public/              ← MOVED from src/public/
│           └── types.ts             ← app-level types only

├── hardware/                        ← NEW: Pi hardware abstractions (shared across apps)
│   ├── package.json                 (@pi-station/hardware)
│   ├── tsconfig.json
│   └── src/
│       ├── servo/                   ← pan/tilt, PCA9685 (J6)
│       ├── camera/                  ← libcamera, AI HAT+ face detection (J6)
│       ├── display/                 ← OLED placeholder (future)
│       └── gpio/                    ← GPIO abstraction (moved from hardware/)

├── fixtures/                        ← MOVED from root
├── test/                            ← MOVED, imports updated
├── scripts/                         ← unchanged
├── systemd/                         ← unchanged
├── docs/                            ← unchanged
└── devops/                          ← unchanged
```

---

## 3. The `PiApp` interface — platform contract

This is the single most important new file. Create `shared/src/PiApp.ts`:

```typescript
/**
 * PiApp — the contract every Pi-Station application implements.
 *
 * Pi-Station is a platform. Apps are registered with the platform,
 * which owns: device identity, SQLite, sync, hardware, and the
 * offline-resilience guarantee.
 *
 * Apps own: their capture logic, their local buffers, their relay,
 * their dashboard contribution, and their report section.
 *
 * This is the Pi-Station equivalent of F365's app module contract.
 */
export interface PiAppContext {
  readonly config: import('./index.js').PlatformConfig;
  readonly db: import('better-sqlite3').Database;
  readonly logger: import('pino').Logger;
  readonly dataDir: string;       // app gets its own subdir: data/<app-id>/
}

export interface PiAppStatus {
  readonly id: string;            // 'meet-station', 'future-app'
  readonly label: string;         // 'MeetStation', 'FutureApp'
  readonly healthy: boolean;
  readonly buffering: boolean;    // true when local-buffering due to connectivity
  readonly queuedItems: number;
  readonly detail: Record<string, unknown>;   // app-specific status
}

export interface PiApp {
  readonly id: string;
  readonly label: string;

  init(ctx: PiAppContext): Promise<void>;
  start(sessionId: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  flush(): Promise<void>;             // drain local buffer to cloud
  getStatus(): PiAppStatus;
  shutdown(): Promise<void>;
}
```

Export from `shared/src/index.ts`. This replaces the `StationComponent` interface from the J3 plan — the J3 component platform refactor now builds *on top of* this, not instead of it.

---

## 4. `PlatformConfig` — core config type

Move `AppConfig` from `src/config.ts` to `core/src/config.ts` and rename the exported type to `PlatformConfig`. Update all imports. The zod schema and `loadConfig()` function are unchanged — only the module path and type name change.

Add one new field to the env schema (no breaking change):

```typescript
APP_ID: z.string().min(1).default('meet-station'),
```

This lets the platform know which app is registered at runtime. Future: comma-separated for multi-app.

---

## 5. npm workspaces

Update root `package.json`:

```json
{
  "name": "pi-station",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22 <23" },
  "workspaces": [
    "shared",
    "core",
    "hardware",
    "apps/meet-station"
  ],
  "scripts": {
    "dev":       "npm run dev --workspace @pi-station/meet-station",
    "build":     "npm run build --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test":      "npm run test --workspace @pi-station/meet-station",
    "start":     "npm run start --workspace @pi-station/meet-station"
  }
}
```

Each workspace `package.json`:

```json
// shared/package.json
{ "name": "@pi-station/shared", "version": "0.1.0", "type": "module" }

// core/package.json
{ "name": "@pi-station/core", "version": "0.1.0", "type": "module",
  "dependencies": { "@pi-station/shared": "*", "better-sqlite3": "...", "pino": "...", "dotenv": "...", "zod": "..." } }

// hardware/package.json
{ "name": "@pi-station/hardware", "version": "0.1.0", "type": "module",
  "dependencies": { "@pi-station/shared": "*", "@pi-station/core": "*" } }

// apps/meet-station/package.json
{ "name": "@pi-station/meet-station", "version": "0.1.0", "type": "module",
  "dependencies": { "@pi-station/shared": "*", "@pi-station/core": "*", "fastify": "...", "ws": "...", "pino-pretty": "..." },
  "devDependencies": { "vitest": "...", "tsx": "...", "typescript": "..." },
  "scripts": {
    "dev":       "tsx watch src/index.ts",
    "build":     "tsc",
    "start":     "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test":      "vitest run"
  }
}
```

---

## 6. tsconfig per workspace

Each workspace has its own `tsconfig.json` extending the platform root which extends `../f365/tsconfig.base.json`:

```json
// tsconfig.json (platform root — new)
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "../f365/tsconfig.base.json",
  "files": [],
  "references": [
    { "path": "shared" },
    { "path": "core" },
    { "path": "hardware" },
    { "path": "apps/meet-station" }
  ]
}

// shared/tsconfig.json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}

// core/tsconfig.json — same pattern, references shared
// hardware/tsconfig.json — references shared + core
// apps/meet-station/tsconfig.json — references shared + core + hardware
```

---

## 7. MeetStationApp — rename and re-home

Rename `src/StationApp.ts` → `apps/meet-station/src/MeetStationApp.ts`. Change the class name from `StationApp` to `MeetStationApp`. The class body is **completely unchanged** — this is a rename and move only. All existing logic, all existing method signatures, all existing behaviour stays exactly the same.

Update `apps/meet-station/src/index.ts` imports to match the new paths. The bootstrap logic in `index.ts` is **unchanged** — same wiring, same construction, same shutdown handler.

---

## 8. Hardware workspace — scaffold only

Create `hardware/src/` with placeholder files for the capabilities coming in J6:

```typescript
// hardware/src/servo/PanTiltController.ts
/**
 * PanTiltController — drives pan/tilt servos via PCA9685 over I2C.
 * Implementation in J6 (VideoComponent).
 * Placeholder ensures the import path is stable.
 */
export class PanTiltController {
  async init(): Promise<void> { /* J6 */ }
  async setPosition(pan: number, tilt: number): Promise<void> { /* J6 */ }
  async shutdown(): Promise<void> { /* J6 */ }
}

// hardware/src/camera/CameraController.ts
/**
 * CameraController — libcamera + AI HAT+ face detection.
 * Implementation in J6.
 */
export class CameraController {
  async init(): Promise<void> { /* J6 */ }
  async startCapture(outputPath: string): Promise<void> { /* J6 */ }
  async stopCapture(): Promise<void> { /* J6 */ }
  async shutdown(): Promise<void> { /* J6 */ }
}

// hardware/src/index.ts — re-exports
export { PanTiltController } from './servo/PanTiltController.js';
export { CameraController } from './camera/CameraController.js';
```

These are stubs. They compile. They do nothing yet. They establish the import paths J6 will fill in.

---

## 9. VS Code workspace — update `foundry365.code-workspace`

The workspace file at `/Users/bijumenon/Sites/f365/foundry365.code-workspace` already has `pi-station` as the third folder. No change needed to the workspace file — the folder root is still `/Users/bijumenon/Sites/pi-station`. The internal structure changed but VS Code sees the same root.

---

## 10. Update `.env.example` and `CLAUDE.md`

**`.env.example`:** Add `APP_ID=meet-station` with a comment explaining it identifies which app is active.

**`CLAUDE.md`:** Update the structure section to reflect the new layout. Update the `npm run dev` command to note it runs the meet-station app. Update all file path references from `src/` to `apps/meet-station/src/` where relevant.

**`README.md`:** Add a section explaining Pi-Station is a platform, MeetStation is the first app, and how to add future apps (implement `PiApp`, register in the platform, add a workspace).

---

## 11. Update deploy scripts

`scripts/deploy-pi.sh` currently rsyncs the whole project. After the restructure, the deploy target is still the whole project root — workspaces are resolved locally via `npm install`. No change to the rsync command needed. But update the pm2 start command path if `dist/index.js` moves:

```bash
# If apps/meet-station/dist/index.js is the new entry point:
pm2 start apps/meet-station/dist/index.js --name meet-station
# (or keep meet-station as the pm2 process name — better than pi-station)
```

Update `scripts/provision-pi.sh` to use `meet-station` as the pm2 process name.

---

## 12. Tests — update imports only

All 6 test files in `test/` move to `apps/meet-station/test/`. Their logic is **completely unchanged**. Only the import paths update to reflect the new module locations. After moving, run `npm test` — all 7 tests must still pass.

---

## 13. What must NOT change

- All logic in `CaptureService`, `RelayService`, `WavChunkWriter`, `StationStateMachine`, `RelayService`, `ReportGenerator`, `control/`, `db/`, `state/` — these are moves, not rewrites
- The mock demo end-to-end flow — `npm run dev` → dashboard at localhost:3456 → pair → start → simulate drop → reconnect → stop → report
- The vitest test suite — 7 tests, all green, after the move
- `tsconfig.json` extension of `../f365/tsconfig.base.json` — unchanged
- `.claude/settings.json` — unchanged
- `devops/ai/` — unchanged
- `devops/hardware/` — unchanged

---

## 14. Build order (work straight through)

1. Create `shared/` workspace — `PiApp.ts` interface + package.json + tsconfig. Build it.
2. Create `core/` workspace — move `db/`, `state/`, `hardware/` (GPIO controller), `config.ts`, `logger.ts`, `types.ts` (platform types). Update all internal imports. Build.
3. Create `hardware/` workspace — stub `PanTiltController`, `CameraController`. Build.
4. Create `apps/meet-station/` workspace — move everything else from `src/`. Rename `StationApp` → `MeetStationApp`. Update all imports. Move tests. Build.
5. Update root `package.json` workspaces. Run `npm install` at root.
6. `npm run typecheck` — must be clean across all workspaces.
7. `npm test` — 7 tests green.
8. `npm run dev` — dashboard at localhost:3456. Walk the full demo: pair → start → mock transcript → simulate drop → reconnect → stop → report. Must be identical to J1.
9. Update `CLAUDE.md`, `README.md`, `.env.example`, deploy scripts.
10. Remove old `src/` directory (now fully replaced by workspaces).

---

## 15. Done criteria

- [ ] `shared/`, `core/`, `hardware/`, `apps/meet-station/` all exist as npm workspaces
- [ ] `PiApp` interface in `shared/src/PiApp.ts`
- [ ] `MeetStationApp` in `apps/meet-station/src/MeetStationApp.ts` (renamed from StationApp, logic unchanged)
- [ ] `hardware/` has stub `PanTiltController` and `CameraController`
- [ ] `npm run typecheck` clean across all workspaces
- [ ] `npm test` — 7 tests green
- [ ] `npm run dev` — full mock demo works end to end, unchanged from J1
- [ ] Old `src/` directory removed
- [ ] `CLAUDE.md` updated with new structure
- [ ] `README.md` explains Pi-Station as platform, MeetStation as first app
- [ ] `devops/hardware/device-config.md` and all `devops/ai/` files unchanged
- [ ] Diary + project + job updated
- [ ] `git commit -m "[pi-station] Platform restructure: Pi-Station platform, MeetStation first app"` + push

---

## 16. Close the loop (required)

1. `npm run typecheck` and `npm run build` clean.
2. `npm test` green.
3. Update `devops/ai/diary.md` — what was restructured, any decisions made.
4. Append to `devops/ai/project.md`.
5. Set `devops/ai/job.md` STATUS to DONE. Next job: J2 (Pi provisioning).
6. Commit + push.
