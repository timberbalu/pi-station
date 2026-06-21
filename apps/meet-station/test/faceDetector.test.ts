import { describe, expect, it } from 'vitest';

import { MockFaceDetector } from '@pi-station/hardware';

describe('MockFaceDetector', () => {
  it('emits face boxes within frame bounds', async () => {
    const detector = new MockFaceDetector();
    const received: Parameters<Parameters<typeof detector.start>[0]>[0][] = [];

    await detector.start((faces) => {
      received.push(faces);
    });

    // Wait for at least one emission
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    await detector.stop();

    expect(received.length).toBeGreaterThanOrEqual(1);

    // All face boxes must be within 1280×720 frame bounds
    for (const faces of received) {
      for (const face of faces) {
        expect(face.x).toBeGreaterThanOrEqual(0);
        expect(face.y).toBeGreaterThanOrEqual(0);
        expect(face.x + face.width).toBeLessThanOrEqual(1280);
        expect(face.y + face.height).toBeLessThanOrEqual(720);
        expect(face.confidence).toBeGreaterThan(0);
        expect(face.confidence).toBeLessThanOrEqual(1);
        expect(face.timestampMs).toBeGreaterThan(0);
        expect(face.width).toBeGreaterThan(0);
        expect(face.height).toBeGreaterThan(0);
      }
    }
  });

  it('stops cleanly without throwing', async () => {
    const detector = new MockFaceDetector();
    await detector.start(() => undefined);
    await expect(detector.stop()).resolves.toBeUndefined();
  });

  it('stop() before start() does not throw', async () => {
    const detector = new MockFaceDetector();
    await expect(detector.stop()).resolves.toBeUndefined();
  });
});
