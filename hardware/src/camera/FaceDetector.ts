import { spawn } from 'node:child_process';

import type { Logger } from 'pino';

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  timestampMs: number;
}

export interface FaceDetector {
  readonly name: string;
  start(onFaces: (faces: FaceBox[]) => void): Promise<void>;
  stop(): Promise<void>;
}

/**
 * MockFaceDetector — emits simulated face positions that drift slowly across
 * the frame on a timer. No camera or AI HAT+ needed.
 * Used when FACE_DETECTION=mock (default for dev/test).
 */
export class MockFaceDetector implements FaceDetector {
  readonly name = 'mock';

  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private driftX = 0;
  private driftY = 0;

  async start(onFaces: (faces: FaceBox[]) => void): Promise<void> {
    this.running = true;
    this.driftX = 640;
    this.driftY = 360;

    this.timer = setInterval(() => {
      if (!this.running) {
        return;
      }

      // Drift face position slowly across the 1280×720 frame
      this.driftX = Math.max(100, Math.min(1180, this.driftX + (Math.random() - 0.5) * 40));
      this.driftY = Math.max(60, Math.min(660, this.driftY + (Math.random() - 0.5) * 20));

      const faces: FaceBox[] = [
        {
          x: Math.round(this.driftX - 60),
          y: Math.round(this.driftY - 80),
          width: 120,
          height: 160,
          confidence: 0.92,
          timestampMs: Date.now(),
        },
      ];

      onFaces(faces);
    }, 100);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/**
 * HailoFaceDetector — runs rpicam-hello with the Hailo post-process pipeline.
 * The AI HAT+ (26 TOPS) performs face detection at 30fps with zero CPU overhead.
 * Falls back to MockFaceDetector if hailo-all is not installed or HAT+ not found.
 * Used when FACE_DETECTION=hailo on the Pi with AI HAT+.
 *
 * rpicam-hello outputs JSON frames to stdout when --verbose 0 is set:
 *   {"faces":[{"x":...,"y":...,"w":...,"h":...,"conf":...}]}
 */
export class HailoFaceDetector implements FaceDetector {
  readonly name = 'hailo';

  private proc: ReturnType<typeof spawn> | null = null;
  private running = false;

  constructor(
    private readonly postProcessFile: string,
    private readonly log: Logger,
    private readonly fallback: FaceDetector = new MockFaceDetector(),
  ) {}

  async start(onFaces: (faces: FaceBox[]) => void): Promise<void> {
    this.running = true;

    const args = [
      '-t', '0',
      '--post-process-file', this.postProcessFile,
      '--nopreview',
      '--verbose', '0',
    ];

    this.proc = spawn('rpicam-hello', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    this.proc.on('error', async (err) => {
      this.log.warn({ err }, '[face/hailo] rpicam-hello not available — using mock face detector');
      this.proc = null;
      await this.fallback.start(onFaces);
    });

    this.proc.on('exit', (code) => {
      if (this.running) {
        this.log.warn({ code }, '[face/hailo] rpicam-hello exited, switching to mock');
        void this.fallback.start(onFaces);
      }
    });

    let buffer = '';
    this.proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) {
          continue;
        }
        try {
          const parsed = JSON.parse(trimmed) as { faces?: Array<{ x: number; y: number; w: number; h: number; conf: number }> };
          if (Array.isArray(parsed.faces)) {
            const boxes: FaceBox[] = parsed.faces.map((f) => ({
              x: f.x,
              y: f.y,
              width: f.w,
              height: f.h,
              confidence: f.conf,
              timestampMs: Date.now(),
            }));
            onFaces(boxes);
          }
        } catch {
          // Non-JSON line from rpicam output — ignore
        }
      }
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.fallback.stop();
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }
}
