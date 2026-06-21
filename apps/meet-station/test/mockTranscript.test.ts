import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '@pi-station/core';
import { MockTranscriptProvider } from '../src/capture/MockTranscriptProvider.js';

describe('MockTranscriptProvider', () => {
  it('emits committed transcript segments from the fixture', async () => {
    const provider = new MockTranscriptProvider(
      loadConfig({ ...process.env, NODE_ENV: 'test' }),
      fileURLToPath(new URL('../fixtures/mock-panel-transcript.txt', import.meta.url)),
    );

    const commits: string[] = [];
    provider.onCommit((commit) => {
      commits.push(commit.text);
    });

    await provider.connect();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await provider.disconnect();

    expect(commits.length).toBeGreaterThan(0);
    expect(commits[0]).toContain('Welcome to tonight');
  });
});
