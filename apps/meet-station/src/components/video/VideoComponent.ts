import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { Logger } from 'pino';

import { nowIso } from '../../types.js';
import type { SessionSummary } from '../../types.js';
import type { ComponentContext, ComponentReportSection, ComponentStatus, StationComponent } from '../StationComponent.js';
import type { VideoChunk, VideoSource } from './VideoSource.js';
import { MockVideoSource } from './MockVideoSource.js';
import { LibcameraVideoSource } from './LibcameraVideoSource.js';
import type { FaceBox } from '@pi-station/hardware';
import { MockFaceDetector, HailoFaceDetector, ConsolePanTiltController, PCA9685PanTiltController } from '@pi-station/hardware';
import type { FaceDetector, PanTiltController } from '@pi-station/hardware';
import { SpeakerTracker, buildSpeakerTrackerConfig } from './SpeakerTracker.js';

interface VideoChunkRecord {
  chunkIndex: number;
  path: string;
  startMs: number;
  durationMs: number;
  sizeBytes: number;
  queuedForSync: boolean;
}

/**
 * VideoComponent — replaces the J3 stub.
 * Captures rolling MP4 chunks via libcamera or mock source.
 * Runs AI HAT+ face detection and drives pan/tilt servos to track the speaker.
 * Enqueues video chunks in media_transfer_queue for SyncService (J3b phase 3).
 */
export class VideoComponent implements StationComponent {
  readonly id = 'video';
  readonly label = 'Video';

  private ctx: ComponentContext | null = null;
  private session: SessionSummary | null = null;
  private log: Logger | null = null;

  private videoSource: VideoSource | null = null;
  private faceDetector: FaceDetector | null = null;
  private panTiltController: PanTiltController | null = null;
  private speakerTracker: SpeakerTracker | null = null;

  private chunks: VideoChunkRecord[] = [];
  private healthy = true;
  private errorMessage: string | null = null;
  private sessionDir = '';

  async init(ctx: ComponentContext): Promise<void> {
    this.ctx = ctx;
    this.log = ctx.logger;

    const cfg = ctx.config;

    // Build VideoSource
    if (cfg.video.videoSource === 'libcamera') {
      this.videoSource = new LibcameraVideoSource(
        cfg.video.videoWidth,
        cfg.video.videoHeight,
        cfg.video.videoFps,
        cfg.video.videoBitrate,
        cfg.video.videoChunkSeconds,
        ctx.logger,
      );
    } else {
      this.videoSource = new MockVideoSource();
    }

    // Build FaceDetector
    if (cfg.faceDetection.provider === 'hailo') {
      this.faceDetector = new HailoFaceDetector(
        cfg.faceDetection.hailoPostProcessFile,
        ctx.logger,
        new MockFaceDetector(),
      );
    } else {
      this.faceDetector = new MockFaceDetector();
    }

    // Build PanTiltController
    const consoleFallback = new ConsolePanTiltController(
      cfg.panTilt.neutralPan,
      cfg.panTilt.neutralTilt,
      ctx.logger,
    );

    if (cfg.panTilt.controller === 'pca9685') {
      this.panTiltController = new PCA9685PanTiltController(
        cfg.panTilt.i2cBus,
        cfg.panTilt.i2cAddress,
        cfg.panTilt.panChannel,
        cfg.panTilt.tiltChannel,
        cfg.panTilt.panMin,
        cfg.panTilt.panMax,
        cfg.panTilt.tiltMin,
        cfg.panTilt.tiltMax,
        cfg.panTilt.neutralPan,
        cfg.panTilt.neutralTilt,
        ctx.logger,
        consoleFallback,
      );
    } else {
      this.panTiltController = consoleFallback;
    }

    await this.panTiltController.init();

    // Build SpeakerTracker
    const trackerCfg = buildSpeakerTrackerConfig(
      cfg.video.videoWidth,
      cfg.video.videoHeight,
      cfg.panTilt.panMin,
      cfg.panTilt.panMax,
      cfg.panTilt.tiltMin,
      cfg.panTilt.tiltMax,
      cfg.panTilt.neutralPan,
      cfg.panTilt.neutralTilt,
      cfg.panTilt.deadzonePx,
      cfg.panTilt.smoothing,
    );

    this.speakerTracker = new SpeakerTracker(ctx.bus, this.panTiltController, trackerCfg, ctx.logger);
    this.speakerTracker.start();

    this.log.info({ source: cfg.video.videoSource, detector: cfg.faceDetection.provider, pantilt: cfg.panTilt.controller }, '[video] initialised');
  }

  async startSession(session: SessionSummary): Promise<void> {
    this.session = session;
    this.chunks = [];
    this.healthy = true;
    this.errorMessage = null;

    const cfg = this.ctx!.config;
    this.sessionDir = join(cfg.video.videoDir, session.sessionId);
    mkdirSync(join(this.sessionDir, 'video'), { recursive: true });
    mkdirSync(join(cfg.video.facesDir, session.sessionId, 'faces'), { recursive: true });

    if (!this.videoSource) {
      return;
    }

    try {
      await this.videoSource.start(this.sessionDir, (chunk) => {
        void this.handleNewChunk(chunk);
      });

      await this.faceDetector?.start((faces) => {
        this.handleFaces(faces);
      });

      this.log?.info({ sessionId: session.sessionId }, '[video] capture started');
    } catch (err) {
      this.healthy = false;
      this.errorMessage = err instanceof Error ? err.message : 'Unknown error starting video';
      this.log?.error({ err }, '[video] failed to start capture — continuing without video');
    }
  }

  async pause(): Promise<void> {
    await this.videoSource?.stop();
    await this.faceDetector?.stop();
  }

  async resume(): Promise<void> {
    if (!this.session || !this.videoSource) {
      return;
    }

    try {
      await this.videoSource.start(this.sessionDir, (chunk) => {
        void this.handleNewChunk(chunk);
      });
      await this.faceDetector?.start((faces) => {
        this.handleFaces(faces);
      });
    } catch (err) {
      this.log?.error({ err }, '[video] failed to resume capture');
    }
  }

  async stopSession(): Promise<void> {
    await this.videoSource?.stop();
    await this.faceDetector?.stop();
    this.log?.info({ chunks: this.chunks.length }, '[video] capture stopped');
  }

  async flush(): Promise<void> {
    // Nothing to flush — SyncService picks up from media_transfer_queue directly
  }

  getStatus(): ComponentStatus {
    const pos = this.panTiltController?.getPosition() ?? { pan: 90, tilt: 90 };
    const tracking = this.speakerTracker?.getTrackingStatus() ?? null;

    return {
      id: this.id,
      label: this.label,
      healthy: this.healthy,
      buffering: false,
      queuedItems: this.chunks.filter((c) => !c.queuedForSync).length,
      detail: {
        source: this.ctx?.config.video.videoSource ?? 'none',
        running: this.videoSource?.isRunning() ?? false,
        chunks: this.chunks.length,
        detector: this.ctx?.config.faceDetection.provider ?? 'none',
        panTilt: {
          controller: this.ctx?.config.panTilt.controller ?? 'none',
          pan: pos.pan,
          tilt: pos.tilt,
        },
        tracking: tracking
          ? { speechActive: tracking.speechActive, lockedFace: tracking.lockedFace !== null }
          : null,
        error: this.errorMessage,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  contributeToReport(_session: SessionSummary): ComponentReportSection {
    const totalBytes = this.chunks.reduce((sum, c) => sum + c.sizeBytes, 0);
    const totalMb = (totalBytes / 1024 / 1024).toFixed(1);

    return {
      id: this.id,
      label: this.label,
      summary: this.chunks.length > 0
        ? `${this.chunks.length} video chunk${this.chunks.length !== 1 ? 's' : ''} captured (${totalMb} MB)`
        : 'No video captured',
      items: this.chunks.map((c) => ({
        chunk_index: c.chunkIndex,
        path: c.path,
        start_ms: c.startMs,
        duration_ms: c.durationMs,
        size_bytes: c.sizeBytes,
      })),
      health: {
        chunks_captured: this.chunks.length,
        chunks_queued_for_sync: this.chunks.filter((c) => c.queuedForSync).length,
        bytes_captured: totalBytes,
      },
    };
  }

  async shutdown(): Promise<void> {
    await this.videoSource?.stop();
    await this.faceDetector?.stop();
    await this.speakerTracker?.shutdown();
    await this.panTiltController?.shutdown();
  }

  private async handleNewChunk(chunk: VideoChunk): Promise<void> {
    if (!this.ctx || !this.session) {
      return;
    }

    const { repositories } = this.ctx;
    const sessionId = this.session.sessionId;
    const now = nowIso();

    const record: VideoChunkRecord = {
      chunkIndex: chunk.chunkIndex,
      path: chunk.path,
      startMs: chunk.startMs,
      durationMs: chunk.durationMs,
      sizeBytes: chunk.sizeBytes,
      queuedForSync: false,
    };

    this.chunks.push(record);

    // Enqueue in media_transfer_queue for SyncService phase 3
    const s3Key = `vi-media/sessions/${sessionId}/video/chunk-${String(chunk.chunkIndex).padStart(4, '0')}.mp4`;
    const enqueued = repositories.mediaTransfer.enqueue({
      id: randomUUID(),
      sessionId,
      mediaType: 'video',
      filePath: chunk.path,
      s3Key,
      chunkIndex: chunk.chunkIndex,
      fileSize: chunk.sizeBytes,
      s3UploadId: null,
      partsJson: '[]',
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });

    if (enqueued) {
      record.queuedForSync = true;
      this.log?.debug({ chunkIndex: chunk.chunkIndex, s3Key }, '[video] chunk queued for sync');
    }
  }

  private handleFaces(faces: FaceBox[]): void {
    if (!this.session || !this.ctx) {
      return;
    }

    this.speakerTracker?.handleFaces(faces);

    // Persist face data per chunk for report annotation
    if (faces.length > 0 && this.chunks.length > 0) {
      const lastChunk = this.chunks[this.chunks.length - 1];
      if (lastChunk) {
        const facesDir = join(this.ctx.config.video.facesDir, this.session.sessionId, 'faces');
        const facesFile = join(facesDir, `${lastChunk.chunkIndex}-faces.json`);
        try {
          mkdirSync(facesDir, { recursive: true });
          writeFileSync(facesFile, JSON.stringify({ timestampMs: Date.now(), faces }, null, 2));
        } catch {
          // Non-critical — continue without persisting face data
        }
      }
    }
  }
}
