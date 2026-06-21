import type { ComponentContext, ComponentReportSection, ComponentStatus, StationComponent } from '../StationComponent.js';
import type { CaptureService } from '../../capture/CaptureService.js';
import type { RelayService } from '../../relay/RelayService.js';
import type { SessionSummary } from '../../types.js';

/**
 * VoiceComponent — mic capture → STT → transcript segments → relay.
 * Wraps CaptureService + RelayService; exposes the StationComponent contract to the host.
 */
export class VoiceComponent implements StationComponent {
  readonly id = 'voice';
  readonly label = 'Voice';

  private onReconcile: (() => void) | null = null;

  constructor(
    private readonly capture: CaptureService,
    private readonly relay: RelayService,
  ) {}

  async init(ctx: ComponentContext): Promise<void> {
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
    await this.relay.flushOnce();
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
