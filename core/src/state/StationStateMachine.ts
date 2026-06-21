import { nowIso, type StationState } from '../types.js';
import { StationEventBus } from './StationEventBus.js';

const transitions: Record<StationState, readonly StationState[]> = {
  IDLE: ['PAIRING'],
  PAIRING: ['READY', 'ERROR', 'IDLE'],
  READY: ['RECORDING', 'IDLE', 'ERROR'],
  RECORDING: ['OFFLINE_BUFFERING', 'PAUSED', 'STOPPING', 'ERROR'],
  OFFLINE_BUFFERING: ['SYNCING', 'PAUSED', 'STOPPING', 'ERROR'],
  SYNCING: ['RECORDING', 'OFFLINE_BUFFERING', 'STOPPING', 'ERROR'],
  PAUSED: ['RECORDING', 'OFFLINE_BUFFERING', 'STOPPING', 'ERROR'],
  STOPPING: ['REPORT_READY', 'ERROR'],
  REPORT_READY: ['PAIRING', 'READY', 'IDLE', 'ERROR'],
  ERROR: ['IDLE', 'PAIRING', 'READY'],
};

export class StationStateMachine {
  private state: StationState = 'IDLE';

  constructor(private readonly bus: StationEventBus) {}

  getState(): StationState {
    return this.state;
  }

  canTransitionTo(next: StationState): boolean {
    return transitions[this.state].includes(next);
  }

  transition(next: StationState): void {
    if (this.state === next) {
      return;
    }

    if (!this.canTransitionTo(next)) {
      throw new Error(`Illegal station transition ${this.state} -> ${next}`);
    }

    const previous = this.state;
    this.state = next;
    this.bus.emitStateChanged({
      from: previous,
      to: next,
      at: nowIso(),
    });
  }
}
