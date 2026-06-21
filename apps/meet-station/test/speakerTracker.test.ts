import { describe, expect, it, vi } from 'vitest';

import { StationEventBus } from '@pi-station/core';
import { ConsolePanTiltController } from '@pi-station/hardware';
import type { FaceBox } from '@pi-station/hardware';
import { SpeakerTracker, buildSpeakerTrackerConfig } from '../src/components/video/SpeakerTracker.js';

function makeTracker(bus: StationEventBus, controller: ConsolePanTiltController): SpeakerTracker {
  const cfg = buildSpeakerTrackerConfig(
    1280, 720,      // frame dimensions
    30, 150,        // pan min/max
    60, 120,        // tilt min/max
    90, 90,         // neutral pan/tilt
    20,             // deadzone
    0.3,            // smoothing
  );
  return new SpeakerTracker(bus, controller, cfg);
}

function makeFace(centreX: number, centreY: number): FaceBox {
  return {
    x: centreX - 60,
    y: centreY - 80,
    width: 120,
    height: 160,
    confidence: 0.92,
    timestampMs: Date.now(),
  };
}

describe('SpeakerTracker', () => {
  it('locks to nearest face when speech starts', async () => {
    const bus = new StationEventBus();
    const controller = new ConsolePanTiltController(90, 90);
    await controller.init();
    const tracker = makeTracker(bus, controller);
    tracker.start();

    // Feed a face at the right of centre
    const face = makeFace(800, 360);
    tracker.handleFaces([face]);

    // Emit a speech-active energy event
    bus.emitAudioEnergy({ levelDb: -20, speechActive: true });

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const status = tracker.getTrackingStatus();
    expect(status.speechActive).toBe(true);
    expect(status.lockedFace).not.toBeNull();

    await tracker.shutdown();
  });

  it('releases lock after silence timeout', async () => {
    vi.useFakeTimers();

    const bus = new StationEventBus();
    const controller = new ConsolePanTiltController(90, 90);
    await controller.init();

    const cfg = buildSpeakerTrackerConfig(1280, 720, 30, 150, 60, 120, 90, 90, 20, 0.3);
    const tracker = new SpeakerTracker(bus, controller, { ...cfg, silenceReleaseMs: 2000 });
    tracker.start();

    const face = makeFace(640, 360);
    tracker.handleFaces([face]);

    // Start speech
    bus.emitAudioEnergy({ levelDb: -20, speechActive: true });
    tracker.handleFaces([face]);

    // End speech
    bus.emitAudioEnergy({ levelDb: -60, speechActive: false });

    // Advance past the 2s silence window
    await vi.advanceTimersByTimeAsync(2100);

    const status = tracker.getTrackingStatus();
    expect(status.speechActive).toBe(false);
    expect(status.lockedFace).toBeNull();

    vi.useRealTimers();
    await tracker.shutdown();
  });

  it('does not move when face is within deadzone', async () => {
    const bus = new StationEventBus();
    const controller = new ConsolePanTiltController(90, 90);
    await controller.init();
    const tracker = makeTracker(bus, controller);
    tracker.start();

    // Face exactly at frame centre — within deadzone
    const centredFace = makeFace(640, 360);
    tracker.handleFaces([centredFace]);

    bus.emitAudioEnergy({ levelDb: -20, speechActive: true });
    tracker.handleFaces([centredFace]);

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // Position should remain at neutral (no movement needed)
    const pos = controller.getPosition();
    expect(pos.pan).toBe(90);
    expect(pos.tilt).toBe(90);

    await tracker.shutdown();
  });

  it('releases lock when face leaves the frame', async () => {
    const bus = new StationEventBus();
    const controller = new ConsolePanTiltController(90, 90);
    await controller.init();
    const tracker = makeTracker(bus, controller);
    tracker.start();

    const face = makeFace(640, 360);
    tracker.handleFaces([face]);
    bus.emitAudioEnergy({ levelDb: -20, speechActive: true });
    tracker.handleFaces([face]);

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // Face disappears
    tracker.handleFaces([]);

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const status = tracker.getTrackingStatus();
    expect(status.lockedFace).toBeNull();

    await tracker.shutdown();
  });

  it('shutdown resolves without throwing', async () => {
    const bus = new StationEventBus();
    const controller = new ConsolePanTiltController(90, 90);
    await controller.init();
    const tracker = makeTracker(bus, controller);
    tracker.start();
    await expect(tracker.shutdown()).resolves.toBeUndefined();
  });
});
