import type { Logger } from 'pino';

import type { PlatformConfig } from '@pi-station/core';
import type { IngestPayload } from '../types.js';

export interface IngestResult {
  ok: boolean;
  status: number;
  error: string | null;
}

export class IngestClient {
  private connected = true;
  private lastError: string | null = null;

  constructor(
    private readonly config: PlatformConfig,
    private readonly log: Logger,
  ) {}

  async send(payload: IngestPayload, token: string): Promise<IngestResult> {
    try {
      const response = await fetch(this.config.relay.ingestUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token || this.config.relay.ingestToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': payload.segment_id,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.relay.timeoutMs),
      });

      if (!response.ok) {
        const error = `Ingest returned ${response.status}`;
        this.connected = false;
        this.lastError = error;
        return {
          ok: false,
          status: response.status,
          error,
        };
      }

      this.connected = true;
      this.lastError = null;
      return {
        ok: true,
        status: response.status,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown ingest failure';
      this.connected = false;
      this.lastError = message;
      this.log.warn({ error: message }, '[relay] ingest request failed');
      return {
        ok: false,
        status: 0,
        error: message,
      };
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getLastError(): string | null {
    return this.lastError;
  }
}
