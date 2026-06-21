import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '@pi-station/core';
import { createSessionDirs } from '../src/SessionDirs.js';

describe('createSessionDirs', () => {
  it('creates expected directory tree for a session', () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-dirs-'));

    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DATA_DIR: root,
      SQLITE_PATH: join(root, 'station.sqlite'),
      AUDIO_DIR: join(root, 'sessions'),
      VIDEO_DIR: join(root, 'sessions'),
      FACES_DIR: join(root, 'sessions'),
      REPORTS_DIR: join(root, 'reports'),
    });

    const sessionId = 'test-session-dirs-001';
    createSessionDirs(sessionId, config);

    const base = join(root, 'sessions', sessionId);
    expect(existsSync(join(base, 'audio'))).toBe(true);
    expect(existsSync(join(base, 'video'))).toBe(true);
    expect(existsSync(join(base, 'transcripts'))).toBe(true);
    expect(existsSync(join(root, 'sessions', sessionId, 'faces'))).toBe(true);
    expect(existsSync(join(root, 'reports'))).toBe(true);
  });

  it('is idempotent — calling twice does not throw', () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-dirs-'));
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DATA_DIR: root,
      SQLITE_PATH: join(root, 'station.sqlite'),
      VIDEO_DIR: join(root, 'sessions'),
      FACES_DIR: join(root, 'sessions'),
      REPORTS_DIR: join(root, 'reports'),
    });

    const sessionId = 'idempotent-session';
    expect(() => {
      createSessionDirs(sessionId, config);
      createSessionDirs(sessionId, config);
    }).not.toThrow();
  });
});
