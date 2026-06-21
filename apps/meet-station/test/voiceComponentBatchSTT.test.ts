import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { createRepositories, loadConfig, logger, openDatabase, StationEventBus } from '@pi-station/core';
import type { AudioChunkRecord, Repositories, SessionSummary } from '@pi-station/core';
import { VoiceComponent } from '../src/components/voice/VoiceComponent.js';
import type { CaptureService } from '../src/capture/CaptureService.js';
import type { RelayService } from '../src/relay/RelayService.js';
import type { BatchTranscriber, WhisperSegment } from '../src/capture/FasterWhisperProvider.js';

function makeFakeCapture(): CaptureService {
  return {
    prepare: async () => undefined,
    onCommittedSegment: () => undefined,
    start: async () => undefined,
    stop: async () => undefined,
    pause: async () => undefined,
    resume: async () => undefined,
    isRecording: () => false,
    isTranscriptConnected: () => true,
    getStatus: () => ({ recording: false }),
  } as unknown as CaptureService;
}

function makeFakeRelay(): RelayService {
  return {
    start: () => undefined,
    stop: () => undefined,
    setSession: () => undefined,
    handleCommittedSegment: async () => undefined,
    flushOnce: async () => undefined,
    getStatus: () => ({ queuedSegments: 0, sentSegments: 0, deadSegments: 0 }),
    getQueuedCount: () => 0,
  } as unknown as RelayService;
}

function context(config: ReturnType<typeof loadConfig>, repositories: Repositories, bus: StationEventBus) {
  return { config, repositories, bus, logger, dataDir: config.app.dataDir };
}

function session(): SessionSummary {
  return {
    sessionId: 'VI-batch-1',
    sessionCode: '123456',
    title: 'Batch Test',
    stationToken: 'tok',
    ingestUrl: 'http://localhost/ingest',
    startedAt: new Date().toISOString(),
    stoppedAt: null,
  };
}

function seedClosedChunk(repositories: Repositories, sessionId: string): void {
  const chunk: AudioChunkRecord = {
    id: 'chunk-1',
    sessionId,
    chunkIndex: 1,
    path: '/tmp/chunk-1.wav',
    startMs: 0,
    endMs: 30000,
    bytes: 1000,
    sampleRate: 16000,
    channels: 1,
    status: 'closed',
    createdAt: new Date().toISOString(),
    closedAt: new Date().toISOString(),
  };
  repositories.audioChunks.open(chunk);
}

function setup(provider: 'mock' | 'elevenlabs' | 'faster-whisper') {
  const root = mkdtempSync(join(tmpdir(), 'pi-batch-'));
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    STT_PROVIDER: provider,
    DATA_DIR: root,
    SQLITE_PATH: join(root, 'station.sqlite'),
    AUDIO_DIR: join(root, 'audio'),
  });
  const db = openDatabase(config);
  const repositories = createRepositories(db);
  const bus = new StationEventBus();
  return { config, db, repositories, bus };
}

const twoSegments: WhisperSegment[] = [
  { start: 0, end: 1.2, text: 'Batch segment one', words: [] },
  { start: 1.2, end: 2.4, text: 'Batch segment two', words: [] },
];

describe('VoiceComponent batch STT', () => {
  it('runs batch transcription on stopSession when provider is faster-whisper', async () => {
    const { config, db, repositories, bus } = setup('faster-whisper');
    let called = false;
    const whisper: BatchTranscriber = {
      transcribeSession: async () => {
        called = true;
        return twoSegments;
      },
    };

    const voice = new VoiceComponent(makeFakeCapture(), makeFakeRelay(), whisper);
    await voice.init(context(config, repositories, bus));
    const s = session();
    seedClosedChunk(repositories, s.sessionId);

    await voice.startSession(s);
    await voice.stopSession();

    expect(called).toBe(true);
    const segments = repositories.transcriptSegments.listBySession(s.sessionId);
    expect(segments).toHaveLength(2);
    expect(segments.every((seg) => seg.provider === 'faster-whisper')).toBe(true);
    expect(segments[0]?.startMs).toBe(0);
    expect(segments[1]?.startMs).toBe(1200);
    expect(voice.getBatchTranscriptionStatus().status).toBe('complete');

    db.close();
  });

  it('does NOT run batch transcription when provider is mock', async () => {
    const { config, db, repositories, bus } = setup('mock');
    let called = false;
    const whisper: BatchTranscriber = {
      transcribeSession: async () => {
        called = true;
        return twoSegments;
      },
    };

    const voice = new VoiceComponent(makeFakeCapture(), makeFakeRelay(), whisper);
    await voice.init(context(config, repositories, bus));
    const s = session();
    seedClosedChunk(repositories, s.sessionId);

    await voice.startSession(s);
    await voice.stopSession();

    expect(called).toBe(false);
    expect(repositories.transcriptSegments.listBySession(s.sessionId)).toHaveLength(0);
    expect(voice.getBatchTranscriptionStatus().available).toBe(false);

    db.close();
  });

  it('does NOT run batch transcription when provider is elevenlabs', async () => {
    const { config, db, repositories, bus } = setup('elevenlabs');
    let called = false;
    const whisper: BatchTranscriber = {
      transcribeSession: async () => {
        called = true;
        return twoSegments;
      },
    };

    const voice = new VoiceComponent(makeFakeCapture(), makeFakeRelay(), whisper);
    await voice.init(context(config, repositories, bus));
    const s = session();
    seedClosedChunk(repositories, s.sessionId);

    await voice.startSession(s);
    await voice.stopSession();

    expect(called).toBe(false);
    expect(repositories.transcriptSegments.listBySession(s.sessionId)).toHaveLength(0);

    db.close();
  });

  it('completes the session with zero segments when transcription fails', async () => {
    const { config, db, repositories, bus } = setup('faster-whisper');
    const whisper: BatchTranscriber = {
      transcribeSession: async () => {
        throw new Error('faster-whisper crashed');
      },
    };

    const voice = new VoiceComponent(makeFakeCapture(), makeFakeRelay(), whisper);
    await voice.init(context(config, repositories, bus));
    const s = session();
    seedClosedChunk(repositories, s.sessionId);

    await voice.startSession(s);
    await expect(voice.stopSession()).resolves.toBeUndefined();

    expect(repositories.transcriptSegments.listBySession(s.sessionId)).toHaveLength(0);
    expect(voice.getBatchTranscriptionStatus().status).toBe('error');

    db.close();
  });
});
