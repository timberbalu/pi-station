import type { Logger } from 'pino';

import type { AudioEnergyEvent, StationEventBus } from '@pi-station/core';
import type { FaceBox, PanTiltController } from '@pi-station/hardware';

interface SpeakerTrackerConfig {
  frameWidth: number;
  frameHeight: number;
  neutralPan: number;
  neutralTilt: number;
  deadzonePx: number;
  /** Low-pass filter coefficient. 0 = instant snap, 1 = no movement. */
  smoothing: number;
  /** Silence duration (ms) before releasing face lock. */
  silenceReleaseMs: number;
  /** Pan scale factor: degrees-per-pixel error. */
  panScale: number;
  /** Tilt scale factor: degrees-per-pixel error. */
  tiltScale: number;
  panMin: number;
  panMax: number;
  tiltMin: number;
  tiltMax: number;
}

/**
 * SpeakerTracker — voice-face lock orchestration.
 *
 * Algorithm:
 * 1. VAD: subscribe to audio_energy events on the EventBus
 * 2. On speech start: lock to the face nearest frame centre
 * 3. While locked: smooth-track that face's bounding box centre
 * 4. On 2s silence: release lock, return to neutral
 * 5. If locked face leaves frame: release lock
 *
 * VoiceComponent and VideoComponent communicate only via the EventBus —
 * no direct coupling between them.
 */
export class SpeakerTracker {
  private lockedFaceId: number | null = null;
  private currentPan: number;
  private currentTilt: number;
  private speechActive = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFaces: FaceBox[] = [];
  private running = false;

  constructor(
    private readonly bus: StationEventBus,
    private readonly controller: PanTiltController,
    private readonly cfg: SpeakerTrackerConfig,
    private readonly log?: Logger,
  ) {
    this.currentPan = cfg.neutralPan;
    this.currentTilt = cfg.neutralTilt;
  }

  start(): void {
    this.running = true;

    this.bus.onAudioEnergy((event: AudioEnergyEvent) => {
      if (!this.running) {
        return;
      }
      this.handleAudioEnergy(event);
    });
  }

  /** Called by VideoComponent on each face-detection frame. */
  handleFaces(faces: FaceBox[]): void {
    if (!this.running) {
      return;
    }

    this.lastFaces = faces;

    if (this.lockedFaceId === null) {
      return;
    }

    // Find the locked face in the current frame (by closest position to last known position)
    const locked = this.findLockedFace(faces);

    if (!locked) {
      // Face left the frame — release lock
      this.log?.debug('[tracker] locked face left frame, releasing');
      this.lockedFaceId = null;
      void this.controller.returnToNeutral();
      return;
    }

    void this.trackFace(locked);
  }

  async shutdown(): Promise<void> {
    this.running = false;
    this.clearSilenceTimer();
    this.lockedFaceId = null;
    await this.controller.returnToNeutral();
  }

  getTrackingStatus(): { speechActive: boolean; lockedFace: number | null; pan: number; tilt: number } {
    return {
      speechActive: this.speechActive,
      lockedFace: this.lockedFaceId,
      pan: this.currentPan,
      tilt: this.currentTilt,
    };
  }

  private handleAudioEnergy(event: AudioEnergyEvent): void {
    if (event.speechActive && !this.speechActive) {
      // Speech started
      this.speechActive = true;
      this.clearSilenceTimer();
      if (this.lockedFaceId === null && this.lastFaces.length > 0) {
        this.lockToNearestFace();
      }
    } else if (!event.speechActive && this.speechActive) {
      // Start silence countdown
      this.startSilenceTimer();
    } else if (event.speechActive) {
      // Still speaking — reset silence timer if it was ticking
      this.clearSilenceTimer();
    }
  }

  private lockToNearestFace(): void {
    const centre = { x: this.cfg.frameWidth / 2, y: this.cfg.frameHeight / 2 };
    let nearest: FaceBox | null = null;
    let minDist = Infinity;

    for (const face of this.lastFaces) {
      const faceCentreX = face.x + face.width / 2;
      const faceCentreY = face.y + face.height / 2;
      const dist = Math.hypot(faceCentreX - centre.x, faceCentreY - centre.y);
      if (dist < minDist) {
        minDist = dist;
        nearest = face;
      }
    }

    if (nearest) {
      this.lockedFaceId = nearest.timestampMs;
      this.log?.debug({ faceCentre: { x: nearest.x + nearest.width / 2, y: nearest.y + nearest.height / 2 } }, '[tracker] locked to nearest face');
      void this.trackFace(nearest);
    }
  }

  private findLockedFace(faces: FaceBox[]): FaceBox | null {
    if (faces.length === 0) {
      return null;
    }

    // Find the face that was last known to be locked (nearest to last tracked position)
    const { pan: lastPan, tilt: lastTilt } = this.controller.getPosition();
    let nearest: FaceBox | null = null;
    let minDist = Infinity;

    for (const face of faces) {
      const faceCentreX = face.x + face.width / 2;
      const faceCentreY = face.y + face.height / 2;

      // Convert face position to pan/tilt degrees for comparison
      const errorX = faceCentreX - this.cfg.frameWidth / 2;
      const errorY = faceCentreY - this.cfg.frameHeight / 2;
      const targetPan = this.cfg.neutralPan + errorX * this.cfg.panScale;
      const targetTilt = this.cfg.neutralTilt - errorY * this.cfg.tiltScale;
      const dist = Math.hypot(targetPan - lastPan, targetTilt - lastTilt);

      if (dist < minDist) {
        minDist = dist;
        nearest = face;
      }
    }

    // Only consider it the same face if it hasn't jumped too far
    if (minDist > 30) {
      return null;
    }

    return nearest;
  }

  private async trackFace(face: FaceBox): Promise<void> {
    const faceCentreX = face.x + face.width / 2;
    const faceCentreY = face.y + face.height / 2;

    const errorX = faceCentreX - this.cfg.frameWidth / 2;
    const errorY = faceCentreY - this.cfg.frameHeight / 2;

    // Skip if within deadzone
    if (Math.abs(errorX) <= this.cfg.deadzonePx && Math.abs(errorY) <= this.cfg.deadzonePx) {
      return;
    }

    const targetPan = this.cfg.neutralPan + errorX * this.cfg.panScale;
    const targetTilt = this.cfg.neutralTilt - errorY * this.cfg.tiltScale;

    // Low-pass filter: new = current + smoothing * (target - current)
    // smoothing = 1 - cfg.smoothing (cfg.smoothing=0 → instant, cfg.smoothing=1 → no movement)
    const alpha = 1 - this.cfg.smoothing;
    const newPan = this.currentPan + alpha * (targetPan - this.currentPan);
    const newTilt = this.currentTilt + alpha * (targetTilt - this.currentTilt);

    const clampedPan = Math.max(this.cfg.panMin, Math.min(this.cfg.panMax, newPan));
    const clampedTilt = Math.max(this.cfg.tiltMin, Math.min(this.cfg.tiltMax, newTilt));

    this.currentPan = clampedPan;
    this.currentTilt = clampedTilt;

    await this.controller.setPosition(clampedPan, clampedTilt);
  }

  private startSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this.speechActive = false;
      this.lockedFaceId = null;
      this.log?.debug('[tracker] silence timeout — releasing lock, returning to neutral');
      void this.controller.returnToNeutral();
    }, this.cfg.silenceReleaseMs);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }
}

export function buildSpeakerTrackerConfig(
  videoWidth: number,
  videoHeight: number,
  panMin: number,
  panMax: number,
  tiltMin: number,
  tiltMax: number,
  neutralPan: number,
  neutralTilt: number,
  deadzonePx: number,
  smoothing: number,
): SpeakerTrackerConfig {
  return {
    frameWidth: videoWidth,
    frameHeight: videoHeight,
    neutralPan,
    neutralTilt,
    deadzonePx,
    smoothing,
    silenceReleaseMs: 2000,
    // degrees-per-pixel: frame is ~90° FOV wide / 1280px → ~0.07 deg/px
    panScale: 0.07,
    tiltScale: 0.07,
    panMin,
    panMax,
    tiltMin,
    tiltMax,
  };
}
