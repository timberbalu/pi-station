import type { Logger } from 'pino';

import type { StationState } from '../types.js';
import type { HardwareController } from './HardwareController.js';

function mapStateToIndicator(state: StationState): string {
  switch (state) {
    case 'RECORDING':
      return 'red+teal';
    case 'OFFLINE_BUFFERING':
      return 'amber';
    case 'SYNCING':
      return 'teal-pulse';
    case 'READY':
      return 'white';
    case 'PAIRING':
      return 'white-pulse';
    case 'PAUSED':
      return 'white+amber';
    case 'STOPPING':
      return 'amber-pulse';
    case 'REPORT_READY':
      return 'teal';
    case 'ERROR':
      return 'red-blink';
    case 'IDLE':
    default:
      return 'white-idle';
  }
}

export class ConsoleHardwareController implements HardwareController {
  readonly name = 'console';
  private lastState = 'white-idle';

  constructor(private readonly log: Logger) {}

  async init(): Promise<void> {
    this.log.info('[hardware] console controller ready');
  }

  async setState(state: StationState): Promise<void> {
    this.lastState = mapStateToIndicator(state);
    this.log.info({ state, indicator: this.lastState }, '[hardware] state changed');
  }

  async shutdown(): Promise<void> {
    this.log.info('[hardware] console controller shutdown');
  }

  getLastState(): string {
    return this.lastState;
  }
}
