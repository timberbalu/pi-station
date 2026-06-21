import type { StationState } from '../types.js';

export interface HardwareController {
  readonly name: string;
  init(): Promise<void>;
  setState(state: StationState): Promise<void>;
  pulse?(kind: 'teal' | 'amber' | 'red' | 'white'): Promise<void>;
  shutdown(): Promise<void>;
  getLastState(): string;
}
