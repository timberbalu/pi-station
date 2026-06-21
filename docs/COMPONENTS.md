# Station Components

MeetPaper Station is a **platform host** that runs one or more independent *components*. Each component is a self-contained capture concern with its own source, its own local buffer, its own optional cloud relay, and its own contribution to the session status and report.

```
Station Host (session, network, DB, API, dashboard, state machine)
 ├── VoiceComponent   mic → STT → transcript segments → relay        ← J1, active
 ├── VideoComponent   camera → frames/clips → relay                  ← J6, stub only
 └── …future          presence, sensor, eOCR, …
```

---

## Architecture

The host owns:
- Device identity and station-wide config
- The SQLite database and all repositories
- The `StationStateMachine` (IDLE → RECORDING → OFFLINE_BUFFERING → …)
- Session lifecycle (pair / start / pause / resume / stop)
- The Fastify API server and the dashboard
- Network-resilience guarantee: any component that is `buffering` drives the station into `OFFLINE_BUFFERING`

Components own:
- Their capture source (mic, camera, sensor, …)
- Their local buffer
- Their cloud relay / flush logic
- Their contribution to the session report

---

## The StationComponent interface

```ts
interface StationComponent {
  readonly id: string;         // unique slug, e.g. "voice"
  readonly label: string;      // human label for the dashboard

  init(ctx: ComponentContext): Promise<void>;
  startSession(session: SessionSummary): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stopSession(): Promise<void>;
  flush(): Promise<void>;      // drain local buffer → cloud; called on network restore
  getStatus(): ComponentStatus;
  contributeToReport(session: SessionSummary): ComponentReportSection;
  shutdown(): Promise<void>;
}
```

`ComponentContext` provides: `config`, `repositories`, `bus`, `logger`, `dataDir`.

`ComponentStatus` exposes: `id`, `label`, `healthy`, `buffering`, `queuedItems`, `detail`.
The host aggregates `buffering` across all components to drive the state machine.

---

## How to add a new component

1. **Create the class** in `apps/meet-station/src/components/<name>/<Name>Component.ts` implementing `StationComponent`.

2. **Register it** in `apps/meet-station/src/components/registry.ts`:
   ```ts
   if (id === 'myname') {
     components.push(new MyNameComponent());
     continue;
   }
   ```
   Add `'myname'` to `KNOWN_COMPONENT_IDS`.

3. **Enable it** via env:
   ```
   ENABLED_COMPONENTS=voice,myname
   ```

4. **Write tests** — at minimum: assert `getStatus()` shape, and that all lifecycle methods resolve without throwing. Use `test/componentHost.test.ts` as a pattern.

5. **Update the dashboard** if the component exposes interesting `detail` fields worth surfacing in the components row.

---

## Existing components

| ID      | Status          | Description                              |
|---------|-----------------|------------------------------------------|
| `voice` | Active (J1)     | Mic → ElevenLabs/Mock STT → relay        |
| `video` | Stub (J6)       | Camera placeholder — no capture yet      |

---

## OFFLINE_BUFFERING and flush

The station-level `OFFLINE_BUFFERING` state fires whenever **any** registered component reports `buffering: true`, or when the station-level mock network flag is false (simulate mode).

When the host calls `flush()` on each component (e.g. on network restore), the component should attempt to drain its local queue to the cloud relay. The host re-runs `reconcileOperationalState()` after flush to decide whether to exit `OFFLINE_BUFFERING`.
