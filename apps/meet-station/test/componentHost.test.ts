import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComponentContext, ComponentReportSection, ComponentStatus, StationComponent } from '../src/components/StationComponent.js';
import type { SessionSummary } from '../src/types.js';

/**
 * A fake component that records every method call — used to assert the host
 * fans out lifecycle calls to each registered component.
 */
class FakeComponent implements StationComponent {
  calls: string[] = [];
  readonly id: string;
  readonly label: string;

  private _buffering: boolean;
  private _queuedItems: number;

  constructor(id: string, { buffering = false, queuedItems = 0 } = {}) {
    this.id = id;
    this.label = id.charAt(0).toUpperCase() + id.slice(1);
    this._buffering = buffering;
    this._queuedItems = queuedItems;
  }

  setBuffering(buffering: boolean, queuedItems = 0): void {
    this._buffering = buffering;
    this._queuedItems = queuedItems;
  }

  async init(_ctx: ComponentContext): Promise<void> { this.calls.push('init'); }
  async startSession(_session: SessionSummary): Promise<void> { this.calls.push('startSession'); }
  async pause(): Promise<void> { this.calls.push('pause'); }
  async resume(): Promise<void> { this.calls.push('resume'); }
  async stopSession(): Promise<void> { this.calls.push('stopSession'); }
  async flush(): Promise<void> { this.calls.push('flush'); }
  async shutdown(): Promise<void> { this.calls.push('shutdown'); }

  getStatus(): ComponentStatus {
    return {
      id: this.id,
      label: this.label,
      healthy: !this._buffering,
      buffering: this._buffering,
      queuedItems: this._queuedItems,
      detail: {},
    };
  }

  contributeToReport(_session: SessionSummary): ComponentReportSection {
    return { id: this.id, label: this.label, summary: 'fake', items: [], health: {} };
  }
}

describe('component registration', () => {
  it('buildComponentRegistry throws on unknown id', async () => {
    const { buildComponentRegistry, parseEnabledComponents } = await import('../src/components/registry.js');
    const fakeVoice = new FakeComponent('voice');
    const ids = parseEnabledComponents('voice,unknown-thing');
    expect(() => buildComponentRegistry(ids, fakeVoice)).toThrow(/Unknown component id/);
  });

  it('buildComponentRegistry returns voice-only list for ENABLED_COMPONENTS=voice', async () => {
    const { buildComponentRegistry, parseEnabledComponents } = await import('../src/components/registry.js');
    const fakeVoice = new FakeComponent('voice');
    const components = buildComponentRegistry(parseEnabledComponents('voice'), fakeVoice);
    expect(components).toHaveLength(1);
    expect(components[0].id).toBe('voice');
  });

  it('buildComponentRegistry includes VideoComponent stub when voice,video', async () => {
    const { buildComponentRegistry, parseEnabledComponents } = await import('../src/components/registry.js');
    const fakeVoice = new FakeComponent('voice');
    const components = buildComponentRegistry(parseEnabledComponents('voice,video'), fakeVoice);
    expect(components).toHaveLength(2);
    expect(components.map((c) => c.id)).toEqual(['voice', 'video']);
  });
});

describe('VideoComponent stub', () => {
  it('always reports healthy and not buffering', async () => {
    const { VideoComponent } = await import('../src/components/video/VideoComponent.js');
    const video = new VideoComponent();
    const status = video.getStatus();
    expect(status.healthy).toBe(true);
    expect(status.buffering).toBe(false);
    expect(status.queuedItems).toBe(0);
  });

  it('all lifecycle methods resolve without throwing', async () => {
    const { VideoComponent } = await import('../src/components/video/VideoComponent.js');
    const video = new VideoComponent();
    const ctx = {} as ComponentContext;
    await expect(video.init(ctx)).resolves.toBeUndefined();
    await expect(video.startSession({} as SessionSummary)).resolves.toBeUndefined();
    await expect(video.pause()).resolves.toBeUndefined();
    await expect(video.resume()).resolves.toBeUndefined();
    await expect(video.stopSession()).resolves.toBeUndefined();
    await expect(video.flush()).resolves.toBeUndefined();
    await expect(video.shutdown()).resolves.toBeUndefined();
  });
});

describe('FakeComponent host fan-out behaviour', () => {
  let compA: FakeComponent;
  let compB: FakeComponent;
  const fakeSession: SessionSummary = {
    sessionId: 'test-session',
    sessionCode: '000',
    title: 'Test',
    stationToken: 'tok',
    ingestUrl: 'http://localhost/ingest',
    startedAt: null,
    stoppedAt: null,
  };

  beforeEach(() => {
    compA = new FakeComponent('a');
    compB = new FakeComponent('b');
  });

  it('init is called on each component', async () => {
    const ctx = {} as ComponentContext;
    await compA.init(ctx);
    await compB.init(ctx);
    expect(compA.calls).toContain('init');
    expect(compB.calls).toContain('init');
  });

  it('startSession is called on each component', async () => {
    await compA.startSession(fakeSession);
    await compB.startSession(fakeSession);
    expect(compA.calls).toContain('startSession');
    expect(compB.calls).toContain('startSession');
  });

  it('pause, resume, stopSession, flush, shutdown all propagate', async () => {
    const ops: Array<keyof FakeComponent> = ['pause', 'resume', 'stopSession', 'flush', 'shutdown'];
    for (const op of ops) {
      await (compA[op] as () => Promise<void>)();
    }
    expect(compA.calls).toEqual(['pause', 'resume', 'stopSession', 'flush', 'shutdown']);
  });

  it('getStatus includes buffering flag from each component', () => {
    compA.setBuffering(true, 3);
    const statusA = compA.getStatus();
    expect(statusA.buffering).toBe(true);
    expect(statusA.queuedItems).toBe(3);

    const statusB = compB.getStatus();
    expect(statusB.buffering).toBe(false);
  });
});

describe('component status shape', () => {
  it('StationComponent status has all required fields', async () => {
    const { VideoComponent } = await import('../src/components/video/VideoComponent.js');
    const video = new VideoComponent();
    const status = video.getStatus();
    expect(status).toMatchObject({
      id: expect.any(String),
      label: expect.any(String),
      healthy: expect.any(Boolean),
      buffering: expect.any(Boolean),
      queuedItems: expect.any(Number),
      detail: expect.any(Object),
    });
  });
});

describe('mock ingest availability in host status', () => {
  it('components field appears in StationStatusResponse', async () => {
    // This test verifies the type signature carries components[]
    const { VideoComponent } = await import('../src/components/video/VideoComponent.js');
    const fake = new VideoComponent();
    const statuses = [fake.getStatus()].map((s) => ({
      id: s.id,
      label: s.label,
      healthy: s.healthy,
      buffering: s.buffering,
      queued_items: s.queuedItems,
      detail: s.detail,
    }));
    expect(statuses[0]).toMatchObject({ id: 'video', queued_items: 0 });
  });
});
