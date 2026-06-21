import type { Logger } from 'pino';

/** Injectable probe so tests can drive connectivity transitions deterministically. */
export type HealthCheck = () => Promise<boolean>;

export interface ConnectivityProbeDeps {
  healthUrl: string;
  intervalMs: number;
  timeoutMs: number;
  logger: Logger;
  healthCheck?: HealthCheck;
}

/**
 * Polls a health endpoint and emits transition events only — 'online' on the first
 * success after being offline (or unknown), 'offline' on the first failure after being
 * online. It does not fire repeatedly while connectivity is stable, so subscribers
 * (e.g. the host triggering a sync cycle) act exactly once per transition.
 */
export class ConnectivityProbe {
  private timer: NodeJS.Timeout | null = null;
  private lastOnline: boolean | null = null;
  private readonly onlineListeners: Array<() => void> = [];
  private readonly offlineListeners: Array<() => void> = [];
  private readonly healthCheck: HealthCheck;

  constructor(private readonly deps: ConnectivityProbeDeps) {
    this.healthCheck = deps.healthCheck ?? this.defaultHealthCheck.bind(this);
  }

  onOnline(listener: () => void): void {
    this.onlineListeners.push(listener);
  }

  onOffline(listener: () => void): void {
    this.offlineListeners.push(listener);
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.checkOnce();
    }, this.deps.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Runs a single probe and fires transition events. Returns the current online state. */
  async checkOnce(): Promise<boolean> {
    let online: boolean;
    try {
      online = await this.healthCheck();
    } catch {
      online = false;
    }

    if (online && this.lastOnline !== true) {
      this.lastOnline = true;
      this.emit(this.onlineListeners);
    } else if (!online && this.lastOnline !== false) {
      this.lastOnline = false;
      this.emit(this.offlineListeners);
    }

    return online;
  }

  private emit(listeners: Array<() => void>): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        this.deps.logger.warn({ error }, '[probe] listener threw');
      }
    }
  }

  private async defaultHealthCheck(): Promise<boolean> {
    try {
      const response = await fetch(this.deps.healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(this.deps.timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
