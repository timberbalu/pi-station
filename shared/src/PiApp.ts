import type Database from 'better-sqlite3';
import type { Logger } from 'pino';

import type { PlatformConfig } from './PlatformConfig.js';

export interface PiAppContext {
  readonly config: PlatformConfig;
  readonly db: Database.Database;
  readonly logger: Logger;
  readonly dataDir: string;
}

export interface PiAppStatus {
  readonly id: string;
  readonly label: string;
  readonly healthy: boolean;
  readonly buffering: boolean;
  readonly queuedItems: number;
  readonly detail: Record<string, unknown>;
}

export interface PiApp {
  readonly id: string;
  readonly label: string;

  init(ctx: PiAppContext): Promise<void>;
  start(sessionId: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  flush(): Promise<void>;
  getStatus(): PiAppStatus;
  shutdown(): Promise<void>;
}
