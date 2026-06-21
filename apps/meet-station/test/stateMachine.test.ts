import { describe, expect, it } from 'vitest';

import { StationEventBus } from '@pi-station/core';
import { StationStateMachine } from '@pi-station/core';

describe('StationStateMachine', () => {
  it('allows the main happy path transitions', () => {
    const machine = new StationStateMachine(new StationEventBus());

    machine.transition('PAIRING');
    machine.transition('READY');
    machine.transition('RECORDING');
    machine.transition('OFFLINE_BUFFERING');
    machine.transition('SYNCING');
    machine.transition('RECORDING');
    machine.transition('STOPPING');
    machine.transition('REPORT_READY');

    expect(machine.getState()).toBe('REPORT_READY');
  });

  it('rejects illegal transitions', () => {
    const machine = new StationStateMachine(new StationEventBus());
    expect(() => machine.transition('RECORDING')).toThrow(/Illegal station transition/);
  });
});
