import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import type { Logger } from 'pino';

import type {
  ConnectivityProbe,
  HardwareController,
  PlatformConfig,
  Repositories,
  SyncService,
} from '@pi-station/core';
import { StationEventBus, StationStateMachine } from '@pi-station/core';
import { ReportGenerator } from './report/ReportGenerator.js';
import { createSessionDirs } from './SessionDirs.js';
import { SessionCleaner } from './SessionCleaner.js';
import type { CleanupResult } from './SessionCleaner.js';
import type { StationComponent } from './components/StationComponent.js';
import type { VoiceComponent } from './components/voice/VoiceComponent.js';
import { nowIso } from './types.js';
import type { IngestPayload, SessionReport, SessionSummary, StationStatusResponse } from './types.js';

export class MeetStationApp {
  readonly id = 'meet-station';
  readonly label = 'MeetStation';
  private currentSession: SessionSummary | null = null;
  private latestReport: SessionReport | null = null;
  private mockIngestAvailable: boolean;
  private mockIngestSegments: IngestPayload[] = [];

  constructor(
    private readonly config: PlatformConfig,
    private readonly db: Database.Database,
    private readonly repositories: Repositories,
    private readonly bus: StationEventBus,
    private readonly stateMachine: StationStateMachine,
    private readonly hardware: HardwareController,
    /** Ordered list of registered components. VoiceComponent must be first for back-compat status fields. */
    private readonly components: StationComponent[],
    private readonly reportGenerator: ReportGenerator,
    private readonly log: Logger,
    private readonly syncService?: SyncService,
    private readonly connectivityProbe?: ConnectivityProbe,
    private readonly sessionCleaner?: SessionCleaner,
  ) {
    this.mockIngestAvailable = config.relay.mockIngestAvailable;
  }

  async initialize(): Promise<void> {
    await this.hardware.init();
    await this.hardware.setState(this.stateMachine.getState());

    const ctx = {
      config: this.config,
      repositories: this.repositories,
      bus: this.bus,
      logger: this.log,
      dataDir: this.config.app.dataDir,
    };

    for (const component of this.components) {
      await component.init(ctx);
    }

    // VoiceComponent exposes setReconcileCallback so the host drives the state machine
    const voice = this.findVoiceComponent();
    if (voice) {
      voice.setReconcileCallback(() => this.reconcileOperationalState());
    }

    this.bus.onStateChanged((event) => {
      void this.hardware.setState(event.to);
      if (this.currentSession) {
        this.repositories.sessions.updateState(this.currentSession.sessionId, event.to, event.at);
      }
      // Probe the network only while we are buffering offline — a real signal for recovery.
      if (this.connectivityProbe) {
        if (event.to === 'OFFLINE_BUFFERING') {
          this.connectivityProbe.start();
        } else if (event.from === 'OFFLINE_BUFFERING') {
          this.connectivityProbe.stop();
        }
      }
    });

    // When the probe sees the network return, run a sync cycle for the live session.
    this.connectivityProbe?.onOnline(() => {
      void this.handleConnectivityOnline();
    });
  }

  private async handleConnectivityOnline(): Promise<void> {
    if (!this.currentSession || !this.syncService) {
      return;
    }
    await this.syncService.runSyncCycle(this.currentSession.sessionId);
    this.reconcileOperationalState();
  }

  async shutdown(): Promise<void> {
    this.connectivityProbe?.stop();
    for (const component of this.components) {
      await component.shutdown();
    }
    await this.hardware.shutdown();
    this.db.close();
  }

  async pair(sessionCode: string, title?: string): Promise<{ success: true; session_id: string; station_token: string }> {
    this.transition('PAIRING');
    this.emitEvent('pairing_started', 'info', `Pairing to session code ${sessionCode}`);

    const sessionId = `VI-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const stationToken = randomUUID();
    const sessionTitle = title?.trim() || 'Founder Fundraising Panel';
    const now = nowIso();

    const session: SessionSummary = {
      sessionId,
      sessionCode,
      title: sessionTitle,
      stationToken,
      ingestUrl: this.config.relay.ingestUrl,
      startedAt: null,
      stoppedAt: null,
    };

    this.repositories.sessions.create({
      id: sessionId,
      sessionCode,
      title: sessionTitle,
      state: 'READY',
      stationToken,
      ingestUrl: this.config.relay.ingestUrl,
      startedAt: null,
      stoppedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    this.currentSession = session;
    this.transition('READY');
    this.emitEvent('pairing_completed', 'info', `Paired session ${sessionId}`, { sessionCode });

    return { success: true, session_id: sessionId, station_token: stationToken };
  }

  async start(): Promise<void> {
    if (!this.currentSession) {
      throw new Error('Pair a session before starting');
    }

    if (!['READY', 'REPORT_READY'].includes(this.stateMachine.getState())) {
      throw new Error(`Cannot start from state ${this.stateMachine.getState()}`);
    }

    const startedAt = nowIso();
    this.currentSession.startedAt = startedAt;
    this.currentSession.stoppedAt = null;
    this.repositories.sessions.markStarted(this.currentSession.sessionId, startedAt, startedAt);

    // Create session directory tree before fanning out to components
    try {
      createSessionDirs(this.currentSession.sessionId, this.config);
    } catch (err) {
      this.log.warn({ err }, 'createSessionDirs failed — components will create their own dirs');
    }

    for (const component of this.components) {
      await component.startSession(this.currentSession);
    }

    this.transition('RECORDING');
  }

  async pause(): Promise<void> {
    const state = this.stateMachine.getState();
    if (!['RECORDING', 'OFFLINE_BUFFERING', 'SYNCING'].includes(state)) {
      throw new Error(`Cannot pause from state ${state}`);
    }

    for (const component of this.components) {
      await component.pause();
    }
    this.transition('PAUSED');
    this.emitEvent('recording_paused', 'info', 'Recording paused');
  }

  async resume(): Promise<void> {
    if (this.stateMachine.getState() !== 'PAUSED') {
      throw new Error(`Cannot resume from state ${this.stateMachine.getState()}`);
    }

    for (const component of this.components) {
      await component.resume();
    }
    this.reconcileOperationalState();
    this.emitEvent('recording_resumed', 'info', 'Recording resumed');
  }

  async stop(): Promise<SessionReport> {
    if (!this.currentSession) {
      throw new Error('No active session to stop');
    }

    this.transition('STOPPING');

    for (const component of this.components) {
      await component.stopSession();
    }

    const stoppedAt = nowIso();
    this.currentSession.stoppedAt = stoppedAt;
    this.repositories.sessions.markStopped(
      this.currentSession.sessionId,
      stoppedAt,
      stoppedAt,
      'REPORT_READY',
    );

    // Best-effort full sync (manifest → segments → media → complete) before the report.
    if (this.syncService) {
      await this.syncService.syncOnStop(this.currentSession.sessionId);
    }

    this.latestReport = this.reportGenerator.generate(this.currentSession);
    this.emitEvent('report_generated', 'info', `Report generated for ${this.currentSession.sessionId}`);
    this.transition('REPORT_READY');
    return this.latestReport;
  }

  markInsight(note?: string): void {
    if (!this.currentSession?.startedAt) {
      throw new Error('Cannot mark insight without an active recording');
    }

    const elapsedMs = Date.now() - new Date(this.currentSession.startedAt).getTime();
    const beforeMs = Math.max(0, elapsedMs - 30000);
    const afterMs = elapsedMs + 30000;
    const excerpt = this.repositories.transcriptSegments
      .listWindow(this.currentSession.sessionId, beforeMs, afterMs)
      .map((segment) => `${segment.speakerLabel ?? 'Speaker'}: ${segment.text}`)
      .join(' ');

    this.repositories.insightMarks.insert({
      id: randomUUID(),
      sessionId: this.currentSession.sessionId,
      atMs: elapsedMs,
      beforeMs,
      afterMs,
      note: note?.trim() || null,
      transcriptExcerpt: excerpt || null,
      createdAt: nowIso(),
    });

    this.emitEvent('insight_marked', 'info', 'Insight mark stored', { atMs: elapsedMs });
  }

  async simulateNetworkDown(): Promise<void> {
    this.mockIngestAvailable = false;
    this.emitEvent('network_down_simulated', 'warn', 'Mock ingest set unavailable');
    this.reconcileOperationalState();
  }

  async simulateNetworkUp(): Promise<void> {
    this.mockIngestAvailable = true;
    this.emitEvent('network_up_simulated', 'info', 'Mock ingest restored');
    for (const component of this.components) {
      await component.flush();
    }
    if (this.syncService && this.currentSession) {
      await this.syncService.runSyncCycle(this.currentSession.sessionId);
    }
    this.reconcileOperationalState();
  }

  async simulateSttDrop(): Promise<void> {
    const voice = this.findVoiceComponent();
    if (voice) {
      await voice.getCaptureService().setTranscriptConnectionForSimulation(false);
    }
    this.reconcileOperationalState();
  }

  async simulateSttReconnect(): Promise<void> {
    const voice = this.findVoiceComponent();
    if (voice) {
      await voice.getCaptureService().setTranscriptConnectionForSimulation(true);
    }
    this.reconcileOperationalState();
  }

  getStatus(): StationStatusResponse {
    const voice = this.findVoiceComponent();
    const captureStatus = voice ? voice.getCaptureService().getStatus() : null;
    const relayStatus = voice ? voice.getRelayService().getStatus() : null;

    const elapsedMs = this.currentSession?.startedAt
      ? Date.now() - new Date(this.currentSession.startedAt).getTime()
      : 0;

    const componentStatuses = this.components.map((c) => {
      const s = c.getStatus();
      return {
        id: s.id,
        label: s.label,
        healthy: s.healthy,
        buffering: s.buffering,
        queued_items: s.queuedItems,
        detail: s.detail,
      };
    });

    return {
      station_id: this.config.app.stationId,
      station_name: this.config.app.stationName,
      version: this.config.app.version,
      state: this.stateMachine.getState(),
      session: {
        session_id: this.currentSession?.sessionId ?? null,
        session_code: this.currentSession?.sessionCode ?? null,
        title: this.currentSession?.title ?? null,
        started_at: this.currentSession?.startedAt ?? null,
        elapsed_ms: elapsedMs,
      },
      // back-compat fields populated from VoiceComponent — deprecated, read components[] instead
      recording: captureStatus?.recording ?? false,
      mic: {
        available: captureStatus ? (this.config.audio.source === 'mock' || captureStatus.recording) : false,
        source: captureStatus?.mic.source ?? 'none',
        device: captureStatus?.mic.device ?? 'none',
        sample_rate: captureStatus?.mic.sampleRate ?? 0,
        channels: captureStatus?.mic.channels ?? 0,
        level_db: captureStatus?.mic.levelDb ?? null,
      },
      stt: {
        provider: captureStatus?.stt.provider ?? 'none',
        connected: captureStatus?.stt.connected ?? false,
        last_partial_at: captureStatus?.stt.lastPartialAt ?? null,
        last_commit_at: captureStatus?.stt.lastCommitAt ?? null,
        committed_segments: captureStatus?.stt.committedSegments ?? 0,
        current_partial: captureStatus?.stt.currentPartial ?? null,
        batch_transcription: voice?.getBatchTranscriptionStatus() ?? {
          available: false,
          model: '',
          status: 'idle',
        },
      },
      relay: {
        ingest_url: relayStatus?.ingestUrl ?? this.config.relay.ingestUrl,
        connected: (relayStatus?.connected ?? false) && this.mockIngestAvailable,
        queued_segments: relayStatus?.queuedSegments ?? 0,
        sent_segments: relayStatus?.sentSegments ?? 0,
        dead_segments: relayStatus?.deadSegments ?? 0,
        last_flush_at: relayStatus?.lastFlushAt ?? null,
        last_error: relayStatus?.lastError ?? null,
      },
      buffer: {
        audio_chunks: captureStatus?.buffer.audioChunks ?? 0,
        seconds_safe: captureStatus?.buffer.secondsSafe ?? 0,
        bytes: captureStatus?.buffer.bytes ?? 0,
        current_chunk_path: captureStatus?.buffer.currentChunkPath ?? null,
      },
      hardware: {
        enabled: this.config.hardware.enableGpio,
        controller: this.hardware.name,
        last_state: this.hardware.getLastState(),
      },
      components: componentStatuses,
      sync: this.syncService?.getSyncStatus(this.currentSession?.sessionId ?? null) ?? null,
      last_events: this.repositories.sessionEvents.listRecent(10),
    };
  }

  getTranscript() {
    return this.currentSession
      ? this.repositories.transcriptSegments.listBySession(this.currentSession.sessionId)
      : [];
  }

  getReport(sessionId: string): SessionReport | null {
    if (this.latestReport?.session_id === sessionId) {
      return this.latestReport;
    }

    const session = this.repositories.sessions.getById(sessionId);
    if (!session) {
      return null;
    }

    return this.reportGenerator.generate({
      sessionId: session.id,
      sessionCode: session.sessionCode,
      title: session.title,
      stationToken: session.stationToken,
      ingestUrl: session.ingestUrl,
      startedAt: session.startedAt,
      stoppedAt: session.stoppedAt,
    });
  }

  getEvents(limit: number) {
    return this.repositories.sessionEvents.listRecent(limit);
  }

  isMockIngestAvailable(): boolean {
    return this.mockIngestAvailable;
  }

  recordMockIngest(payload: IngestPayload): void {
    this.mockIngestSegments.push(payload);
  }

  getMockIngestSegments(): IngestPayload[] {
    return [...this.mockIngestSegments];
  }

  async cleanSession(sessionId: string): Promise<CleanupResult> {
    if (!this.sessionCleaner) {
      throw new Error('SessionCleaner not configured');
    }
    return this.sessionCleaner.clean(sessionId);
  }

  private findVoiceComponent(): VoiceComponent | null {
    const voice = this.components.find((c) => c.id === 'voice');
    if (!voice) {
      return null;
    }
    // Dynamic import of VoiceComponent for instanceof check avoided — use duck-typing
    return voice as VoiceComponent;
  }

  private transition(next: Parameters<StationStateMachine['transition']>[0]): void {
    this.stateMachine.transition(next);
  }

  private emitEvent(type: string, level: 'info' | 'warn' | 'error', message: string, payload?: Record<string, unknown>): void {
    this.bus.emitSessionEvent({
      sessionId: this.currentSession?.sessionId ?? null,
      type,
      level,
      message,
      ...(payload ? { payload } : {}),
    });
  }

  private reconcileOperationalState(): void {
    const state = this.stateMachine.getState();

    if (['PAUSED', 'STOPPING', 'REPORT_READY', 'IDLE', 'PAIRING', 'READY'].includes(state)) {
      return;
    }

    const anyBuffering = this.components.some((c) => c.getStatus().buffering) || !this.mockIngestAvailable;

    if (anyBuffering) {
      if (state === 'RECORDING') {
        this.transition('OFFLINE_BUFFERING');
      } else if (state === 'SYNCING') {
        this.transition('OFFLINE_BUFFERING');
      }
      return;
    }

    if (state === 'OFFLINE_BUFFERING') {
      this.transition('SYNCING');
      return;
    }

    if (state === 'SYNCING') {
      this.transition('RECORDING');
    }
  }
}
