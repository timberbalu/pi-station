import { access } from 'node:fs/promises';

import type { Logger } from 'pino';

import type { StationState } from '../types.js';
import type { HardwareController } from './HardwareController.js';

export class GpioHardwareController implements HardwareController {
  readonly name = 'gpio';
  private lastState = 'white-idle';

  constructor(
    private readonly chip: string,
    private readonly log: Logger,
  ) {}

  async init(): Promise<void> {
    try {
      await access(`/dev/${this.chip}`);
      this.log.info({ chip: this.chip }, '[hardware] gpio controller armed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown GPIO error';
      this.log.warn({ message }, '[hardware] gpio unavailable, dashboard fallback remains active');
    }
  }

  async setState(state: StationState): Promise<void> {
    this.lastState = state.toLowerCase();
    this.log.info({ state, chip: this.chip }, '[hardware] gpio state requested');
  }

  async shutdown(): Promise<void> {
    this.log.info('[hardware] gpio controller shutdown');
  }

  getLastState(): string {
    return this.lastState;
  }
}
