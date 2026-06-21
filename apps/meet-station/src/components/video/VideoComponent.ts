import type { ComponentContext, ComponentReportSection, ComponentStatus, StationComponent } from '../StationComponent.js';
import type { SessionSummary } from '../../types.js';

/**
 * VideoComponent stub — not yet implemented (J6).
 * Demonstrates the component seam: registers, reports healthy, writes nothing.
 * Enable via ENABLED_COMPONENTS=voice,video.
 */
export class VideoComponent implements StationComponent {
  readonly id = 'video';
  readonly label = 'Video';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async init(_ctx: ComponentContext): Promise<void> {
    // Camera capture will be wired up in J6 (AI HAT+ + libcamera + pan/tilt)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async startSession(_session: SessionSummary): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async stopSession(): Promise<void> {}
  async flush(): Promise<void> {}

  getStatus(): ComponentStatus {
    return {
      id: this.id,
      label: this.label,
      healthy: true,
      buffering: false,
      queuedItems: 0,
      detail: { note: 'VideoComponent not yet implemented — J6' },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  contributeToReport(_session: SessionSummary): ComponentReportSection {
    return {
      id: this.id,
      label: this.label,
      summary: 'Video component — not yet implemented (J6)',
      items: [],
      health: {},
    };
  }

  async shutdown(): Promise<void> {}
}
