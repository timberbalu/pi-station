import { randomUUID } from 'node:crypto';

import { nowIso } from '../types.js';
import type { SessionEventsRepository } from '../db/repositories.js';
import { StationEventBus } from './StationEventBus.js';

export class HealthLog {
  constructor(
    private readonly bus: StationEventBus,
    private readonly sessionEventsRepository: SessionEventsRepository,
  ) {}

  start(): void {
    this.bus.onSessionEvent((event) => {
      this.sessionEventsRepository.insert({
        id: randomUUID(),
        sessionId: event.sessionId,
        type: event.type,
        level: event.level,
        message: event.message,
        payloadJson: JSON.stringify(event.payload ?? {}),
        createdAt: nowIso(),
      });
    });
  }
}
