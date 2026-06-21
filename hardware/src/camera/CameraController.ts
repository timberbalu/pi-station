/**
 * CameraController — libcamera + AI HAT+ face detection.
 * Implementation lands in J6.
 */
export class CameraController {
  async init(): Promise<void> {}
  async startCapture(_outputPath: string): Promise<void> {}
  async stopCapture(): Promise<void> {}
  async shutdown(): Promise<void> {}
}
