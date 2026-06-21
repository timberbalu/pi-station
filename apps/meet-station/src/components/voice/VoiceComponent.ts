import { randomUUID } from 'node:crypto';

import type { ComponentContext, ComponentReportSection, ComponentStatus, StationComponent } from '../StationComponent.js';
import type { CaptureService } from '../../capture/CaptureService.js';
import type { RelayService } from '../../relay/RelayService.js';
import type { BatchTranscriber } from '../../capture/FasterWhisperProvider.js';
import type { BatchTranscriptionStatus, SessionSummary, TranscriptSegmentRecord } from '../../types.js';
import { nowIso } from '../../types.js';

/**
 * VoiceComponent — mic capture → STT → transcript segments → relay.
 * Wraps CaptureService + RelayService; exposes the StationComponent contract to the host.
 *
 * When STT_PROVIDER=faster-whisper, the live session captures audio only; the
 * transcript is produced post-session by a batch pass over the buffered WAV chunks.
 */
export class VoiceComponent implements StationComponent {
  readonly id = 'voice';
  readonly label = 'Voice';

  private onReconcile: (() => void) | null = null;
  private context: ComponentContext | null = null;
  private session: SessionSummary | null = null;
  private batchStatus: BatchTranscriptionStatus = 'idle';

  constructor(
    private readonly capture: CaptureService,
    private readonly relay: RelayService,
    private readonly whisperProvider?: BatchTranscriber,
  ) {}

  async init(ctx: ComponentContext): Promise<void> {
    this.context = ctx;
    await this.capture.prepare();
    this.relay.start();

    this.capture.onCommittedSegment(async (commit) => {
      await this.relay.handleCommittedSegment(commit);
      this.onReconcile?.();
    });

    ctx.bus.onSessionEvent((event) => {
      if (event.type === 'stt_connected' || event.type === 'stt_disconnected') {
        this.onReconcile?.();
      }
    });

    ctx.bus.onTranscriptPartial(() => {
      this.onReconcile?.();
    });
  }

  /** Host registers a callback so VoiceComponent can trigger state reconciliation. */
  setReconcileCallback(fn: () => void): void {
    this.onReconcile = fn;
  }

  async startSession(session: SessionSummary): Promise<void> {
    this.session = session;
    this.batchStatus = 'idle';
    this.relay.setSession(session);
    await this.capture.start(session);
  }

  async pause(): Promise<void> {
    await this.capture.pause();
  }

  async resume(): Promise<void> {
    await this.capture.resume();
    this.onReconcile?.();
  }

  async stopSession(): Promise<void> {
    await this.capture.stop();

    if (this.context?.config.stt.provider === 'faster-whisper' && this.whisperProvider) {
      await this.runBatchTranscription();
    }

    await this.relay.flushOnce();
  }

  /**
   * Post-session offline transcription. Runs faster-whisper over the closed WAV
   * chunks and persists segments exactly as if they had arrived live. Never throws:
   * on failure the session still completes with zero segments and the error logged.
   */
  private async runBatchTranscription(): Promise<void> {
    if (!this.context || !this.session || !this.whisperProvider) {
      return;
    }

    const { repositories, logger } = this.context;
    const sessionId = this.session.sessionId;

    const chunks = repositories.audioChunks
      .listBySession(sessionId)
      .filter((c) => c.status === 'closed' || c.status === 'repaired')
      .sort((a, b) => a.chunkIndex - b.chunkIndex);

    if (chunks.length === 0) {
      logger.warn({ sessionId }, '[voice] no closed chunks to transcribe');
      this.batchStatus = 'complete';
      return;
    }

    this.batchStatus = 'running';
    logger.info({ sessionId, chunks: chunks.length }, '[voice] batch transcribing via faster-whisper');

    const sessionStartMs = this.session.startedAt ? new Date(this.session.startedAt).getTime() : 0;

    try {
      const segments = await this.whisperProvider.transcribeSession(sessionId, chunks, sessionStartMs);
      let sequence = repositories.transcriptSegments.listBySession(sessionId).length;
      const now = nowIso();

      for (const seg of segments) {
        const record: TranscriptSegmentRecord = {
          id: randomUUID(),
          sessionId,
          sequence: sequence++,
          provider: 'faster-whisper',
          startMs: Math.round(seg.start * 1000),
          endMs: Math.round(seg.end * 1000),
          text: seg.text,
          speakerLabel: 'SPEAKER_0', // base.en has no diarisation
          languageCode: 'en',
          confidence: 0.9, // whisper gives no per-segment confidence
          raw: { start: seg.start, end: seg.end, words: seg.words },
          committedAt: now,
          createdAt: now,
        };
        repositories.transcriptSegments.insert(record);
      }

      this.batchStatus = 'complete';
      logger.info({ sessionId, segments: segments.length }, '[voice] batch transcription complete');
    } catch (error) {
      this.batchStatus = 'error';
      logger.error({ error, sessionId }, '[voice] batch transcription failed');
    }
  }

  /** Surfaced by the host into the /status stt section. */
  getBatchTranscriptionStatus(): { available: boolean; model: string; status: BatchTranscriptionStatus } {
    const provider = this.context?.config.stt.provider;
    return {
      available: provider === 'faster-whisper' && this.whisperProvider != null,
      model: this.context?.config.stt.fasterWhisperModel ?? '',
      status: this.batchStatus,
    };
  }

  async flush(): Promise<void> {
    await this.relay.flushOnce();
  }

  getStatus(): ComponentStatus {
    const captureStatus = this.capture.getStatus();
    const relayStatus = this.relay.getStatus();
    const queuedItems = this.relay.getQueuedCount();
    const sttConnected = this.capture.isTranscriptConnected();

    return {
      id: this.id,
      label: this.label,
      healthy: captureStatus.recording ? sttConnected && queuedItems === 0 : true,
      buffering: captureStatus.recording && (queuedItems > 0 || !sttConnected),
      queuedItems,
      detail: {
        recording: captureStatus.recording,
        mic: captureStatus.mic,
        stt: captureStatus.stt,
        relay: relayStatus,
        buffer: captureStatus.buffer,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  contributeToReport(_session: SessionSummary): ComponentReportSection {
    const relay = this.relay.getStatus();
    return {
      id: this.id,
      label: this.label,
      summary: `Voice capture complete`,
      items: [],
      health: {
        queued_segments_remaining: relay.queuedSegments,
        sent_segments: relay.sentSegments,
        dead_segments: relay.deadSegments,
      },
    };
  }

  async shutdown(): Promise<void> {
    await this.capture.stop();
    this.relay.stop();
  }

  /** Expose underlying services for back-compat status fields */
  getCaptureService(): CaptureService {
    return this.capture;
  }

  getRelayService(): RelayService {
    return this.relay;
  }
}
