# PI_STATION_J3 — Refactor into a generic multi-component platform

> **This is an architectural refactor, not a feature build.** The goal: turn MeetPaper Station from a voice-only capture server into a **generic local capture platform** that hosts multiple independent *components* — voice is the first, video will be the second, others will follow. Do this as a careful, test-protected refactor that **never breaks the existing voice demo**.
>
> **Read first:** `devops/ai/START_HERE.md`, `devops/ai/diary.md`, `devops/ai/memory.md`. Then read the current code you will be refactoring: `src/StationApp.ts`, `src/capture/CaptureService.ts`, `src/relay/RelayService.ts`, `src/state/StationStateMachine.ts`, `src/control/routes.ts`, `src/types.ts`.
>
> **Run in full-authorisation mode.** Recommended model: GPT-5 Codex or Claude Opus — this touches the core orchestration; do it carefully.
>
> **The prime directive:** at every step, `npm test` stays green and the J1 voice demo still runs end to end (pair → start → mock transcript → simulate drop → reconnect → stop → report). If a refactor step would break the demo, stop and reconsider. Mock-first remains sacred.

---

## 1. Why — the target picture

Today `StationApp` hard-codes one pipeline: audio → transcript → relay → report. "Recording" means "voice recording." The status shape, the session model, and the state machine all assume voice.

The Station should instead be a **host** that runs one or more **components**. Each component is a self-contained capture concern with its own source, its own local buffer, its own optional cloud relay, and its own contribution to status and the report. The host owns: the device, the network/connectivity model, the session lifecycle, pairing, the SQLite database, the control API, the dashboard shell, the state machine, and the offline-buffering guarantee. Components plug into that.

```
Station Host (device, session, network, DB, API, dashboard, state)
 ├── VoiceComponent   (mic → STT → transcript segments → relay)   ← exists today, refactor into this
 ├── VideoComponent   (camera → frames/clips → local buffer → relay)   ← future (J5+), scaffold the seam only
 └── …future components (presence, sensors, etc.)
```

The one invariant generalises: **capture survives a network drop** — for every component. Each component buffers locally and flushes on reconnect, independently.

---

## 2. The Component contract

Define a `StationComponent` interface (in `src/components/StationComponent.ts`). Keep it small and honest — model it on what VoiceComponent actually needs, don't over-abstract for imaginary cases. A workable shape:

```ts
export interface ComponentContext {
  readonly config: AppConfig;
  readonly repositories: Repositories;
  readonly bus: StationEventBus;
  readonly logger: Logger;
  readonly dataDir: string;            // component gets its own subdir
}

export interface ComponentStatus {
  readonly id: string;                 // "voice", "video", …
  readonly healthy: boolean;
  readonly buffering: boolean;         // true when local-buffering due to network/source issue
  readonly queuedItems: number;        // items waiting to flush
  readonly detail: Record<string, unknown>;  // component-specific status (mic, stt, etc.)
}

export interface StationComponent {
  readonly id: string;                 // unique key
  readonly label: string;              // human label for the dashboard

  init(ctx: ComponentContext): Promise<void>;
  startSession(session: SessionSummary): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stopSession(): Promise<void>;
  flush(): Promise<void>;              // attempt to drain local buffer to cloud
  getStatus(): ComponentStatus;
  contributeToReport(session: SessionSummary): ComponentReportSection;
  shutdown(): Promise<void>;
}
```

`ComponentReportSection` is a small typed object: `{ id, label, summary, items, health }` that the report renderer composes into the page.

---

## 3. Refactor VoiceComponent out of StationApp

Move the voice-specific orchestration currently in `StationApp` (the capture service wiring, transcript→relay handoff, the mic/stt/buffer status, the transcript portion of the report) into `src/components/voice/VoiceComponent.ts` implementing `StationComponent`. It internally owns the existing `CaptureService`, `RelayService`, `WavChunkWriter`, transcript providers, and queue. Nothing about voice logic should change — only its *home*. The existing `capture/`, `relay/` modules stay; VoiceComponent composes them.

`StationApp` becomes the **host**:
- Holds a `components: StationComponent[]` registry (built from config — see §6).
- `pair/start/pause/resume/stop` fan out to every registered component (`startSession` on each, etc.).
- Owns the session model, the state machine, pairing, the DB, the event bus, mock-ingest, and the simulate endpoints.
- Aggregates status: top-level station state + a `components: ComponentStatus[]` array.
- Composes the report from each component's `contributeToReport`.

---

## 4. Generalise the state machine and "offline buffering"

The station-level state stays as-is (IDLE…RECORDING…OFFLINE_BUFFERING…SYNCING…REPORT_READY) — it's the *aggregate* health. Recompute it from components: if **any** component is buffering → `OFFLINE_BUFFERING`; when **all** components are healthy and drained → back through `SYNCING` to `RECORDING`. The `reconcileOperationalState()` logic in `StationApp` already does this for voice; generalise it to fold over `components[].getStatus()`. Keep per-component health visible in status so the dashboard can show which component is degraded.

---

## 5. Status, API, and dashboard changes

- **`GET /status`** gains a `components: ComponentStatus[]` array. Keep the existing top-level `mic`/`stt`/`relay`/`buffer` fields **for now** but populate them from the voice component (back-compat so the J1 dashboard keeps working); mark them deprecated in a comment. New dashboard code should read `components[]`.
- **Dashboard** — add a components row: one card per component showing id, healthy/buffering, queued count. Voice card shows mic/stt/queue as today. Leave a visually obvious empty slot pattern so a video card will drop in naturally. Keep the MeetPaper styling (see `devops/design/meetpaper_station_concept.html`).
- **The offline banner** stays station-level (aggregate), but its subline can name which component is buffering ("Voice — segments queued locally").

---

## 6. Component registration (config-driven)

Add `ENABLED_COMPONENTS=voice` to `.env.example` (comma-separated). The host reads it and instantiates only the listed components from a registry/factory (`src/components/registry.ts`). Unknown names → clear startup error. This is how video gets added later: implement `VideoComponent`, register it, set `ENABLED_COMPONENTS=voice,video`. **For J3, only `voice` is implemented.**

---

## 7. Scaffold the video seam — interface only, no implementation

To prove the abstraction holds, create `src/components/video/VideoComponent.ts` as a **stub** implementing `StationComponent`: it registers, reports `healthy: true, buffering: false, queuedItems: 0`, writes nothing, and its report section says "Video component — not yet implemented." It must **not** be in the default `ENABLED_COMPONENTS`. Add a short `docs/COMPONENTS.md` explaining how to author a new component (implement the interface, add to the registry, enable via env). This is the deliverable that proves the platform is generic — but do not build real video capture (that's a later job, J5).

---

## 8. Tests

- Keep all existing tests green (they protect the voice path).
- Add `test/componentHost.test.ts`: register a fake component, assert the host calls `startSession/pause/resume/stop/flush` on it, aggregates its status, and folds it into the report.
- Add `test/aggregateState.test.ts`: two fake components; when one buffers, station → OFFLINE_BUFFERING; when both drain, → RECORDING.
- Add a test that the voice path still produces the same `/status` voice fields (back-compat).

---

## 9. Acceptance

1. `npm test` green (old + new).
2. The full J1 voice demo still runs unchanged in mock mode.
3. `GET /status` now has `components: [{ id: "voice", … }]`.
4. Dashboard shows a voice component card; layout has room for more.
5. `ENABLED_COMPONENTS=voice,video` boots with a dormant video stub card; `=voice` boots without it; an unknown name errors clearly.
6. `docs/COMPONENTS.md` explains how to add a component.
7. No secrets committed. Mock-first intact.

---

## 10. Close the loop

Update `diary.md` (the architectural decision and why the component boundary sits where it does), append to `project.md`, set `job.md` to the next job (J4: real ApresMeet ingest receiver on the apm side; or J5: implement VideoComponent for real). Commit: `[pi-station] generic multi-component platform — voice as first component`, push.

---

## Guardrails

- **Do not over-engineer.** The interface should fit voice cleanly and leave an obvious seam for video. If a method exists only for a hypothetical future component, drop it.
- **Do not break mock-first or the demo.** Every intermediate state should still run.
- **Keep voice logic byte-for-byte behaviourally identical** — this is a move/wrap refactor, not a rewrite.
- The host owns the network-resilience guarantee; components just expose "am I buffering / how many queued." Don't scatter reconnection logic across components.
