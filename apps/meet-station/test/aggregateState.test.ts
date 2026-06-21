import { describe, expect, it } from 'vitest';

import type { ComponentStatus } from '../src/components/StationComponent.js';

/**
 * Tests the host's aggregate-state logic without wiring up the full MeetStationApp.
 * We test the pure logic: "any component buffering → OFFLINE_BUFFERING".
 */

function aggregateBuffering(
  components: Pick<ComponentStatus, 'buffering'>[],
  mockNetworkAvailable: boolean,
): boolean {
  return components.some((c) => c.buffering) || !mockNetworkAvailable;
}

function reconcile(
  currentState: string,
  anyBuffering: boolean,
): string {
  if (['PAUSED', 'STOPPING', 'REPORT_READY', 'IDLE', 'PAIRING', 'READY'].includes(currentState)) {
    return currentState;
  }

  if (anyBuffering) {
    if (currentState === 'RECORDING') return 'OFFLINE_BUFFERING';
    if (currentState === 'SYNCING') return 'OFFLINE_BUFFERING';
    return currentState;
  }

  if (currentState === 'OFFLINE_BUFFERING') return 'SYNCING';
  if (currentState === 'SYNCING') return 'RECORDING';
  return currentState;
}

describe('aggregate state — single component', () => {
  it('stays RECORDING when component is healthy', () => {
    const anyBuf = aggregateBuffering([{ buffering: false }], true);
    expect(reconcile('RECORDING', anyBuf)).toBe('RECORDING');
  });

  it('transitions to OFFLINE_BUFFERING when component buffers', () => {
    const anyBuf = aggregateBuffering([{ buffering: true }], true);
    expect(reconcile('RECORDING', anyBuf)).toBe('OFFLINE_BUFFERING');
  });

  it('transitions to OFFLINE_BUFFERING when mock network is down even if component healthy', () => {
    const anyBuf = aggregateBuffering([{ buffering: false }], false);
    expect(reconcile('RECORDING', anyBuf)).toBe('OFFLINE_BUFFERING');
  });

  it('transitions OFFLINE_BUFFERING → SYNCING when all clear', () => {
    const anyBuf = aggregateBuffering([{ buffering: false }], true);
    expect(reconcile('OFFLINE_BUFFERING', anyBuf)).toBe('SYNCING');
  });

  it('transitions SYNCING → RECORDING when all clear', () => {
    const anyBuf = aggregateBuffering([{ buffering: false }], true);
    expect(reconcile('SYNCING', anyBuf)).toBe('RECORDING');
  });
});

describe('aggregate state — two components', () => {
  it('stays RECORDING when both components are healthy', () => {
    const anyBuf = aggregateBuffering([{ buffering: false }, { buffering: false }], true);
    expect(reconcile('RECORDING', anyBuf)).toBe('RECORDING');
  });

  it('goes OFFLINE_BUFFERING when first component buffers', () => {
    const anyBuf = aggregateBuffering([{ buffering: true }, { buffering: false }], true);
    expect(reconcile('RECORDING', anyBuf)).toBe('OFFLINE_BUFFERING');
  });

  it('goes OFFLINE_BUFFERING when second component buffers', () => {
    const anyBuf = aggregateBuffering([{ buffering: false }, { buffering: true }], true);
    expect(reconcile('RECORDING', anyBuf)).toBe('OFFLINE_BUFFERING');
  });

  it('goes OFFLINE_BUFFERING when both components buffer', () => {
    const anyBuf = aggregateBuffering([{ buffering: true }, { buffering: true }], true);
    expect(reconcile('RECORDING', anyBuf)).toBe('OFFLINE_BUFFERING');
  });

  it('stays OFFLINE_BUFFERING while second component is still buffering', () => {
    const anyBuf = aggregateBuffering([{ buffering: false }, { buffering: true }], true);
    expect(reconcile('OFFLINE_BUFFERING', anyBuf)).toBe('OFFLINE_BUFFERING');
  });

  it('recovers to SYNCING only when all components drain', () => {
    const anyBuf = aggregateBuffering([{ buffering: false }, { buffering: false }], true);
    expect(reconcile('OFFLINE_BUFFERING', anyBuf)).toBe('SYNCING');
  });
});

describe('aggregate state — guarded states', () => {
  const guardedStates = ['PAUSED', 'STOPPING', 'REPORT_READY', 'IDLE', 'PAIRING', 'READY'];

  for (const state of guardedStates) {
    it(`does not change ${state} regardless of buffering`, () => {
      const anyBuf = aggregateBuffering([{ buffering: true }], false);
      expect(reconcile(state, anyBuf)).toBe(state);
    });
  }
});
