import type { Logger } from 'pino';
import type { PlatformConfig, Repositories, StationEventBus } from '@pi-station/core';
import type { SessionSummary } from '../types.js';

export interface ComponentContext {
  readonly config: PlatformConfig;
  readonly repositories: Repositories;
  readonly bus: StationEventBus;
  readonly logger: Logger;
  readonly dataDir: string;
}

export interface ComponentStatus {
  readonly id: string;
  readonly label: string;
  readonly healthy: boolean;
  /** true when capture is active but segments/data are queuing locally due to network/source issue */
  readonly buffering: boolean;
  readonly queuedItems: number;
  readonly detail: Record<string, unknown>;
}

export interface ComponentReportSection {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly items: unknown[];
  readonly health: Record<string, number>;
}

export interface StationComponent {
  readonly id: string;
  readonly label: string;

  init(ctx: ComponentContext): Promise<void>;
  startSession(session: SessionSummary): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stopSession(): Promise<void>;
  /** Attempt to drain local buffer to cloud. Called by host on network restore. */
  flush(): Promise<void>;
  getStatus(): ComponentStatus;
  contributeToReport(session: SessionSummary): ComponentReportSection;
  shutdown(): Promise<void>;
}
