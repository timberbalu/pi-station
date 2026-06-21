import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import type { Logger } from 'pino';

import type { HardwareController, PlatformConfig, Repositories } from '@pi-station/core';
import { ReportGenerator } from './report/ReportGenerator.js';
import { RelayService } from './relay/RelayService.js';
import { CaptureService } from './capture/CaptureService.js';
import { StationEventBus, StationStateMachine } from '@pi-station/core';
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
    private readonly capture: CaptureService,
    private readonly relay: RelayService,
    private readonly reportGenerator: ReportGenerator,
    _log: Logger,
  ) {
    this.mockIngestAvailable = config.relay.mockIngestAvailable;
  }

  async initialize(): Promise<void> {
    await this.hardware.init();
    await this.hardware.setState(this.stateMachine.getState());
    await this.capture.prepare();
    this.capture.onCommittedSegment(async (commit) => {
      await this.relay.handleCommittedSegment(commit);
      this.reconcileOperationalState();
    });
    this.bus.onStateChanged((event) => {
      void this.hardware.setState(event.to);
      if (this.currentSession) {
        this.repositories.sessions.updateState(this.currentSession.sessionId, event.to, event.at);
      }
    });
    this.bus.onSessionEvent((event) => {
      if (event.type === 'stt_connected' || event.type === 'stt_disconnected') {
        this.reconcileOperationalState();
      }
    });
    this.bus.onTranscriptPartial(() => {
      this.reconcileOperationalState();
    });
    this.relay.start();
  }

  async shutdown(): Promise<void> {
    await this.capture.stop();
    this.relay.stop();
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

    const session = {
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
    this.relay.setSession(session);
    this.transition('READY');
    this.emitEvent('pairing_completed', 'info', `Paired session ${sessionId}`, { sessionCode });

    return {
      success: true,
      session_id: sessionId,
      station_token: stationToken,
    };
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
    await this.capture.start(this.currentSession);
    this.transition('RECORDING');
  }

  async pause(): Promise<void> {
    const state = this.stateMachine.getState();
    if (!['RECORDING', 'OFFLINE_BUFFERING', 'SYNCING'].includes(state)) {
      throw new Error(`Cannot pause from state ${state}`);
    }

    await this.capture.pause();
    this.transition('PAUSED');
    this.emitEvent('recording_paused', 'info', 'Recording paused');
  }

  async resume(): Promise<void> {
    if (this.stateMachine.getState() !== 'PAUSED') {
      throw new Error(`Cannot resume from state ${this.stateMachine.getState()}`);
    }

    await this.capture.resume();
    this.reconcileOperationalState();
    this.emitEvent('recording_resumed', 'info', 'Recording resumed');
  }

  async stop(): Promise<SessionReport> {
    if (!this.currentSession) {
      throw new Error('No active session to stop');
    }

    this.transition('STOPPING');
    await this.capture.stop();
    await this.relay.flushOnce();

    const stoppedAt = nowIso();
    this.currentSession.stoppedAt = stoppedAt;
    this.repositories.sessions.markStopped(
      this.currentSession.sessionId,
      stoppedAt,
      stoppedAt,
      'REPORT_READY',
    );

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
    const excerpt = this.repositories.transcriptSegments.listWindow(
      this.currentSession.sessionId,
      beforeMs,
      afterMs,
    ).map((segment) => `${segment.speakerLabel ?? 'Speaker'}: ${segment.text}`).join(' ');

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
    await this.relay.flushOnce();
    this.reconcileOperationalState();
  }

  async simulateSttDrop(): Promise<void> {
    await this.capture.setTranscriptConnectionForSimulation(false);
    this.reconcileOperationalState();
  }

  async simulateSttReconnect(): Promise<void> {
    await this.capture.setTranscriptConnectionForSimulation(true);
    this.reconcileOperationalState();
  }

  getStatus(): StationStatusResponse {
    const captureStatus = this.capture.getStatus();
    const relayStatus = this.relay.getStatus();
    const elapsedMs = this.currentSession?.startedAt
      ? Date.now() - new Date(this.currentSession.startedAt).getTime()
      : 0;

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
      recording: captureStatus.recording,
      mic: {
        available: captureStatus.mic.available,
        source: captureStatus.mic.source,
        device: captureStatus.mic.device,
        sample_rate: captureStatus.mic.sampleRate,
        channels: captureStatus.mic.channels,
        level_db: captureStatus.mic.levelDb,
      },
      stt: {
        provider: captureStatus.stt.provider,
        connected: captureStatus.stt.connected,
        last_partial_at: captureStatus.stt.lastPartialAt,
        last_commit_at: captureStatus.stt.lastCommitAt,
        committed_segments: captureStatus.stt.committedSegments,
        current_partial: captureStatus.stt.currentPartial,
      },
      relay: {
        ingest_url: relayStatus.ingestUrl,
        connected: relayStatus.connected && this.mockIngestAvailable,
        queued_segments: relayStatus.queuedSegments,
        sent_segments: relayStatus.sentSegments,
        dead_segments: relayStatus.deadSegments,
        last_flush_at: relayStatus.lastFlushAt,
        last_error: relayStatus.lastError,
      },
      buffer: {
        audio_chunks: captureStatus.buffer.audioChunks,
        seconds_safe: captureStatus.buffer.secondsSafe,
        bytes: captureStatus.buffer.bytes,
        current_chunk_path: captureStatus.buffer.currentChunkPath,
      },
      hardware: {
        enabled: this.config.hardware.enableGpio,
        controller: this.hardware.name,
        last_state: this.hardware.getLastState(),
      },
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

  private transition(next: Parameters<StationStateMachine['transition']>[0]): void {
    this.stateMachine.transition(next);
  }

  private emitEvent(type: string, level: 'info' | 'warn' | 'error', message: string, payload?: Record<string, unknown>): void {
    const event = {
      sessionId: this.currentSession?.sessionId ?? null,
      type,
      level,
      message,
      ...(payload ? { payload } : {}),
    };
    this.bus.emitSessionEvent(event);
  }

  private reconcileOperationalState(): void {
    const state = this.stateMachine.getState();
    const queued = this.relay.getQueuedCount();
    const recording = this.capture.isRecording();
    const sttConnected = this.capture.isTranscriptConnected();

    if (!recording || state === 'PAUSED' || state === 'STOPPING' || state === 'REPORT_READY') {
      return;
    }

    if (!sttConnected || queued > 0 || !this.mockIngestAvailable) {
      if (state === 'RECORDING') {
        this.transition('OFFLINE_BUFFERING');
      } else if (state === 'SYNCING' && queued > 0) {
        this.transition('OFFLINE_BUFFERING');
      }
      return;
    }

    if (state === 'OFFLINE_BUFFERING' && queued === 0 && sttConnected) {
      this.transition('SYNCING');
      return;
    }

    if (state === 'SYNCING' && queued === 0 && sttConnected) {
      this.transition('RECORDING');
    }
  }
}
