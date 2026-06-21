import { describe, expect, it } from 'vitest';

import { ConnectivityProbe, logger } from '@pi-station/core';

function makeProbe(healthSequence: boolean[]) {
  let i = 0;
  const probe = new ConnectivityProbe({
    healthUrl: 'http://localhost/health',
    intervalMs: 10000,
    timeoutMs: 1000,
    logger,
    healthCheck: async () => {
      const value = healthSequence[Math.min(i, healthSequence.length - 1)];
      i += 1;
      return value;
    },
  });
  return probe;
}

describe('ConnectivityProbe', () => {
  it('fires online on first success after offline', async () => {
    const probe = makeProbe([false, true]);
    let onlineCount = 0;
    probe.onOnline(() => { onlineCount += 1; });

    await probe.checkOnce(); // offline
    expect(onlineCount).toBe(0);
    await probe.checkOnce(); // online → fires
    expect(onlineCount).toBe(1);
  });

  it('fires offline on first failure after online', async () => {
    const probe = makeProbe([true, false]);
    let offlineCount = 0;
    probe.onOffline(() => { offlineCount += 1; });

    await probe.checkOnce(); // online
    expect(offlineCount).toBe(0);
    await probe.checkOnce(); // offline → fires
    expect(offlineCount).toBe(1);
  });

  it('does not fire repeatedly for sustained online state', async () => {
    const probe = makeProbe([true, true, true, true]);
    let onlineCount = 0;
    probe.onOnline(() => { onlineCount += 1; });

    await probe.checkOnce();
    await probe.checkOnce();
    await probe.checkOnce();
    await probe.checkOnce();

    expect(onlineCount).toBe(1);
  });

  it('does not fire repeatedly for sustained offline state', async () => {
    const probe = makeProbe([false, false, false]);
    let offlineCount = 0;
    probe.onOffline(() => { offlineCount += 1; });

    await probe.checkOnce();
    await probe.checkOnce();
    await probe.checkOnce();

    expect(offlineCount).toBe(1);
  });

  it('fires on each transition across flapping connectivity', async () => {
    const probe = makeProbe([true, false, true]);
    let onlineCount = 0;
    let offlineCount = 0;
    probe.onOnline(() => { onlineCount += 1; });
    probe.onOffline(() => { offlineCount += 1; });

    await probe.checkOnce(); // online → online fires
    await probe.checkOnce(); // offline → offline fires
    await probe.checkOnce(); // online → online fires

    expect(onlineCount).toBe(2);
    expect(offlineCount).toBe(1);
  });

  it('treats a thrown health check as offline', async () => {
    const probe = new ConnectivityProbe({
      healthUrl: 'http://localhost/health',
      intervalMs: 10000,
      timeoutMs: 1000,
      logger,
      healthCheck: async () => { throw new Error('boom'); },
    });
    let offlineCount = 0;
    probe.onOffline(() => { offlineCount += 1; });
    const online = await probe.checkOnce();
    expect(online).toBe(false);
    expect(offlineCount).toBe(1);
  });
});
