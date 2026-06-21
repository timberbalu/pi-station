import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRepositories, loadConfig, logger, openDatabase } from '@pi-station/core';
import type { Repositories } from '@pi-station/core';
import type Database from 'better-sqlite3';
import { SessionCleaner } from '../src/SessionCleaner.js';
import { nowIso } from '../src/types.js';

let root: string;
let db: Database.Database;
let repositories: Repositories;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pi-clean-'));
});

afterEach(() => {
  db?.close();
});

function makeCleanerAndDeps(sessionId: string, syncComplete: 0 | 1) {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATA_DIR: root,
    SQLITE_PATH: join(root, 'station.sqlite'),
    VIDEO_DIR: join(root, 'sessions'),
    FACES_DIR: join(root, 'sessions'),
    REPORTS_DIR: join(root, 'reports'),
  });

  db = openDatabase(config);
  repositories = createRepositories(db);

  const now = nowIso();
  repositories.syncState.ensure(sessionId, now);

  if (syncComplete === 1) {
    repositories.syncState.markComplete(sessionId, now);
  }

  const cleaner = new SessionCleaner(config, repositories, logger);
  return { config, cleaner };
}

describe('SessionCleaner', () => {
  const SESSION_ID = 'clean-test-session-001';

  it('deletes WAV and MP4 files after sync_complete=1', async () => {
    const { config, cleaner } = makeCleanerAndDeps(SESSION_ID, 1);

    // Create fake media files
    const audioDir = join(config.video.videoDir, SESSION_ID, 'audio');
    const videoDir = join(config.video.videoDir, SESSION_ID, 'video');
    const transcriptsDir = join(config.video.videoDir, SESSION_ID, 'transcripts');
    mkdirSync(audioDir, { recursive: true });
    mkdirSync(videoDir, { recursive: true });
    mkdirSync(transcriptsDir, { recursive: true });

    writeFileSync(join(audioDir, 'chunk-0001.wav'), Buffer.alloc(1024));
    writeFileSync(join(audioDir, 'chunk-0002.wav'), Buffer.alloc(2048));
    writeFileSync(join(videoDir, 'chunk-0001.mp4'), Buffer.alloc(4096));
    writeFileSync(join(transcriptsDir, 'whisper-2026.txt'), 'transcript content');

    const result = await cleaner.clean(SESSION_ID);

    expect(result.audioDeleted).toBe(2);
    expect(result.videoDeleted).toBe(1);
    expect(result.bytesFreed).toBe(1024 + 2048 + 4096);

    // WAV and MP4 should be gone
    expect(existsSync(join(audioDir, 'chunk-0001.wav'))).toBe(false);
    expect(existsSync(join(videoDir, 'chunk-0001.mp4'))).toBe(false);

    // Transcripts must be kept
    expect(existsSync(join(transcriptsDir, 'whisper-2026.txt'))).toBe(true);
  });

  it('refuses to clean when sync_complete != 1', async () => {
    const { cleaner } = makeCleanerAndDeps(SESSION_ID, 0);
    await expect(cleaner.clean(SESSION_ID)).rejects.toThrow(/not been fully synced/);
  });

  it('handles missing directories gracefully', async () => {
    const { cleaner } = makeCleanerAndDeps(SESSION_ID, 1);
    // No directories created — should not throw
    const result = await cleaner.clean(SESSION_ID);
    expect(result.audioDeleted).toBe(0);
    expect(result.videoDeleted).toBe(0);
    expect(result.bytesFreed).toBe(0);
  });
});
