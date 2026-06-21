import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { logger } from '@pi-station/core';
import type { AudioChunkRecord } from '@pi-station/core';
import { FasterWhisperProvider } from '../src/capture/FasterWhisperProvider.js';
import type { SpawnLike } from '../src/capture/FasterWhisperProvider.js';

interface FakeOptions {
  stdout?: string;
  code?: number;
  error?: Error;
  neverClose?: boolean;
}

function makeFakeChild(opts: FakeOptions): ChildProcess {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(emitter, { stdout, stderr, kill: (): boolean => true });

  setImmediate(() => {
    if (opts.error) {
      emitter.emit('error', opts.error);
      return;
    }
    if (opts.stdout) {
      stdout.write(opts.stdout);
    }
    stdout.end();
    if (!opts.neverClose) {
      emitter.emit('close', opts.code ?? 0);
    }
  });

  return child as unknown as ChildProcess;
}

function spawnReturning(opts: FakeOptions): SpawnLike {
  return () => makeFakeChild(opts);
}

function chunk(index: number, startMs: number, endMs: number): AudioChunkRecord {
  return {
    id: `chunk-${index}`,
    sessionId: 'VI-test',
    chunkIndex: index,
    path: `/tmp/chunk-${index}.wav`,
    startMs,
    endMs,
    bytes: 1000,
    sampleRate: 16000,
    channels: 1,
    status: 'closed',
    createdAt: new Date().toISOString(),
    closedAt: new Date().toISOString(),
  };
}

const sampleJson = JSON.stringify({
  segments: [
    { start: 0, end: 2.5, text: ' Hello world. ', words: [{ word: 'Hello', start: 0, end: 0.5 }] },
  ],
  language: 'en',
});

describe('FasterWhisperProvider', () => {
  it('parses transcribe.py JSON output', async () => {
    const provider = new FasterWhisperProvider('script.py', 'base.en', 'python3', 5, logger, spawnReturning({ stdout: sampleJson }));
    const result = await provider.transcribeFile('/tmp/a.wav');

    expect(result.language).toBe('en');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.text).toBe('Hello world.');
    expect(result.segments[0]?.words[0]?.word).toBe('Hello');
  });

  it('returns empty segments (no throw) on subprocess error', async () => {
    const provider = new FasterWhisperProvider(
      'script.py', 'base.en', 'python3', 5, logger,
      spawnReturning({ error: new Error('ENOENT: python3 not found') }),
    );
    const result = await provider.transcribeFile('/tmp/a.wav');
    expect(result.segments).toEqual([]);
  });

  it('returns empty segments (no throw) on non-zero exit', async () => {
    const provider = new FasterWhisperProvider(
      'script.py', 'base.en', 'python3', 5, logger,
      spawnReturning({ stdout: '', code: 1 }),
    );
    const result = await provider.transcribeFile('/tmp/a.wav');
    expect(result.segments).toEqual([]);
  });

  it('returns empty segments (no throw) on timeout', async () => {
    const provider = new FasterWhisperProvider(
      'script.py', 'base.en', 'python3', 5, logger,
      spawnReturning({ neverClose: true }),
    );
    const result = await provider.transcribeFile('/tmp/a.wav', 50);
    expect(result.segments).toEqual([]);
  });

  it('shifts chunk timestamps to session-relative seconds', async () => {
    const segJson = JSON.stringify({
      segments: [{ start: 5, end: 6, text: 'x', words: [{ word: 'x', start: 5, end: 6 }] }],
      language: 'en',
    });
    const provider = new FasterWhisperProvider('script.py', 'base.en', 'python3', 5, logger, spawnReturning({ stdout: segJson }));

    const segments = await provider.transcribeSession('VI-test', [chunk(1, 0, 30000), chunk(2, 30000, 60000)], 0);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.start).toBe(5); // chunk 1 offset 0
    expect(segments[1]?.start).toBe(35); // chunk 2 offset 30s + 5s
    expect(segments[1]?.words[0]?.start).toBe(35); // words shifted too
  });

  it('returns segments in chronological order regardless of chunk order', async () => {
    const segJson = JSON.stringify({ segments: [{ start: 1, end: 2, text: 'x', words: [] }], language: 'en' });
    const provider = new FasterWhisperProvider('script.py', 'base.en', 'python3', 5, logger, spawnReturning({ stdout: segJson }));

    const segments = await provider.transcribeSession('VI-test', [chunk(2, 30000, 60000), chunk(1, 0, 30000)], 0);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.start).toBe(1); // chunk index 1 (offset 0)
    expect(segments[1]?.start).toBe(31); // chunk index 2 (offset 30s)
  });
});
